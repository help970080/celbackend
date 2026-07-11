// routes/checkoutRoutes.js
// ============================================================
// POS UNIFICADO — un solo camino de venta:
//   - cualquier artículo (no solo celulares)
//   - ticket mixto: cada línea es 'contado' o 'credito'
//   - IMEI opcional: solo para equipos MDM (requires_imei) que van a crédito
//   - enrola a devices_mdm en la MISMA transacción
//   - descuenta stock con lock, crea SaleItem, registra el pago de hoy
//
// Reemplaza la necesidad de /api/sales/create-with-imei.
// Se monta ADITIVO, sin tocar el POST /api/sales/ existente:
//   const initCheckoutRoutes = require('./routes/checkoutRoutes');
//   app.use('/api/sales', authMiddleware, initCheckoutRoutes(models, sequelize));
// (queda como POST /api/sales/checkout)
// ============================================================

const express = require('express');
const router = express.Router();
const authorizeRoles = require('../middleware/roleMiddleware');
const applyStoreFilter = require('../middleware/storeFilterMiddleware');
const moment = require('moment-timezone');

const TIMEZONE = 'America/Mexico_City';

// ---- Helpers IMEI (mismos criterios que server.js) ----
function normalizeImei(raw) {
    if (raw === null || raw === undefined) return null;
    const digits = String(raw).replace(/\D/g, '');
    if (digits.length < 14 || digits.length > 17) return null;
    return digits;
}
function isValidImeiLuhn(imei) {
    if (!imei || imei.length !== 15) return !!(imei && imei.length >= 14);
    let sum = 0;
    for (let i = 0; i < 15; i++) {
        let d = parseInt(imei[i], 10);
        if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
        sum += d;
    }
    return sum % 10 === 0;
}

function calcularProximaFechaPago(fechaBase, frecuencia, pagosRealizados = 0) {
    const fecha = moment(fechaBase).tz(TIMEZONE);
    switch (frecuencia) {
        case 'biweekly': fecha.add((pagosRealizados + 1) * 2, 'weeks'); break;
        case 'monthly':  fecha.add(pagosRealizados + 1, 'months'); break;
        case 'weekly':
        default:         fecha.add(pagosRealizados + 1, 'weeks');
    }
    return fecha.format('YYYY-MM-DD');
}

const money = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const initCheckoutRoutes = (models, sequelize) => {
    const { Sale, Client, Product, Payment, SaleItem, User, AuditLog } = models;

    // POST /api/sales/checkout
    router.post('/checkout',
        authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']),
        applyStoreFilter,
        async (req, res) => {
            const {
                clientId,
                items,                       // [{ productId, quantity, plan:'contado'|'credito', imei? }]
                assignedCollectorId,
                paymentFrequency = 'weekly',
                numberOfPayments,            // requerido si hay financiado
                downPaymentPct,              // % de enganche sobre lo financiado (ej. 10)
                downPayment                  // o monto absoluto de enganche (alternativa a pct)
            } = req.body;

            if (!clientId || !Array.isArray(items) || items.length === 0) {
                return res.status(400).json({ message: 'Cliente y al menos un artículo son obligatorios.' });
            }

            const t = await sequelize.transaction();
            try {
                const tiendaId = req.user.tiendaId;

                const client = await Client.findOne({
                    where: { id: clientId, ...req.storeFilter },
                    transaction: t
                });
                if (!client) {
                    await t.rollback();
                    return res.status(403).json({ message: 'Cliente no encontrado o no pertenece a tu tienda.' });
                }

                let contado = 0, credito = 0;
                const productUpdates = [];
                const saleItemsToCreate = [];
                const enrolments = [];   // { imei, brand, model } de equipos a crédito

                for (const raw of items) {
                    const plan = raw.plan === 'contado' ? 'contado' : 'credito';
                    const qty = parseInt(raw.quantity, 10);
                    if (!qty || qty < 1) throw new Error('Cantidad inválida en un artículo.');

                    const product = await Product.findOne({
                        where: { id: raw.productId, ...req.storeFilter },
                        transaction: t,
                        lock: true
                    });
                    if (!product) throw new Error(`Producto ${raw.productId} no encontrado o no pertenece a tu tienda.`);
                    if (product.stock < qty) throw new Error(`Stock insuficiente para ${product.name}.`);

                    const subtotal = money(product.price * qty);
                    if (plan === 'contado') contado += subtotal; else credito += subtotal;

                    // IMEI: obligatorio solo si el producto es equipo MDM y la línea va a crédito
                    let lineImei = null;
                    if (product.requires_imei && plan === 'credito') {
                        const n = normalizeImei(raw.imei);
                        if (!n) throw new Error(`${product.name}: IMEI requerido (14-17 dígitos) para equipo a crédito.`);
                        if (!isValidImeiLuhn(n)) throw new Error(`${product.name}: el IMEI no pasa validación. Verifica la captura.`);

                        // ¿IMEI ya vendido/activo?
                        const [dup] = await sequelize.query(
                            `SELECT d.id, d.sale_id, s.status AS sale_status
                               FROM devices_mdm d
                          LEFT JOIN sales s ON s.id = d.sale_id
                              WHERE d.imei = :imei LIMIT 1`,
                            { replacements: { imei: n }, transaction: t }
                        );
                        if (dup.length && dup[0].sale_id &&
                            ['completed', 'active', 'pending', 'overdue'].includes(dup[0].sale_status)) {
                            throw new Error(`IMEI ${n} ya está vinculado a la venta #${dup[0].sale_id}.`);
                        }

                        lineImei = n;
                        enrolments.push({ imei: n, brand: product.brand || null, model: product.name || null, alreadyRow: dup.length > 0 });
                    }

                    productUpdates.push({ instance: product, newStock: product.stock - qty });
                    saleItemsToCreate.push({
                        productId: product.id,
                        quantity: qty,
                        priceAtSale: product.price,
                        payment_plan: plan,
                        imei: lineImei
                    });
                }

                contado = money(contado);
                credito = money(credito);
                const totalAmount = money(contado + credito);

                // ---- enganche sobre lo financiado (credito) ----
                let enganche = 0;
                if (credito > 0) {
                    if (downPaymentPct !== undefined && downPaymentPct !== null && downPaymentPct !== '') {
                        const pct = parseFloat(downPaymentPct);
                        if (isNaN(pct) || pct < 0 || pct > 100) throw new Error('El porcentaje de enganche es inválido.');
                        enganche = money(credito * pct / 100);
                    } else if (downPayment !== undefined) {
                        enganche = money(parseFloat(downPayment) || 0);
                    }
                    if (enganche < 0 || enganche > credito) throw new Error('El enganche no puede exceder lo financiado.');
                }

                const financiado = money(credito - enganche);
                const isCredit = financiado > 0;
                const pagadoHoy = money(contado + enganche);

                // Validaciones de crédito
                let numPagos = null, weekly = null, primeraFecha = null, frecuencia = paymentFrequency || 'weekly';
                if (isCredit) {
                    numPagos = parseInt(numberOfPayments, 10);
                    if (!numPagos || numPagos <= 0) throw new Error('El número de pagos debe ser mayor a cero.');
                    if (assignedCollectorId) {
                        const collector = await User.findByPk(assignedCollectorId, { transaction: t });
                        if (!collector) throw new Error(`El gestor con ID ${assignedCollectorId} no existe.`);
                    }
                    weekly = money(financiado / numPagos);
                    primeraFecha = calcularProximaFechaPago(new Date(), frecuencia, 0);
                }

                // ---- Crear venta ----
                // balanceDue = totalAmount - downPayment  →  = financiado (cuadra con tu fórmula actual)
                const newSale = await Sale.create({
                    clientId,
                    totalAmount,
                    isCredit,
                    downPayment: pagadoHoy,
                    balanceDue: financiado,
                    status: isCredit ? 'active' : 'completed',
                    paymentFrequency: isCredit ? frecuencia : 'weekly',
                    numberOfPayments: numPagos,
                    weeklyPaymentAmount: weekly,
                    nextPaymentDate: primeraFecha,
                    assignedCollectorId: isCredit && assignedCollectorId ? parseInt(assignedCollectorId, 10) : null,
                    tiendaId,
                    paymentsMade: 0
                }, { transaction: t });

                // ---- Items ----
                await SaleItem.bulkCreate(
                    saleItemsToCreate.map(i => ({ ...i, saleId: newSale.id })),
                    { transaction: t }
                );

                // ---- Stock ----
                for (const u of productUpdates) {
                    u.instance.stock = u.newStock;
                    await u.instance.save({ transaction: t });
                }

                // ---- Enrolar IMEIs a devices_mdm (equipos a crédito) ----
                for (const e of enrolments) {
                    if (e.alreadyRow) {
                        await sequelize.query(
                            `UPDATE devices_mdm
                                SET sale_id=:saleId, client_id=:clientId, tienda_id=:tiendaId,
                                    brand=COALESCE(:brand, brand), model=COALESCE(:model, model),
                                    status='active',
                                    notes=COALESCE(notes,'') || E'\n[' || NOW()::text || '] Vinculado a venta #' || :saleId,
                                    updated_at=NOW()
                              WHERE imei=:imei`,
                            { replacements: { saleId: newSale.id, clientId, tiendaId, brand: e.brand, model: e.model, imei: e.imei }, transaction: t }
                        );
                    } else {
                        await sequelize.query(
                            `INSERT INTO devices_mdm
                                (device_number, imei, brand, model, sale_id, client_id, status, tienda_id, notes, created_at, updated_at)
                             VALUES
                                (:imei, :imei, :brand, :model, :saleId, :clientId, 'active', :tiendaId,
                                 '[' || NOW()::text || '] Creado al cerrar venta #' || :saleId, NOW(), NOW())`,
                            { replacements: { imei: e.imei, brand: e.brand, model: e.model, saleId: newSale.id, clientId, tiendaId }, transaction: t }
                        );
                    }
                }

                // ---- Pago de hoy (contado + enganche) ----
                if (pagadoHoy > 0) {
                    const notes = isCredit
                        ? `Pago inicial: contado $${contado.toFixed(2)} + enganche $${enganche.toFixed(2)}`
                        : 'Pago total de venta de contado';
                    await Payment.create({
                        saleId: newSale.id,
                        amount: pagadoHoy,
                        paymentMethod: 'cash',
                        notes,
                        tiendaId
                    }, { transaction: t });
                }

                await t.commit();

                try {
                    await AuditLog.create({
                        userId: req.user.userId,
                        username: req.user.username,
                        action: 'CREÓ VENTA',
                        details: `Venta #${newSale.id} (${client.name} ${client.lastName || ''}). Total $${totalAmount.toFixed(2)}. ` +
                                 (isCredit ? `Contado $${contado.toFixed(2)} + enganche $${enganche.toFixed(2)}, financiado $${financiado.toFixed(2)} a ${numPagos} pagos.` : 'Contado.') +
                                 (enrolments.length ? ` Equipos MDM: ${enrolments.length}.` : ''),
                        tiendaId
                    });
                } catch (auditError) { console.error('Auditoría:', auditError.message); }

                return res.status(201).json({
                    success: true,
                    saleId: newSale.id,
                    isCredit,
                    resumen: {
                        total: totalAmount,
                        contado,
                        credito,
                        enganche,
                        financiado,
                        pagadoHoy,
                        cuota: weekly,
                        numeroPagos: numPagos,
                        primerPago: primeraFecha,
                        equiposEnrolados: enrolments.length
                    }
                });

            } catch (err) {
                await t.rollback();
                console.error('[checkout] error:', err.message);
                return res.status(400).json({ message: err.message || 'Error al registrar la venta.' });
            }
        }
    );

    return router;
};

module.exports = initCheckoutRoutes;

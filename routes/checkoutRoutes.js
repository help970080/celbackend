// routes/checkoutRoutes.js
// POS unificado: cualquier artículo + ticket mixto (contado/crédito por línea).
// Sin MDM/IMEI (se puede añadir después). Aditivo, no toca POST /api/sales/.
//   const initCheckoutRoutes = require('./routes/checkoutRoutes');
//   app.use('/api/sales', authMiddleware, initCheckoutRoutes(models, sequelize));
// → POST /api/sales/checkout

const express = require('express');
const router = express.Router();
const authorizeRoles = require('../middleware/roleMiddleware');
const applyStoreFilter = require('../middleware/storeFilterMiddleware');
const moment = require('moment-timezone');

const TIMEZONE = 'America/Mexico_City';

function calcularProximaFechaPago(fechaBase, frecuencia, pagosRealizados = 0) {
    const fecha = moment(fechaBase).tz(TIMEZONE);
    switch (frecuencia) {
        case 'biweekly':
        case 'fortnightly': fecha.add((pagosRealizados + 1) * 2, 'weeks'); break;
        case 'monthly':     fecha.add(pagosRealizados + 1, 'months'); break;
        case 'daily':       fecha.add(pagosRealizados + 1, 'days'); break;
        case 'weekly':
        default:            fecha.add(pagosRealizados + 1, 'weeks');
    }
    return fecha.format('YYYY-MM-DD');
}

const money = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const initCheckoutRoutes = (models, sequelize) => {
    const { Sale, Client, Product, Payment, SaleItem, User, AuditLog } = models;

    router.post('/checkout',
        authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']),
        applyStoreFilter,
        async (req, res) => {
            const {
                clientId,
                items,                       // [{ productId, quantity, plan:'contado'|'credito' }]
                assignedCollectorId,
                paymentFrequency = 'weekly',
                numberOfPayments,
                downPaymentPct,              // % de enganche sobre lo financiado
                downPayment                  // o monto absoluto
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

                    productUpdates.push({ instance: product, newStock: product.stock - qty });
                    saleItemsToCreate.push({
                        productId: product.id,
                        quantity: qty,
                        priceAtSale: product.price,
                        payment_plan: plan
                    });
                }

                contado = money(contado);
                credito = money(credito);
                const totalAmount = money(contado + credito);

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

                let numPagos = null, weekly = null, primeraFecha = null;
                const frecuencia = paymentFrequency || 'weekly';
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

                await SaleItem.bulkCreate(
                    saleItemsToCreate.map(i => ({ ...i, saleId: newSale.id })),
                    { transaction: t }
                );

                for (const u of productUpdates) {
                    u.instance.stock = u.newStock;
                    await u.instance.save({ transaction: t });
                }

                if (pagadoHoy > 0) {
                    const notes = isCredit
                        ? `Pago inicial: contado $${contado.toFixed(2)} + enganche $${enganche.toFixed(2)}`
                        : 'Pago total de venta de contado';
                    await Payment.create({
                        saleId: newSale.id, amount: pagadoHoy, paymentMethod: 'cash', notes, tiendaId
                    }, { transaction: t });
                }

                await t.commit();

                try {
                    await AuditLog.create({
                        userId: req.user.userId,
                        username: req.user.username,
                        action: 'CREÓ VENTA',
                        details: `Venta #${newSale.id} (${client.name} ${client.lastName || ''}). Total $${totalAmount.toFixed(2)}. ` +
                                 (isCredit ? `Contado $${contado.toFixed(2)} + enganche $${enganche.toFixed(2)}, financiado $${financiado.toFixed(2)} a ${numPagos} pagos.` : 'Contado.'),
                        tiendaId
                    });
                } catch (auditError) { console.error('Auditoría:', auditError.message); }

                return res.status(201).json({
                    success: true,
                    saleId: newSale.id,
                    isCredit,
                    resumen: { total: totalAmount, contado, credito, enganche, financiado, pagadoHoy, cuota: weekly, numeroPagos: numPagos, primerPago: primeraFecha }
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

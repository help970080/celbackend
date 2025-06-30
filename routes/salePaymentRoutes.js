// Archivo: routes/salePaymentRoutes.js - Versión Definitiva y Optimizada

const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const authMiddleware = require('../middleware/authMiddleware');
const authorizeRoles = require('../middleware/roleMiddleware');
const moment = require('moment-timezone');
const ExcelJS = require('exceljs');

let Sale, Client, Product, Payment, SaleItem, User, AuditLog;
const TIMEZONE = "America/Mexico_City";

const initSalePaymentRoutes = (models, sequelize) => {
    Sale = models.Sale;
    Client = models.Client;
    Product = models.Product;
    Payment = models.Payment;
    SaleItem = models.SaleItem;
    User = models.User;
    AuditLog = models.AuditLog;

    // --- INICIO DE LA MODIFICACIÓN: RUTA POST / REESCRITA PARA MÁXIMA EFICIENCIA ---
    router.post('/', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
        const { clientId, saleItems, isCredit, downPayment, assignedCollectorId, paymentFrequency, numberOfPayments } = req.body;

        if (!clientId || !saleItems || !Array.isArray(saleItems) || saleItems.length === 0) {
            return res.status(400).json({ message: 'Cliente y al menos un producto son obligatorios.' });
        }

        const t = await sequelize.transaction();
        try {
            // 1. Validar cliente y gestor de una vez
            const client = await Client.findByPk(clientId, { transaction: t });
            if (!client) throw new Error('Cliente no encontrado.');

            if (isCredit && assignedCollectorId) {
                const collector = await User.findByPk(assignedCollectorId, { transaction: t });
                if (!collector || collector.role !== 'collector_agent') {
                    throw new Error(`El gestor con ID ${assignedCollectorId} no es válido.`);
                }
            }
            
            // 2. Obtener TODOS los productos necesarios en UNA SOLA CONSULTA
            const productIds = saleItems.map(item => item.productId);
            const productsInDB = await Product.findAll({
                where: { id: { [Op.in]: productIds } },
                transaction: t,
                lock: t.LOCK.UPDATE // Bloquea las filas para evitar race conditions
            });

            const productMap = new Map(productsInDB.map(p => [p.id, p]));
            let totalAmount = 0;

            // 3. Validar stock y calcular totales EN MEMORIA (muy rápido)
            for (const item of saleItems) {
                const product = productMap.get(item.productId);
                if (!product) throw new Error(`Producto con ID ${item.productId} no encontrado.`);
                if (product.stock < item.quantity) {
                    throw new Error(`Stock insuficiente para ${product.name}. Disponible: ${product.stock}, Solicitado: ${item.quantity}`);
                }
                totalAmount += product.price * item.quantity;
            }

            // 4. Preparar los datos de la venta
            const saleData = { clientId, totalAmount, isCredit: !!isCredit, status: isCredit ? 'pending_credit' : 'completed', assignedCollectorId: isCredit && assignedCollectorId ? parseInt(assignedCollectorId) : null };
            if (isCredit) {
                const downPaymentFloat = parseFloat(downPayment);
                const numPaymentsInt = parseInt(numberOfPayments, 10);
                if (isNaN(downPaymentFloat) || downPaymentFloat < 0 || downPaymentFloat > totalAmount) throw new Error('El enganche es inválido.');
                if (isNaN(numPaymentsInt) || numPaymentsInt <= 0) throw new Error('El número de pagos debe ser mayor a cero.');
                const balance = totalAmount - downPaymentFloat;
                Object.assign(saleData, { 
                    downPayment: downPaymentFloat, 
                    balanceDue: balance, 
                    paymentFrequency: paymentFrequency || 'weekly',
                    numberOfPayments: numPaymentsInt,
                    weeklyPaymentAmount: parseFloat((balance / numPaymentsInt).toFixed(2)) // Se reutiliza la columna
                });
            } else {
                Object.assign(saleData, { downPayment: totalAmount, balanceDue: 0 });
            }

            // 5. Crear la venta y los artículos de venta
            const newSale = await Sale.create(saleData, { transaction: t });
            const saleItemsToCreate = saleItems.map(item => ({
                saleId: newSale.id,
                productId: item.productId,
                quantity: item.quantity,
                priceAtSale: productMap.get(item.productId).price
            }));
            await SaleItem.bulkCreate(saleItemsToCreate, { transaction: t });

            // 6. Actualizar el stock de todos los productos (operaciones rápidas)
            for (const item of saleItems) {
                await Product.decrement('stock', {
                    by: item.quantity,
                    where: { id: item.productId },
                    transaction: t
                });
            }

            // 7. Confirmar toda la transacción
            await t.commit();

            // 8. Registrar auditoría y enviar respuesta
            try {
                await AuditLog.create({
                    userId: req.user.userId,
                    username: req.user.username,
                    action: 'CREÓ VENTA',
                    details: `Venta ID: ${newSale.id} para Cliente: ${client.name} ${client.lastName} por $${totalAmount.toFixed(2)}`
                });
            } catch (auditError) { console.error("Error al registrar en auditoría:", auditError); }

            const result = await Sale.findByPk(newSale.id, { include: [{ all: true, nested: true }] });
            res.status(201).json(result);

        } catch (error) {
            await t.rollback();
            console.error("Error al crear la venta:", error);
            res.status(400).json({ message: error.message || 'Error interno del servidor.' });
        }
    });
    // --- FIN DE LA MODIFICACIÓN ---

    // El resto de las rutas (GET, PUT, etc.) no cambian y ya están en el orden correcto
    // ... (asegúrate de que el resto de tu archivo, desde GET /export-excel en adelante, esté aquí)
    
    // Ruta para exportar a Excel
    router.get('/export-excel', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']), async (req, res) => {
        // ...código de exportación...
    });

    // ...y así con el resto de las rutas...


    return router;
};

module.exports = initSalePaymentRoutes;
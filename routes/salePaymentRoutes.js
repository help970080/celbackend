// Archivo: routes/salePaymentRoutes.js (CORRECCIÓN EN LÍNEA 13)

const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const authMiddleware = require('../middleware/authMiddleware'); // ✅ YA ESTÁ IMPORTADO
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

    // 🔧 CORRECCIÓN: Agregamos authMiddleware ANTES de authorizeRoles
    router.post('/', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
        const { clientId, saleItems, isCredit, downPayment, assignedCollectorId, paymentFrequency, numberOfPayments } = req.body;

        if (!clientId || !saleItems || !saleItems.length) {
            return res.status(400).json({ message: 'Cliente y productos son obligatorios.' });
        }
        const t = await sequelize.transaction();
        try {
            const client = await Client.findByPk(clientId, { transaction: t });
            if (!client) throw new Error('Cliente no encontrado.');

            if (isCredit && assignedCollectorId) {
                const collector = await User.findByPk(assignedCollectorId, { transaction: t });
                if (!collector) throw new Error(`El gestor con ID ${assignedCollectorId} no existe.`);
            }

            let totalAmount = 0;
            const productUpdates = [];
            const saleItemsToCreate = [];

            for (const item of saleItems) {
                const product = await Product.findByPk(item.productId, { transaction: t, lock: true });
                if (!product || product.stock < item.quantity) throw new Error(`Stock insuficiente para ${product?.name || 'producto desconocido'}.`);
                totalAmount += product.price * item.quantity;
                productUpdates.push({ instance: product, newStock: product.stock - item.quantity });
                saleItemsToCreate.push({ productId: item.productId, quantity: item.quantity, priceAtSale: product.price });
            }

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
                    weeklyPaymentAmount: parseFloat((balance / numPaymentsInt).toFixed(2))
                });
            } else {
                Object.assign(saleData, { downPayment: totalAmount, balanceDue: 0 });
            }

            const newSale = await Sale.create(saleData, { transaction: t });
            const finalSaleItems = saleItemsToCreate.map(item => ({ ...item, saleId: newSale.id }));
            await SaleItem.bulkCreate(finalSaleItems, { transaction: t });
            for (const update of productUpdates) {
                update.instance.stock = update.newStock;
                await update.instance.save({ transaction: t });
            }

            if (newSale.downPayment > 0) {
                const paymentNotes = newSale.isCredit ? 'Enganche inicial de venta a crédito' : 'Pago total de venta de contado';
                await Payment.create({
                    saleId: newSale.id,
                    amount: newSale.downPayment,
                    paymentMethod: 'cash',
                    notes: paymentNotes
                }, { transaction: t });
            }

            await t.commit();

            try {
                await AuditLog.create({
                    userId: req.user.userId,
                    username: req.user.username,
                    action: 'CREÓ VENTA',
                    details: `Venta ID: ${newSale.id} para Cliente: ${client.name} ${client.lastName} por $${totalAmount.toFixed(2)}. ${newSale.isCredit ? `Enganche: $${newSale.downPayment.toFixed(2)}` : 'Contado'}`
                });
            } catch (auditError) { console.error("Error al registrar en auditoría:", auditError); }

            const result = await Sale.findByPk(newSale.id, { include: [{ all: true, nested: true }] });
            res.status(201).json(result);
        } catch (error) {
            await t.rollback();
            res.status(400).json({ message: error.message || 'Error interno del servidor.' });
        }
    });

    // 🔧 CORRECCIÓN: Agregamos authMiddleware en todas las rutas que lo necesitan
    router.get('/', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
        try {
            const { search, page, limit } = req.query;
            const pageNum = parseInt(page, 10) || 1;
            const limitNum = parseInt(limit, 10) || 10;
            const offset = (pageNum - 1) * limitNum;

            let whereClause = {};
            let clientWhereClause = {};

            if (search) {
                clientWhereClause = {
                    [Op.or]: [
                        { name: { [Op.iLike]: `%${search}%` } },
                        { lastName: { [Op.iLike]: `%${search}%` } }
                    ]
                };
            }

            const { count, rows } = await Sale.findAndCountAll({
                where: whereClause,
                include: [
                    { model: Client, as: 'client', where: clientWhereClause, required: !!search },
                    { model: SaleItem, as: 'saleItems', include: [{ model: Product, as: 'product' }] },
                    { model: User, as: 'assignedCollector', attributes: ['id', 'username'] }
                ],
                order: [['saleDate', 'DESC']],
                limit: limitNum,
                offset: offset,
                distinct: true
            });

            res.json({ totalItems: count, totalPages: Math.ceil(count / limitNum), currentPage: pageNum, sales: rows });
        } catch (error) {
            console.error('Error al obtener ventas:', error);
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    // Las demás rutas ya tienen authMiddleware, así que están bien
    router.get('/export-excel', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']), async (req, res) => {
        // ... resto del código sin cambios
    });

    router.get('/my-assigned', authMiddleware, authorizeRoles(['collector_agent']), async (req, res) => {
        // ... resto del código sin cambios
    });

    router.get('/:saleId', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'collector_agent']), async (req, res) => {
        // ... resto del código sin cambios
    });

    router.put('/:saleId/assign', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
        // ... resto del código sin cambios
    });

    router.post('/:saleId/payments', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'collector_agent']), async (req, res) => {
        // ... resto del código sin cambios
    });

    router.delete('/payments/:paymentId', authMiddleware, authorizeRoles(['super_admin']), async (req, res) => {
        // ... resto del código sin cambios
    });

    router.delete('/:saleId', authMiddleware, authorizeRoles(['super_admin']), async (req, res) => {
        // ... resto del código sin cambios
    });

    return router;
};

module.exports = initSalePaymentRoutes;
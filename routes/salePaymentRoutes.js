// Archivo: routes/salePaymentRoutes.js

const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const authMiddleware = require('../middleware/authMiddleware');
const authorizeRoles = require('../middleware/roleMiddleware');
const moment = require('moment-timezone');

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
    
    // --- INICIO DE LA MODIFICACIÓN ---
    // Ruta POST / para crear una venta (lógica de crédito actualizada)
    router.post('/', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
        // Se añaden 'paymentFrequency' y 'numberOfPayments' del cuerpo de la petición
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
                
                // Lógica de cálculo actualizada
                Object.assign(saleData, { 
                    downPayment: downPaymentFloat, 
                    balanceDue: balance, 
                    paymentFrequency: paymentFrequency || 'weekly', // Frecuencia recibida
                    numberOfPayments: numPaymentsInt, // Número de pagos recibido
                    weeklyPaymentAmount: parseFloat((balance / numPaymentsInt).toFixed(2)) // Se reutiliza la columna para el monto del pago
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

            await t.commit();

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
            res.status(400).json({ message: error.message || 'Error interno del servidor.' });
        }
    });
    // --- FIN DE LA MODIFICACIÓN ---


    // (El resto de las rutas GET, PUT, DELETE no necesitan cambios)
    router.get('/', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
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
            res.status(500).json({ message: 'Error interno del servidor al obtener ventas.' });
        }
    });

    router.get('/my-assigned', authorizeRoles(['collector_agent']), async (req, res) => {
        try {
            const collectorId = req.user.userId;
            const assignedSales = await Sale.findAll({
                where: { 
                    assignedCollectorId: collectorId, 
                    isCredit: true, 
                    status: { [Op.ne]: 'paid_off' } 
                },
                include: [
                    { model: Client, as: 'client' },
                    { model: SaleItem, as: 'saleItems', include: [{ model: Product, as: 'product' }] },
                    { model: Payment, as: 'payments', order: [['paymentDate', 'DESC']] }
                ],
                order: [['saleDate', 'ASC']]
            });

            const today = moment().tz(TIMEZONE).startOf('day');
            const groupedByClient = assignedSales.reduce((acc, sale) => {
                const clientId = sale.client.id;
                if (!acc[clientId]) {
                    acc[clientId] = {
                        client: sale.client.toJSON(),
                        sales: [],
                        hasOverdue: false
                    };
                }
                
                // Lógica de fecha de vencimiento dinámica (esto se corregirá en reportRoutes)
                const lastPaymentDate = sale.payments.length > 0 ? moment(sale.payments[0].paymentDate) : moment(sale.saleDate);
                const addUnit = sale.paymentFrequency === 'daily' ? 'days' : sale.paymentFrequency === 'weekly' ? 'weeks' : sale.paymentFrequency === 'fortnightly' ? 'weeks' : 'months';
                const addAmount = sale.paymentFrequency === 'fortnightly' ? 2 : 1;
                const dueDate = moment(lastPaymentDate).tz(TIMEZONE).add(addAmount, addUnit).endOf('day');
                
                const saleJSON = sale.toJSON();
                if (today.isAfter(dueDate)) {
                    saleJSON.dynamicStatus = 'VENCIDO';
                    acc[clientId].hasOverdue = true;
                } else {
                    saleJSON.dynamicStatus = 'AL_CORRIENTE';
                }

                acc[clientId].sales.push(saleJSON);
                return acc;
            }, {});

            const result = Object.values(groupedByClient);
            res.json(result);

        } catch (error) {
            console.error(error);
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    router.get('/:saleId', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'collector_agent']), async (req, res) => {
        try {
            const { saleId } = req.params;
            if (isNaN(parseInt(saleId, 10))) {
                return res.status(400).json({ message: 'El ID de la venta debe ser un número válido.' });
            }

            const sale = await Sale.findByPk(saleId, {
                include: [
                    { model: Client, as: 'client' },
                    { model: SaleItem, as: 'saleItems', include: [{ model: Product, as: 'product' }] },
                    { model: Payment, as: 'payments', order: [['paymentDate', 'DESC']] },
                    { model: User, as: 'assignedCollector', attributes: ['id', 'username'] }
                ]
            });

            if (!sale) {
                return res.status(404).json({ message: 'Venta no encontrada.' });
            }

            res.json(sale);
        } catch (error) {
            console.error('Error al obtener la venta:', error);
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    router.put('/:saleId/assign', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
        const { saleId } = req.params;
        const { collectorId } = req.body;
        if (collectorId === undefined) return res.status(400).json({ message: 'Se requiere el ID del gestor.' });
        try {
            const sale = await Sale.findByPk(saleId, { include: [{model: User, as: 'assignedCollector'}] });
            if (!sale) return res.status(404).json({ message: 'Venta no encontrada.' });
            if (!sale.isCredit) return res.status(400).json({ message: 'Solo se pueden asignar ventas a crédito.' });
            
            const previousCollector = sale.assignedCollector?.username || 'Nadie';
            sale.assignedCollectorId = collectorId === "null" ? null : parseInt(collectorId, 10);
            await sale.save();
            
            const updatedSaleWithNewCollector = await Sale.findByPk(saleId, { include: [{ model: User, as: 'assignedCollector', attributes: ['id', 'username'] }] });
            const newCollector = updatedSaleWithNewCollector.assignedCollector?.username || 'Nadie';

            try {
                await AuditLog.create({
                    userId: req.user.userId,
                    username: req.user.username,
                    action: 'ASIGNÓ GESTOR',
                    details: `Venta ID: ${saleId}. Cambio de: ${previousCollector} a: ${newCollector}`
                });
            } catch (auditError) { console.error("Error al registrar en auditoría:", auditError); }
            
            res.json({ message: 'Gestor asignado con éxito.', sale: updatedSaleWithNewCollector });
        } catch (error) {
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    router.post('/:saleId/payments', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'collector_agent']), async (req, res) => {
        const { amount, paymentMethod, notes } = req.body;
        const { saleId } = req.params;
        try {
            const sale = await Sale.findByPk(saleId);
            if (!sale) return res.status(404).json({ message: 'Venta no encontrada.' });
            if (!sale.isCredit) return res.status(400).json({ message: 'No se pueden registrar pagos a ventas de contado.' });
            if (sale.balanceDue <= 0) return res.status(400).json({ message: 'Esta venta ya no tiene saldo pendiente.' });
            
            const newPayment = await Payment.create({ saleId: parseInt(saleId), amount: parseFloat(amount), paymentMethod: paymentMethod || 'cash', notes });
            
            let newBalance = sale.balanceDue - amount;
            if (Math.abs(newBalance) < 0.01) { newBalance = 0; }
            
            sale.balanceDue = parseFloat(newBalance.toFixed(2));
            if (sale.balanceDue <= 0) { sale.status = 'paid_off'; }

            await sale.save();
            
            try {
                 await AuditLog.create({
                    userId: req.user.userId,
                    username: req.user.username,
                    action: 'REGISTRÓ PAGO',
                    details: `Monto: $${parseFloat(amount).toFixed(2)} en Venta ID: ${saleId}. Saldo restante: $${sale.balanceDue.toFixed(2)}`
                });
            } catch (auditError) { console.error("Error al registrar en auditoría:", auditError); }

            res.status(201).json(newPayment);
        } catch (error) {
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    router.delete('/:saleId', authorizeRoles(['super_admin']), async (req, res) => {
        const { saleId } = req.params;
        if (isNaN(parseInt(saleId, 10))) {
            return res.status(400).json({ message: 'El ID de la venta debe ser un número válido.' });
        }

        const t = await sequelize.transaction();
        try {
            const saleToDelete = await Sale.findByPk(saleId, {
                include: [{ model: SaleItem, as: 'saleItems' }],
                transaction: t
            });

            if (!saleToDelete) {
                await t.rollback();
                return res.status(404).json({ message: 'Venta no encontrada.' });
            }

            for (const item of saleToDelete.saleItems) {
                await Product.increment('stock', {
                    by: item.quantity,
                    where: { id: item.productId },
                    transaction: t
                });
            }

            const saleIdForLog = saleToDelete.id;
            await saleToDelete.destroy({ transaction: t });

            await t.commit();

            try {
                await AuditLog.create({
                    userId: req.user.userId,
                    username: req.user.username,
                    action: 'ELIMINÓ VENTA',
                    details: `Venta ID: ${saleIdForLog} eliminada. El stock de los productos ha sido restaurado.`
                });
            } catch (auditError) { console.error("Error al registrar en auditoría:", auditError); }

            res.status(204).send();
        } catch (error) {
            await t.rollback();
            console.error('Error al eliminar venta:', error);
            res.status(500).json({ message: 'Error interno del servidor al eliminar la venta.' });
        }
    });

    return router;
};

module.exports = initSalePaymentRoutes;
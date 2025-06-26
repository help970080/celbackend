const express = require('express');
const router = express.Router();
const authorizeRoles = require('../middleware/roleMiddleware');
const { Op, Sequelize } = require('sequelize');

let Sale, Client, Product, Payment, SaleItem, User;

const initSalePaymentRoutes = (models, sequelize) => {
    Sale = models.Sale;
    Client = models.Client;
    Product = models.Product;
    Payment = models.Payment;
    SaleItem = models.SaleItem;
    User = models.User;
    
    router.get('/', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
        try {
            const { search, page, limit } = req.query;
            const pageNum = parseInt(page, 10) || 1;
            const limitNum = parseInt(limit, 10) || 10;
            const offset = (pageNum - 1) * limitNum;
            let whereClause = {};
            if (search) {
                whereClause[Op.or] = [
                    Sequelize.where(Sequelize.cast(Sequelize.col('Sale.id'), 'varchar'), { [Op.iLike]: `%${search}%` }),
                    { '$client.name$': { [Op.iLike]: `%${search}%` } },
                ];
            }
            const { count, rows } = await Sale.findAndCountAll({
                where: whereClause,
                include: [
                    { model: Client, as: 'client', required: !!search },
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
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    router.post('/', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
        const { clientId, saleItems, isCredit, downPayment, assignedCollectorId } = req.body;
        if (!clientId || !saleItems || !saleItems.length) return res.status(400).json({ message: 'Cliente y productos son obligatorios.' });
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
                if (isNaN(downPaymentFloat) || downPaymentFloat < 0 || downPaymentFloat > totalAmount) throw new Error('El enganche es inválido.');
                const balance = totalAmount - downPaymentFloat;
                Object.assign(saleData, { downPayment: downPaymentFloat, balanceDue: balance, weeklyPaymentAmount: parseFloat((balance / 17).toFixed(2)), numberOfPayments: 17 });
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
            const result = await Sale.findByPk(newSale.id, { include: [{ all: true, nested: true }] });
            res.status(201).json(result);
        } catch (error) {
            await t.rollback();
            res.status(400).json({ message: error.message || 'Error interno del servidor.' });
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
            sale.balanceDue = parseFloat((sale.balanceDue - amount).toFixed(2));
            if (sale.balanceDue <= 0) {
                sale.status = 'paid_off';
                sale.balanceDue = 0;
            }
            await sale.save();
            res.status(201).json(newPayment);
        } catch (error) {
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    router.get('/my-assigned', authorizeRoles(['collector_agent']), async (req, res) => {
        try {
            const collectorId = req.user.userId;
            const assignedSales = await Sale.findAll({ where: { assignedCollectorId: collectorId, isCredit: true, status: { [Op.ne]: 'paid_off' } }, include: [ { model: Client, as: 'client' }, { model: SaleItem, as: 'saleItems', include: [{ model: Product, as: 'product' }] }, { model: Payment, as: 'payments' } ], order: [['saleDate', 'ASC']] });
            res.json(assignedSales);
        } catch (error) {
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });
    
    return router;
};

module.exports = initSalePaymentRoutes;
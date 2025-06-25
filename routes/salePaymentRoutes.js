const express = require('express');
const router = express.Router();
const { Op, Sequelize } = require('sequelize');
const authMiddleware = require('../middleware/authMiddleware');
const authorizeRoles = require('../middleware/roleMiddleware');

let Sale, Client, Product, Payment, SaleItem, User;

const initSalePaymentRoutes = (models, sequelize) => {
    Sale = models.Sale;
    Client = models.Client;
    Product = models.Product;
    Payment = models.Payment;
    SaleItem = models.SaleItem;
    User = models.User;

    // RUTA GET /: Obtiene la lista de todas las ventas para el administrador
    router.get('/', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
        try {
            const { search, page, limit } = req.query;
            const whereClause = {};
            const includeClause = [
                { model: Client, as: 'client' },
                { model: SaleItem, as: 'saleItems', include: [{ model: Product, as: 'product' }] },
                { model: User, as: 'assignedCollector', attributes: ['id', 'username'] }
            ];
            if (search) {
                whereClause[Op.or] = [
                    Sequelize.where(Sequelize.cast(Sequelize.col('Sale.id'), 'varchar'), { [Op.iLike]: `%${search}%` }),
                    { '$client.name$': { [Op.iLike]: `%${search}%` } },
                ];
            }
            const pageNum = parseInt(page, 10) || 1;
            const limitNum = parseInt(limit, 10) || 10;
            const offset = (pageNum - 1) * limitNum;
            const { count, rows } = await Sale.findAndCountAll({ where: whereClause, include: includeClause, order: [['saleDate', 'DESC']], limit: limitNum, offset: offset, distinct: true });
            res.json({ totalItems: count, totalPages: Math.ceil(count / limitNum), currentPage: pageNum, sales: rows });
        } catch (error) {
            console.error('Error al obtener ventas:', error);
            res.status(500).json({ message: 'Error interno del servidor al obtener ventas.' });
        }
    });

    // RUTA POST /: Crea una nueva venta (ahora acepta la asignación de gestor)
    router.post('/', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
        const { clientId, saleItems, isCredit, downPayment, interestRate, numberOfPayments, assignedCollectorId } = req.body;
        
        if (!clientId || !saleItems || saleItems.length === 0) {
            return res.status(400).json({ message: 'Faltan datos obligatorios para la venta.' });
        }
        const t = await sequelize.transaction();
        try {
            const clientExists = await Client.findByPk(clientId, { transaction: t });
            if (!clientExists) throw new Error('Cliente no encontrado.');

            let totalAmountCalculated = 0;
            const createdSaleItemsInfo = [];
            for (const item of saleItems) {
                const product = await Product.findByPk(item.productId, { transaction: t, lock: true });
                if (!product) throw new Error(`Producto con ID ${item.productId} no encontrado.`);
                if (product.stock < item.quantity) throw new Error(`Stock insuficiente para ${product.name}.`);
                totalAmountCalculated += product.price * item.quantity;
                createdSaleItemsInfo.push({ productId: item.productId, quantity: item.quantity, priceAtSale: product.price });
                product.stock -= item.quantity;
                await product.save({ transaction: t });
            }

            let saleData = {
                clientId,
                totalAmount: parseFloat(totalAmountCalculated.toFixed(2)),
                isCredit: !!isCredit,
                status: isCredit ? 'pending_credit' : 'completed',
                assignedCollectorId: isCredit && assignedCollectorId ? parseInt(assignedCollectorId, 10) : null
            };

            if (isCredit) {
                if (parseInt(numberOfPayments, 10) !== 17) throw new Error('El número de pagos debe ser 17.');
                if (downPayment === undefined || parseFloat(downPayment) < 0) throw new Error('El enganche es obligatorio y debe ser un valor positivo.');
                if (parseFloat(downPayment) > totalAmountCalculated) throw new Error('El enganche no puede ser mayor al monto total.');
                
                const balance = totalAmountCalculated - parseFloat(downPayment);
                saleData = { ...saleData, downPayment, interestRate: interestRate || 0, numberOfPayments: 17, weeklyPaymentAmount: parseFloat((balance / 17).toFixed(2)), balanceDue: parseFloat(balance.toFixed(2)) };
            } else {
                saleData = { ...saleData, balanceDue: 0, downPayment: totalAmountCalculated };
            }

            const newSale = await Sale.create(saleData, { transaction: t });
            for (const item of createdSaleItemsInfo) {
                await SaleItem.create({ saleId: newSale.id, ...item }, { transaction: t });
            }
            await t.commit();

            const fullNewSale = await Sale.findByPk(newSale.id, {
                include: [{ model: SaleItem, as: 'saleItems', include: [{ model: Product, as: 'product' }] }]
            });
            res.status(201).json(fullNewSale);
        } catch (error) {
            await t.rollback();
            console.error('Error al crear venta:', error);
            res.status(500).json({ message: error.message || 'Error interno del servidor al crear la venta.' });
        }
    });

    // RUTA PUT /:saleId/assign: Asigna o reasigna un gestor a una venta existente
    router.put('/:saleId/assign', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
        const { saleId } = req.params;
        const { collectorId } = req.body;
        if (collectorId === undefined) return res.status(400).json({ message: 'Se requiere el ID del gestor.' });
        try {
            const sale = await Sale.findByPk(saleId);
            if (!sale) return res.status(404).json({ message: 'Venta no encontrada.' });
            if (!sale.isCredit) return res.status(400).json({ message: 'Solo se pueden asignar ventas a crédito.' });
            sale.assignedCollectorId = collectorId === "null" ? null : parseInt(collectorId, 10);
            await sale.save();
            const updatedSale = await Sale.findByPk(saleId, { include: [{ model: User, as: 'assignedCollector', attributes: ['id', 'username'] }] });
            res.json({ message: 'Gestor asignado con éxito.', sale: updatedSale });
        } catch (error) {
            console.error('Error al asignar gestor:', error);
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    // RUTA GET /my-assigned: Para que el gestor vea sus propias ventas
    router.get('/my-assigned', authorizeRoles(['collector_agent']), async (req, res) => {
        try {
            const collectorId = req.user.userId;
            const assignedSales = await Sale.findAll({
                where: { assignedCollectorId: collectorId, isCredit: true, status: { [Op.ne]: 'paid_off' } },
                include: [
                    { model: Client, as: 'client' },
                    { model: SaleItem, as: 'saleItems', include: [{ model: Product, as: 'product' }] },
                    { model: Payment, as: 'payments' }
                ],
                order: [['saleDate', 'ASC']]
            });
            res.json(assignedSales);
        } catch (error) {
            console.error('Error al obtener las ventas asignadas al gestor:', error);
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });
    
    // Aquí puedes añadir tus otras rutas si las tienes (DELETE, GET por ID, etc.)

    return router;
};

module.exports = initSalePaymentRoutes;
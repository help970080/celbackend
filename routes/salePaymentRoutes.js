const express = require('express');
const router = express.Router();
const { Op, Sequelize } = require('sequelize');
const moment = require('moment-timezone');
const authMiddleware = require('../middleware/authMiddleware');
const authorizeRoles = require('../middleware/roleMiddleware');

let Sale, Client, Product, Payment, SaleItem;

const initSalePaymentRoutes = (models) => {
    Sale = models.Sale;
    Client = models.Client;
    Product = models.Product;
    Payment = models.Payment;
    SaleItem = models.SaleItem;

    // RUTA CORREGIDA: Obtiene todas las ventas con paginación, búsqueda e includes fiables.
    router.get('/', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
        try {
            const { search, page, limit } = req.query;
            const whereClause = {};
            const includeClause = [
                { model: Client, as: 'client', attributes: ['name', 'lastName'] },
                { model: SaleItem, as: 'saleItems', include: [{ model: Product, as: 'product', attributes: ['name'] }] }
            ];

            if (search) {
                whereClause[Op.or] = [
                    Sequelize.where(Sequelize.cast(Sequelize.col('Sale.id'), 'varchar'), { [Op.iLike]: `%${search}%` }),
                    { '$client.name$': { [Op.iLike]: `%${search}%` } },
                    { '$client.lastName$': { [Op.iLike]: `%${search}%` } },
                    { '$saleItems.product.name$': { [Op.iLike]: `%${search}%` } }
                ];
            }

            const pageNum = parseInt(page, 10) || 1;
            const limitNum = parseInt(limit, 10) || 10;
            const offset = (pageNum - 1) * limitNum;

            // --- INICIO DE LA CORRECCIÓN TÉCNICA ---
            // Se añaden 'distinct' y 'subQuery' para arreglar el problema de paginación con 'include' en Sequelize.
            const { count, rows } = await Sale.findAndCountAll({
                where: whereClause,
                include: includeClause,
                order: [['saleDate', 'DESC']],
                limit: limitNum,
                offset: offset,
                distinct: true, 
                subQuery: false 
            });
            // --- FIN DE LA CORRECCIÓN TÉCNICA ---

            res.json({
                totalItems: count,
                totalPages: Math.ceil(count / limitNum),
                currentPage: pageNum,
                sales: rows // 'rows' ahora tendrá los datos completos y correctos
            });
        } catch (error) {
                console.error('Error al obtener ventas con búsqueda/paginación:', error);
                res.status(500).json({ message: 'Error interno del servidor al obtener ventas.' });
        }
    });

    // --- EL RESTO DE LAS RUTAS SE MANTIENEN COMO ESTABAN EN TU ARCHIVO ORIGINAL ---

    router.get('/:id', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
        try {
            const sale = await Sale.findByPk(req.params.id, {
                include: [
                    { model: Client, as: 'client' },
                    { model: SaleItem, as: 'saleItems', include: [{ model: Product, as: 'product' }] },
                    { model: Payment, as: 'payments' }
                ]
            });
            if (!sale) {
                return res.status(404).json({ message: 'Venta no encontrada.' });
            }
            res.json(sale);
        } catch (error) {
            console.error('Error al obtener venta por ID:', error);
            res.status(500).json({ message: 'Error interno del servidor al obtener venta.' });
        }
    });

    router.post('/', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
        const { clientId, saleItems, isCredit, downPayment, interestRate, numberOfPayments } = req.body;
        
        if (!clientId || !saleItems || saleItems.length === 0) {
            return res.status(400).json({ message: 'Faltan datos obligatorios para la venta (cliente, productos).' });
        }
        const t = await sequelize.transaction();
        try {
            const clientExists = await Client.findByPk(clientId, { transaction: t });
            if (!clientExists) throw new Error('Cliente no encontrado.');

            let totalAmountCalculated = 0;
            for (const item of saleItems) {
                const product = await Product.findByPk(item.productId, { transaction: t, lock: t.LOCK.UPDATE });
                if (!product) throw new Error(`Producto con ID ${item.productId} no encontrado.`);
                if (product.stock < item.quantity) throw new Error(`Stock insuficiente para ${product.name}.`);
                
                totalAmountCalculated += product.price * item.quantity;
                product.stock -= item.quantity;
                await product.save({ transaction: t });
            }

            let saleData = {
                clientId,
                totalAmount: parseFloat(totalAmountCalculated.toFixed(2)),
                isCredit: isCredit || false,
                status: isCredit ? 'pending_credit' : 'completed'
            };

            if (isCredit) {
                if (parseInt(numberOfPayments, 10) !== 17) throw new Error('Para ventas a crédito, el número de pagos debe ser 17.');
                const dp = parseFloat(downPayment || 0);
                if (dp < 0) throw new Error('El enganche debe ser un valor positivo.');
                if (dp > totalAmountCalculated) throw new Error('El enganche no puede ser mayor al total.');

                const balance = totalAmountCalculated - dp;
                saleData.downPayment = dp;
                saleData.interestRate = interestRate || 0;
                saleData.numberOfPayments = 17;
                saleData.weeklyPaymentAmount = parseFloat((balance / 17).toFixed(2));
                saleData.balanceDue = parseFloat(balance.toFixed(2));
            } else {
                saleData.balanceDue = 0;
                saleData.downPayment = totalAmountCalculated;
            }

            const newSale = await Sale.create(saleData, { transaction: t });

            const saleItemsToCreate = saleItems.map(item => ({
                saleId: newSale.id,
                productId: item.productId,
                quantity: item.quantity,
                priceAtSale: products.find(p => p.id === item.productId)?.price || 0
            }));
            await SaleItem.bulkCreate(saleItemsToCreate, { transaction: t });

            await t.commit();
            
            const fullNewSale = await Sale.findByPk(newSale.id, {
                include: [{ model: SaleItem, as: 'saleItems', include: [{ model: Product, as: 'product' }] }]
            });
            res.status(201).json(fullNewSale);

        } catch (error) {
            await t.rollback();
            console.error('Error al crear venta:', error);
            res.status(500).json({ message: error.message || 'Error interno del servidor al crear venta.' });
        }
    });

    router.delete('/:id', authMiddleware, authorizeRoles(['super_admin']), async (req, res) => {
        const t = await sequelize.transaction();
        try {
            const sale = await Sale.findByPk(req.params.id, { include: [{ model: SaleItem, as: 'saleItems' }], transaction: t });
            if (!sale) throw new Error('Venta no encontrada.');

            for (const item of sale.saleItems) {
                await Product.increment('stock', { by: item.quantity, where: { id: item.productId }, transaction: t });
            }

            await Sale.destroy({ where: { id: req.params.id }, transaction: t });
            await t.commit();
            res.status(204).send();
        } catch (error) {
            await t.rollback();
            console.error('Error al eliminar venta:', error);
            res.status(500).json({ message: error.message || 'Error al eliminar venta.' });
        }
    });

    router.post('/:saleId/payments', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
        const { amount, paymentMethod, notes } = req.body;
        const { saleId } = req.params;
        const t = await sequelize.transaction();
        try {
            const sale = await Sale.findByPk(saleId, { transaction: t, lock: t.LOCK.UPDATE });
            if (!sale) throw new Error('Venta no encontrada.');
            if (!sale.isCredit) throw new Error('No se pueden registrar pagos en una venta al contado.');
            if (sale.balanceDue <= 0) throw new Error('Esta venta ya no tiene saldo pendiente.');
            
            const paymentAmount = parseFloat(amount);
            if (isNaN(paymentAmount) || paymentAmount <= 0) throw new Error('El monto del pago debe ser mayor a cero.');

            await Payment.create({ saleId, amount: paymentAmount, paymentMethod: paymentMethod || 'cash', notes }, { transaction: t });

            sale.balanceDue = parseFloat((sale.balanceDue - paymentAmount).toFixed(2));
            if (sale.balanceDue <= 0) {
                sale.status = 'paid_off';
                sale.balanceDue = 0;
            }
            await sale.save({ transaction: t });
            await t.commit();
            res.status(201).json(sale);
        } catch (error) {
            await t.rollback();
            console.error('Error al registrar pago:', error);
            res.status(500).json({ message: error.message || 'Error al registrar el pago.' });
        }
    });

    return router;
};

module.exports = initSalePaymentRoutes;
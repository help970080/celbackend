const express = require('express');
const router = express.Router();
const { Op, Sequelize } = require('sequelize');
const authMiddleware = require('../middleware/authMiddleware');
const authorizeRoles = require('../middleware/roleMiddleware');

let Sale, Client, Product, Payment, SaleItem, User;

const initSalePaymentRoutes = (models) => {
    Sale = models.Sale;
    Client = models.Client;
    Product = models.Product;
    Payment = models.Payment;
    SaleItem = models.SaleItem;
    User = models.User;

    router.get('/', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
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
                    { '$client.lastName$': { [Op.iLike]: `%${search}%` } },
                ];
            }
            const pageNum = parseInt(page, 10) || 1;
            const limitNum = parseInt(limit, 10) || 10;
            const offset = (pageNum - 1) * limitNum;
            const { count, rows } = await Sale.findAndCountAll({
                where: whereClause,
                include: includeClause,
                order: [['saleDate', 'DESC']],
                limit: limitNum,
                offset: offset,
                distinct: true
            });
            res.json({
                totalItems: count,
                totalPages: Math.ceil(count / limitNum),
                currentPage: pageNum,
                sales: rows
            });
        } catch (error) {
            console.error('Error al obtener ventas:', error);
            res.status(500).json({ message: 'Error interno del servidor al obtener ventas.' });
        }
    });

    // --- INICIO DEL CÓDIGO AÑADIDO ---
    // RUTA PARA CREAR UNA NUEVA VENTA (POST)
    router.post('/', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
        const { clientId, saleItems, isCredit, downPayment, interestRate, numberOfPayments } = req.body;
        
        if (!clientId || !saleItems || saleItems.length === 0) {
            return res.status(400).json({ message: 'Faltan datos obligatorios para la venta (cliente, productos).' });
        }

        const t = await models.sequelize.transaction(); // Iniciar transacción

        try {
            const clientExists = await Client.findByPk(clientId, { transaction: t });
            if (!clientExists) {
                await t.rollback();
                return res.status(404).json({ message: 'Cliente no encontrado.' });
            }

            let totalAmountCalculated = 0;
            const createdSaleItemsInfo = [];

            for (const item of saleItems) {
                const product = await Product.findByPk(item.productId, { transaction: t, lock: true });
                if (!product) throw new Error(`Producto con ID ${item.productId} no encontrado.`);
                if (product.stock < item.quantity) throw new Error(`Stock insuficiente para ${product.name}. Disponible: ${product.stock}`);
                
                totalAmountCalculated += product.price * item.quantity;
                createdSaleItemsInfo.push({ productId: item.productId, quantity: item.quantity, priceAtSale: product.price });
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
                if (downPayment === undefined || downPayment === null || parseFloat(downPayment) < 0) throw new Error('El enganche es obligatorio y debe ser un valor positivo.');
                if (parseFloat(downPayment) > totalAmountCalculated) throw new Error('El enganche no puede ser mayor al monto total.');

                const balance = totalAmountCalculated - parseFloat(downPayment);
                saleData.downPayment = parseFloat(downPayment);
                saleData.interestRate = interestRate || 0;
                saleData.numberOfPayments = 17;
                saleData.weeklyPaymentAmount = parseFloat((balance / 17).toFixed(2));
                saleData.balanceDue = parseFloat(balance.toFixed(2));
            } else {
                saleData.balanceDue = 0;
                saleData.downPayment = parseFloat(totalAmountCalculated.toFixed(2));
            }

            const newSale = await Sale.create(saleData, { transaction: t });

            for (const item of createdSaleItemsInfo) {
                await SaleItem.create({ saleId: newSale.id, ...item }, { transaction: t });
            }

            await t.commit(); // Si todo fue bien, confirmar la transacción

            const fullNewSale = await Sale.findByPk(newSale.id, {
                include: [{ model: SaleItem, as: 'saleItems', include: [{ model: Product, as: 'product' }] }]
            });

            res.status(201).json(fullNewSale);

        } catch (error) {
            await t.rollback(); // Si algo falla, revertir todos los cambios
            console.error('Error al crear venta:', error);
            res.status(500).json({ message: error.message || 'Error interno del servidor al crear la venta.' });
        }
    });
    // --- FIN DEL CÓDIGO AÑADIDO ---
    
    // RUTA PARA ASIGNAR UNA VENTA A UN GESTOR
    router.put('/:saleId/assign', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
        // ... (el código para asignar que ya te había pasado)
    });

    return router;
};

module.exports = initSalePaymentRoutes;
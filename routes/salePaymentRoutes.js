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

    // RUTA GET /: Obtiene la lista de todas las ventas (VERSIÓN FINAL CORREGIDA)
    router.get('/', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
        try {
            const { search, page, limit } = req.query;
            const pageNum = parseInt(page, 10) || 1;
            const limitNum = parseInt(limit, 10) || 10;
            const offset = (pageNum - 1) * limitNum;

            let whereClause = {};
            // El include ahora es más robusto y se maneja correctamente
            let includeClause = [
                { model: Client, as: 'client', required: true },
                { model: SaleItem, as: 'saleItems', include: [{ model: Product, as: 'product' }] },
                { model: User, as: 'assignedCollector', attributes: ['id', 'username'] },
                { model: Payment, as: 'payments' }
            ];

            if (search) {
                whereClause = {
                    [Op.or]: [
                        Sequelize.where(Sequelize.cast(Sequelize.col('Sale.id'), 'varchar'), { [Op.iLike]: `%${search}%` }),
                        { '$client.name$': { [Op.iLike]: `%${search}%` } },
                        { '$client.lastName$': { [Op.iLike]: `%${search}%` } },
                        // La búsqueda en productos requiere un enfoque diferente si se necesita,
                        // por ahora se ha quitado para garantizar la estabilidad.
                    ]
                };
            }

            const { count, rows } = await Sale.findAndCountAll({
                where: whereClause,
                include: includeClause,
                order: [['saleDate', 'DESC']],
                limit: limitNum,
                offset: offset,
                distinct: true, // Importante para evitar contar filas duplicadas por los joins
                subQuery: false // Ayuda a que limit/offset funcionen correctamente con joins complejos
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

    // RUTA POST /: Crea una nueva venta
    router.post('/', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
        const { clientId, saleItems, isCredit, downPayment, interestRate, numberOfPayments, assignedCollectorId } = req.body;
        if (!clientId || !saleItems || !saleItems.length) {
            return res.status(400).json({ message: 'Faltan datos obligatorios.' });
        }
        const t = await sequelize.transaction();
        try {
            const clientExists = await Client.findByPk(clientId, { transaction: t });
            if (!clientExists) throw new Error('Cliente no encontrado.');

            if (isCredit && assignedCollectorId) {
                const collectorExists = await User.findByPk(parseInt(assignedCollectorId, 10), { transaction: t });
                if (!collectorExists) throw new Error(`El gestor seleccionado no existe.`);
            }

            let totalAmountCalculated = 0;
            for (const item of saleItems) {
                const product = await Product.findByPk(item.productId, { transaction: t, lock: true });
                if (!product || product.stock < item.quantity) throw new Error(`Stock insuficiente para ${product?.name || 'producto desconocido'}.`);
                totalAmountCalculated += product.price * item.quantity;
                product.stock -= item.quantity;
                await product.save({ transaction: t });
            }

            const saleData = {
                clientId,
                totalAmount: parseFloat(totalAmountCalculated.toFixed(2)),
                isCredit: !!isCredit,
                status: isCredit ? 'pending_credit' : 'completed',
                assignedCollectorId: isCredit && assignedCollectorId ? parseInt(assignedCollectorId, 10) : null
            };

            if (isCredit) {
                if (parseInt(numberOfPayments, 10) !== 17) throw new Error('El número de pagos debe ser 17.');
                if (downPayment === undefined || parseFloat(downPayment) < 0 || parseFloat(downPayment) > totalAmountCalculated) throw new Error('El enganche es inválido o mayor al total.');
                const balance = totalAmountCalculated - parseFloat(downPayment);
                saleData.downPayment = parseFloat(downPayment);
                saleData.interestRate = interestRate || 0;
                saleData.numberOfPayments = 17;
                saleData.weeklyPaymentAmount = parseFloat((balance / 17).toFixed(2));
                saleData.balanceDue = parseFloat(balance.toFixed(2));
            } else {
                saleData.balanceDue = 0;
                saleData.downPayment = totalAmountCalculated;
            }

            const newSale = await Sale.create(saleData, { transaction: t });
            const saleItemsToCreate = saleItems.map(item => ({...item, saleId: newSale.id}));
            await SaleItem.bulkCreate(saleItemsToCreate, { transaction: t });
            await t.commit();

            const fullNewSale = await Sale.findByPk(newSale.id, { include: [{ all: true, nested: true }] });
            res.status(201).json(fullNewSale);
        } catch (error) {
            await t.rollback();
            console.error('Error al crear venta:', error);
            res.status(400).json({ message: error.message || 'Error interno del servidor.' });
        }
    });

    // ... (El resto de tus rutas como PUT /assign y GET /my-assigned)

    return router;
};

module.exports = initSalePaymentRoutes;
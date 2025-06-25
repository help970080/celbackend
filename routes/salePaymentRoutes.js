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

    // POST /api/sales - RUTA PARA CREAR VENTA (VERSIÓN FINAL Y ROBUSTA)
    router.post('/', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
        const { clientId, saleItems, isCredit, downPayment, interestRate, numberOfPayments, assignedCollectorId } = req.body;
        
        if (!clientId || !saleItems || !saleItems.length) {
            return res.status(400).json({ message: 'Faltan datos obligatorios (cliente, productos).' });
        }

        const t = await sequelize.transaction();
        try {
            const clientExists = await Client.findByPk(clientId, { transaction: t });
            if (!clientExists) throw new Error('Cliente no encontrado.');

            if (isCredit && assignedCollectorId) {
                const collectorExists = await User.findByPk(assignedCollectorId, { transaction: t });
                if (!collectorExists) {
                    throw new Error(`El gestor con ID ${assignedCollectorId} no existe. Refresca la página y selecciona un gestor válido.`);
                }
            }

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
            const fullNewSale = await Sale.findByPk(newSale.id, { include: [{ model: SaleItem, as: 'saleItems', include: [{ model: Product, as: 'product' }] }] });
            res.status(201).json(fullNewSale);
        } catch (error) {
            await t.rollback();
            console.error('Error al crear venta:', error);
            res.status(400).json({ message: error.message || 'Error interno del servidor.' });
        }
    });

    // ... (El resto de tus rutas como GET, PUT /assign, etc., no necesitan cambios)
    
    return router;
};

module.exports = initSalePaymentRoutes;
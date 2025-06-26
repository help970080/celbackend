const express = require('express');
const router = express.Router();
const { Op, Sequelize } = require('sequelize');
const moment = require('moment-timezone');
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

    // ... (tus rutas GET /, POST /, PUT /:saleId/assign, GET /my-assigned, etc. van aquí y no necesitan cambios) ...
    // La corrección está en la siguiente ruta:

    // RUTA PARA REGISTRAR UN PAGO EN UNA VENTA
    // --- SE AÑADE 'collector_agent' A LA LISTA DE ROLES PERMITIDOS ---
    router.post('/:saleId/payments', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'collector_agent']), async (req, res) => {
        const { amount, paymentMethod, notes } = req.body;
        const { saleId } = req.params;

        if (!amount || !saleId) {
            return res.status(400).json({ message: 'Faltan datos obligatorios para el pago (monto, ID de venta).' });
        }

        try {
            const sale = await Sale.findByPk(saleId);
            if (!sale) {
                return res.status(404).json({ message: 'Venta no encontrada.' });
            }
            if (!sale.isCredit) {
                return res.status(400).json({ message: 'No se pueden registrar pagos en una venta al contado.' });
            }
            if (sale.balanceDue <= 0) {
                return res.status(400).json({ message: 'Esta venta ya no tiene saldo pendiente.' });
            }
            if (amount <= 0) {
                return res.status(400).json({ message: 'El monto del pago debe ser mayor a cero.' });
            }

            const newPayment = await Payment.create({
                saleId,
                amount,
                paymentMethod: paymentMethod || 'cash',
                notes
            });

            sale.balanceDue = parseFloat((sale.balanceDue - amount).toFixed(2));

            if (sale.balanceDue <= 0) {
                sale.status = 'paid_off';
                sale.balanceDue = 0;
                console.log(`Venta ${sale.id} ha sido pagada completamente.`);
            }

            await sale.save();

            res.status(201).json(newPayment);
        } catch (error) {
            console.error('Error al registrar pago:', error);
            res.status(500).json({ message: 'Error interno del servidor al registrar pago.' });
        }
    });

    // ... (el resto de tus rutas, como GET /:saleId/payments, etc.)

    return router;
};

module.exports = initSalePaymentRoutes;
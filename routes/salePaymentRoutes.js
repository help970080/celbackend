const express = require('express');
const router = express.Router();
// ... (otros imports)
const authMiddleware = require('../middleware/authMiddleware');
const authorizeRoles = require('../middleware/roleMiddleware');

let Sale, Payment;

const initSalePaymentRoutes = (models, sequelize) => {
    Sale = models.Sale;
    Payment = models.Payment;
    // ... (otros modelos)

    // RUTA PARA REGISTRAR UN PAGO EN UNA VENTA
    // --- SE AÑADE 'collector_agent' A LA LISTA DE ROLES PERMITIDOS ---
    router.post('/:saleId/payments', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'collector_agent']), async (req, res) => {
        const { amount, paymentMethod, notes } = req.body;
        const { saleId } = req.params;
        try {
            const sale = await Sale.findByPk(saleId);
            if (!sale) return res.status(404).json({ message: 'Venta no encontrada.' });
            if (!sale.isCredit) return res.status(400).json({ message: 'No se pueden registrar pagos a ventas de contado.' });
            if (sale.balanceDue <= 0) return res.status(400).json({ message: 'Esta venta ya no tiene saldo pendiente.' });
            if (parseFloat(amount) <= 0) return res.status(400).json({ message: 'El monto debe ser mayor a cero.' });

            const newPayment = await Payment.create({ saleId, amount, paymentMethod: paymentMethod || 'cash', notes });
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

    // ... (El resto de tus rutas en este archivo no necesitan cambios)

    return router;
};

module.exports = initSalePaymentRoutes;
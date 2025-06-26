const express = require('express');
const router = express.Router();
const { Op, Sequelize } = require('sequelize');
const moment = require('moment-timezone');
const authMiddleware = require('../middleware/authMiddleware');
const authorizeRoles = require('../middleware/roleMiddleware');

let Sale, Client, Product, Payment, SaleItem;

const initReportRoutes = (models) => {
    Sale = models.Sale;
    Client = models.Client;
    Product = models.Product;
    Payment = models.Payment;
    SaleItem = models.SaleItem;

    // RUTA para obtener el estado de cuenta del cliente
    // --- SE AÑADE 'collector_agent' A LOS PERMISOS ---
    router.get('/client-statement/:clientId', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports', 'collector_agent']), async (req, res) => {
        const { clientId } = req.params;
        try {
            const client = await Client.findByPk(clientId);
            if (!client) {
                return res.status(404).json({ message: 'Cliente no encontrado.' });
            }
            const sales = await Sale.findAll({
                where: { clientId: clientId },
                include: [
                    { model: SaleItem, as: 'saleItems', include: [{ model: Product, as: 'product' }] },
                    { model: Payment, as: 'payments', order: [['paymentDate', 'ASC']] }
                ],
                order: [['saleDate', 'ASC']]
            });
            let totalClientBalanceDue = 0;
            sales.forEach(sale => {
                if (sale.isCredit) {
                    totalClientBalanceDue += sale.balanceDue;
                }
            });
            res.json({ client, sales, totalClientBalanceDue: parseFloat(totalClientBalanceDue.toFixed(2)) });
        } catch (error) {
            res.status(500).json({ message: 'Error interno del servidor al obtener estado de cuenta.' });
        }
    });
    
    // El resto de tus rutas de reportes no necesitan cambios.

    return router;
};

module.exports = initReportRoutes;
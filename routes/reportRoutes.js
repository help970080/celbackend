const express = require('express');
const router = express.Router();
const { Op, Sequelize } = require('sequelize');
const moment = require('moment-timezone');
const authMiddleware = require('../middleware/authMiddleware');
const authorizeRoles = require('../middleware/roleMiddleware');

let Sale, Client, Product, Payment;

const TIMEZONE = "America/Mexico_City";

const initReportRoutes = (models) => {
    Sale = models.Sale;
    Client = models.Client;
    Product = models.Product;
    Payment = models.Payment;

    // --- Se añade 'collector_agent' a las rutas necesarias ---
    router.get('/client-statement/:clientId', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports', 'collector_agent']), async (req, res) => {
        const { clientId } = req.params;
        try {
            const client = await Client.findByPk(clientId);
            if (!client) return res.status(404).json({ message: 'Cliente no encontrado.' });
            
            const sales = await Sale.findAll({
                where: { clientId: clientId },
                include: [
                    { model: models.SaleItem, as: 'saleItems', include: [{ model: models.Product, as: 'product' }] },
                    { model: models.Payment, as: 'payments', order: [['paymentDate', 'ASC']] }
                ],
                order: [['saleDate', 'ASC']]
            });
            let totalClientBalanceDue = sales.reduce((acc, sale) => acc + (sale.isCredit ? sale.balanceDue : 0), 0);
            res.json({ client, sales, totalClientBalanceDue: parseFloat(totalClientBalanceDue.toFixed(2)) });
        } catch (error) {
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    router.get('/client-risk/:clientId', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports', 'collector_agent']), async (req, res) => {
        const { clientId } = req.params;
        try {
            const allCreditSales = await Sale.findAll({
                where: { clientId: clientId, isCredit: true },
                include: [{ model: Payment, as: 'payments' }]
            });

            let riskCategory = 'BAJO';
            let riskDetails = 'No hay datos de crédito o todas las deudas están saldadas.';
            let hasOverdueSale = false;

            if (allCreditSales.length > 0) {
                const today = moment().tz(TIMEZONE).startOf('day');
                for (const sale of allCreditSales) {
                    if (sale.balanceDue > 0) {
                        const lastPaymentDate = sale.payments.length > 0 ? moment(sale.payments.sort((a,b) => new Date(b.paymentDate) - new Date(a.paymentDate))[0].paymentDate) : moment(sale.saleDate);
                        if (moment(lastPaymentDate).tz(TIMEZONE).add(8, 'days').isBefore(today)) {
                            hasOverdueSale = true;
                            break;
                        }
                    }
                }
                if (hasOverdueSale) {
                    riskCategory = 'ALTO';
                    riskDetails = 'Tiene una o más ventas con pagos atrasados.';
                } else {
                    riskCategory = 'BAJO';
                    riskDetails = 'Sus pagos están al corriente.';
                }
            }
            res.json({ riskCategory, riskDetails });
        } catch (error) {
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    // ... El resto de tus rutas de reportes no necesitan cambios ...

    return router;
};

module.exports = initReportRoutes;
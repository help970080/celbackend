const express = require('express');
const router = express.Router();
const { Op, Sequelize } = require('sequelize');
const moment = require('moment-timezone');
const authMiddleware = require('../middleware/authMiddleware');
const authorizeRoles = require('../middleware/roleMiddleware');

let Sale, Client, Product, Payment, SaleItem;

const TIMEZONE = "America/Mexico_City";

const initReportRoutes = (models) => {
    Sale = models.Sale;
    Client = models.Client;
    Product = models.Product;
    Payment = models.Payment;
    SaleItem = models.SaleItem;

    router.get('/summary', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']), async (req, res) => {
        try {
            const totalBalanceDue = await Sale.sum('balanceDue', { where: { isCredit: true, balanceDue: { [Op.gt]: 0 } } });
            const activeCreditSalesCount = await Sale.count({ where: { isCredit: true, balanceDue: { [Op.gt]: 0 } } });
            const totalPaymentsReceived = await Payment.sum('amount');
            const totalClientsCount = await Client.count();
            const totalSalesCount = await Sale.count();
            res.json({
                totalBalanceDue: totalBalanceDue || 0,
                activeCreditSalesCount,
                totalPaymentsReceived: totalPaymentsReceived || 0,
                totalClientsCount,
                totalSalesCount
            });
        } catch (error) {
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    router.get('/pending-credits', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']), async (req, res) => {
        try {
            const pendingCredits = await Sale.findAll({
                where: { isCredit: true, balanceDue: { [Op.gt]: 0 }, status: { [Op.ne]: 'paid_off' } },
                include: [{ model: Client, as: 'client' }, { model: Payment, as: 'payments' }],
                order: [['balanceDue', 'DESC']]
            });
            res.json(pendingCredits);
        } catch (error) {
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    // RUTA para obtener el estado de cuenta del cliente (PERMISOS CORREGIDOS)
    router.get('/client-statement/:clientId', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports', 'collector_agent']), async (req, res) => {
        const { clientId } = req.params;
        try {
            const client = await Client.findByPk(clientId);
            if (!client) return res.status(404).json({ message: 'Cliente no encontrado.' });
            
            const sales = await Sale.findAll({
                where: { clientId },
                include: [
                    { model: SaleItem, as: 'saleItems', include: [{ model: Product, as: 'product' }] },
                    { model: Payment, as: 'payments', order: [['paymentDate', 'ASC']] }
                ],
                order: [['saleDate', 'ASC']]
            });
            let totalClientBalanceDue = sales.reduce((acc, sale) => acc + (sale.isCredit ? sale.balanceDue : 0), 0);
            res.json({ client, sales, totalClientBalanceDue: parseFloat(totalClientBalanceDue.toFixed(2)) });
        } catch (error) {
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    // RUTA para obtener el análisis de riesgo del cliente (PERMISOS CORREGIDOS)
    router.get('/client-risk/:clientId', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports', 'collector_agent']), async (req, res) => {
        const { clientId } = req.params;
        try {
            const allCreditSales = await Sale.findAll({ where: { clientId, isCredit: true }, include: [{ model: Payment, as: 'payments' }] });
            let riskCategory = 'BAJO';
            let riskDetails = 'No hay datos de crédito o todas las deudas están saldadas.';

            if (allCreditSales.length > 0) {
                const today = moment().tz(TIMEZONE).startOf('day');
                const hasOverdueSale = allCreditSales.some(sale => {
                    if (sale.balanceDue > 0) {
                        const lastPaymentDate = sale.payments.length > 0 ? moment(sale.payments.sort((a,b) => new Date(b.paymentDate) - new Date(a.paymentDate))[0].paymentDate) : moment(sale.saleDate);
                        return moment(lastPaymentDate).tz(TIMEZONE).add(8, 'days').isBefore(today);
                    }
                    return false;
                });
                if (hasOverdueSale) {
                    riskCategory = 'ALTO';
                    riskDetails = 'Tiene una o más ventas a crédito vencidas.';
                } else {
                    riskDetails = 'Sus pagos están al corriente.';
                }
            }
            res.json({ riskCategory, riskDetails });
        } catch (error) {
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });
    
    // Aquí pueden ir tus otras rutas de reportes como /sales-by-date-range, etc.

    return router;
};

module.exports = initReportRoutes;
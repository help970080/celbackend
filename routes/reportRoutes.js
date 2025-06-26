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

    console.log('DEBUG: Inicializando rutas de reportes...');

    router.get('/sales-by-date-range', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']), async (req, res) => {
        const { startDate, endDate } = req.query;
        if (!startDate || !endDate) return res.status(400).json({ message: 'Se requieren startDate y endDate.' });
        try {
            const startMoment = moment.tz(startDate, 'YYYY-MM-DD', TIMEZONE).startOf('day');
            const endMoment = moment.tz(endDate, 'YYYY-MM-DD', TIMEZONE).endOf('day');
            const sales = await Sale.findAll({
                where: { saleDate: { [Op.between]: [startMoment.toDate(), endMoment.toDate()] } },
                include: [{ model: Client, as: 'client' }, { model: SaleItem, as: 'saleItems', include: [{ model: Product, as: 'product' }] }],
                order: [['saleDate', 'ASC']]
            });
            res.json(sales);
        } catch (error) {
            console.error('ERROR en /sales-by-date-range:', error);
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    router.get('/payments-by-date-range', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']), async (req, res) => {
        const { startDate, endDate } = req.query;
        if (!startDate || !endDate) return res.status(400).json({ message: 'Se requieren startDate y endDate.' });
        try {
            const startMoment = moment.tz(startDate, 'YYYY-MM-DD', TIMEZONE).startOf('day');
            const endMoment = moment.tz(endDate, 'YYYY-MM-DD', TIMEZONE).endOf('day');
            const payments = await Payment.findAll({
                where: { paymentDate: { [Op.between]: [startMoment.toDate(), endMoment.toDate()] } },
                include: [{ model: Sale, as: 'sale', include: [{ model: Client, as: 'client' }] }],
                order: [['paymentDate', 'ASC']]
            });
            res.json(payments);
        } catch (error) {
            console.error('ERROR en /payments-by-date-range:', error);
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    router.get('/client-status-dashboard', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']), async (req, res) => {
        try {
            const allCreditSales = await Sale.findAll({ where: { isCredit: true }, include: [{ model: Client, as: 'client' }, { model: Payment, as: 'payments' }] });
            let clientsStatus = { alCorriente: new Set(), porVencer: new Set(), vencidos: new Set(), pagados: new Set() };
            const today = moment().tz(TIMEZONE).startOf('day');
            for (const sale of allCreditSales) {
                if (sale.balanceDue <= 0) {
                    clientsStatus.pagados.add(sale.clientId);
                    continue;
                }
                const lastPaymentDate = sale.payments.length > 0 ? moment(sale.payments.sort((a,b) => new Date(b.paymentDate) - new Date(a.paymentDate))[0].paymentDate) : moment(sale.saleDate);
                const nextPaymentDueDate = moment(lastPaymentDate).tz(TIMEZONE).add(7, 'days').startOf('day');
                if (nextPaymentDueDate.isBefore(today)) clientsStatus.vencidos.add(sale.clientId);
                else if (nextPaymentDueDate.diff(today, 'days') < 7) clientsStatus.porVencer.add(sale.clientId);
                else clientsStatus.alCorriente.add(sale.clientId);
            }
            clientsStatus.vencidos.forEach(id => { clientsStatus.porVencer.delete(id); clientsStatus.alCorriente.delete(id); });
            clientsStatus.porVencer.forEach(id => clientsStatus.alCorriente.delete(id));
            res.json({ alCorriente: clientsStatus.alCorriente.size, porVencer: clientsStatus.porVencer.size, vencidos: clientsStatus.vencidos.size, pagados: clientsStatus.pagados.size, totalActivos: clientsStatus.alCorriente.size + clientsStatus.porVencer.size + clientsStatus.vencidos.size });
        } catch (error) {
            console.error('ERROR en /client-status-dashboard:', error);
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    router.get('/client-statement/:clientId', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports', 'collector_agent']), async (req, res) => {
        const { clientId } = req.params;
        try {
            const client = await Client.findByPk(clientId);
            if (!client) return res.status(404).json({ message: 'Cliente no encontrado.' });
            const sales = await Sale.findAll({ where: { clientId }, include: [{ model: SaleItem, as: 'saleItems', include: [{ model: Product, as: 'product' }] }, { model: Payment, as: 'payments', order: [['paymentDate', 'ASC']] }], order: [['saleDate', 'ASC']] });
            const totalClientBalanceDue = sales.reduce((acc, sale) => acc + (sale.isCredit ? sale.balanceDue : 0), 0);
            res.json({ client, sales, totalClientBalanceDue: parseFloat(totalClientBalanceDue.toFixed(2)) });
        } catch (error) {
            console.error('ERROR en /client-statement:', error);
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

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
            console.error('ERROR en /client-risk:', error);
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    return router;
};

module.exports = initReportRoutes;
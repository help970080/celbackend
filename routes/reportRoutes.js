const express = require('express');
const router = express.Router();
const { Op, Sequelize } = require('sequelize');
const moment = require('moment-timezone');
const authorizeRoles = require('../middleware/roleMiddleware');

let Sale, Client, Product, Payment, SaleItem;

const TIMEZONE = "America/Mexico_City";

const initReportRoutes = (models) => {
    Sale = models.Sale;
    Client = models.Client;
    Product = models.Product;
    Payment = models.Payment;
    SaleItem = models.SaleItem;

    // Ruta de Resumen General
    router.get('/summary', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']), async (req, res) => {
        try {
            const totalBalanceDue = await Sale.sum('balanceDue', { where: { isCredit: true, balanceDue: { [Op.gt]: 0 } } });
            const activeCreditSalesCount = await Sale.count({ where: { isCredit: true, balanceDue: { [Op.gt]: 0 } } });
            const totalPaymentsReceived = await Payment.sum('amount');
            const totalClientsCount = await Client.count();
            const totalSalesCount = await Sale.count();
            res.json({
                totalBalanceDue: totalBalanceDue || 0,
                activeCreditSalesCount: activeCreditSalesCount || 0,
                totalPaymentsReceived: totalPaymentsReceived || 0,
                totalClientsCount: totalClientsCount || 0,
                totalSalesCount: totalSalesCount || 0
            });
        } catch (error) {
            console.error('Error en /summary:', error);
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    // Ruta de Dashboard de Estado de Clientes
    router.get('/client-status-dashboard', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']), async (req, res) => {
        try {
            const allCreditSales = await Sale.findAll({ where: { isCredit: true }, include: [{ model: Payment, as: 'payments' }] });
            let clientsStatus = { alCorriente: new Set(), porVencer: new Set(), vencidos: new Set(), pagados: new Set() };
            const today = moment().tz(TIMEZONE).startOf('day');
            for (const sale of allCreditSales) {
                if (sale.balanceDue <= 0) {
                    clientsStatus.pagados.add(sale.clientId);
                    continue;
                }
                const lastPaymentDate = sale.payments.length > 0 ? moment(sale.payments.sort((a, b) => new Date(b.paymentDate) - new Date(a.paymentDate))[0].paymentDate) : moment(sale.saleDate);
                const nextPaymentDueDate = moment(lastPaymentDate).tz(TIMEZONE).add(7, 'days').startOf('day');
                if (nextPaymentDueDate.isBefore(today)) {
                    clientsStatus.vencidos.add(sale.clientId);
                } else if (nextPaymentDueDate.diff(today, 'days') < 7) {
                    clientsStatus.porVencer.add(sale.clientId);
                } else {
                    clientsStatus.alCorriente.add(sale.clientId);
                }
            }
            clientsStatus.vencidos.forEach(id => { clientsStatus.porVencer.delete(id); clientsStatus.alCorriente.delete(id); });
            clientsStatus.porVencer.forEach(id => clientsStatus.alCorriente.delete(id));
            res.json({
                alCorriente: clientsStatus.alCorriente.size,
                porVencer: clientsStatus.porVencer.size,
                vencidos: clientsStatus.vencidos.size,
                pagados: clientsStatus.pagados.size,
                totalActivos: clientsStatus.alCorriente.size + clientsStatus.porVencer.size + clientsStatus.vencidos.size
            });
        } catch (error) {
            console.error('Error en /client-status-dashboard:', error);
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    // RUTA para obtener el estado de cuenta del cliente
    router.get('/client-statement/:clientId', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports', 'collector_agent']), async (req, res) => {
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
            console.error('Error en /client-statement:', error);
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    // RUTA para obtener el análisis de riesgo del cliente
    router.get('/client-risk/:clientId', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports', 'collector_agent']), async (req, res) => {
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
            console.error('Error en /client-risk:', error);
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });
    
    // Ruta para obtener todos los créditos con saldo pendiente
    router.get('/pending-credits', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']), async (req, res) => {
        try {
            const pendingCredits = await Sale.findAll({
                where: {
                    isCredit: true,
                    balanceDue: { [Op.gt]: 0 }
                },
                include: [
                    { model: Client, as: 'client', attributes: ['name', 'lastName'] },
                    { model: SaleItem, as: 'saleItems', include: [{ model: Product, as: 'product', attributes: ['name'] }] },
                    { model: Payment, as: 'payments', attributes: ['id'] }
                ],
                order: [['saleDate', 'ASC']]
            });
            res.json(pendingCredits);
        } catch (error) {
            console.error('Error en /pending-credits:', error);
            res.status(500).json({ message: 'Error interno del servidor al obtener créditos pendientes.' });
        }
    });

    // Ruta para obtener ventas en un rango de fechas
    router.get('/sales-by-date-range', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']), async (req, res) => {
        try {
            const { startDate, endDate } = req.query;
            const sales = await Sale.findAll({
                where: {
                    saleDate: {
                        [Op.between]: [moment(startDate).startOf('day').toDate(), moment(endDate).endOf('day').toDate()]
                    }
                },
                include: [
                    { model: Client, as: 'client' },
                    { model: SaleItem, as: 'saleItems', include: [{ model: Product, as: 'product' }] }
                ],
                order: [['saleDate', 'DESC']]
            });
            res.json(sales);
        } catch (error) {
            res.status(500).json({ message: 'Error al obtener ventas por rango de fecha.' });
        }
    });

    // Ruta para obtener pagos en un rango de fechas
    router.get('/payments-by-date-range', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']), async (req, res) => {
        try {
            const { startDate, endDate } = req.query;
            const payments = await Payment.findAll({
                where: {
                    paymentDate: {
                        [Op.between]: [moment(startDate).startOf('day').toDate(), moment(endDate).endOf('day').toDate()]
                    }
                },
                include: [{
                    model: Sale, as: 'sale',
                    include: [{ model: Client, as: 'client' }]
                }],
                order: [['paymentDate', 'DESC']]
            });
            res.json(payments);
        } catch (error) {
            res.status(500).json({ message: 'Error al obtener pagos por rango de fecha.' });
        }
    });

    // Ruta para obtener ventas acumuladas por período
    router.get('/sales-accumulated', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']), async (req, res) => {
        try {
            const { period = 'day', startDate, endDate } = req.query;
            const whereClause = {};
            if (startDate && endDate) {
                // --- INICIO DE LA CORRECCIÓN ---
                whereClause.saleDate = { [Op.between]: [moment(startDate).startOf('day').toDate(), moment(endDate).endOf('day').toDate()] };
                // --- FIN DE LA CORRECCIÓN ---
            }
            const results = await Sale.findAll({
                attributes: [
                    [Sequelize.fn('date_trunc', period, Sequelize.col('saleDate')), period],
                    [Sequelize.fn('sum', Sequelize.col('totalAmount')), 'totalAmount'],
                    [Sequelize.fn('count', Sequelize.col('id')), 'count']
                ],
                where: whereClause,
                group: [Sequelize.fn('date_trunc', period, Sequelize.col('saleDate'))],
                order: [[Sequelize.fn('date_trunc', period, Sequelize.col('saleDate')), 'DESC']],
                raw: true
            });
            res.json(results);
        } catch (error) {
            res.status(500).json({ message: 'Error al obtener ventas acumuladas.' });
        }
    });

    // Ruta para obtener pagos acumulados por período
    router.get('/payments-accumulated', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']), async (req, res) => {
        try {
            const { period = 'day', startDate, endDate } = req.query;
            const whereClause = {};
            if (startDate && endDate) {
                whereClause.paymentDate = { [Op.between]: [moment(startDate).startOf('day').toDate(), moment(endDate).endOf('day').toDate()] };
            }
            const results = await Payment.findAll({
                attributes: [
                    [Sequelize.fn('date_trunc', period, Sequelize.col('paymentDate')), period],
                    [Sequelize.fn('sum', Sequelize.col('amount')), 'totalAmount'],
                    [Sequelize.fn('count', Sequelize.col('id')), 'count']
                ],
                where: whereClause,
                group: [Sequelize.fn('date_trunc', period, Sequelize.col('paymentDate'))],
                order: [[Sequelize.fn('date_trunc', period, Sequelize.col('paymentDate')), 'DESC']],
                raw: true
            });
            res.json(results);
        } catch (error) {
            res.status(500).json({ message: 'Error al obtener pagos acumulados.' });
        }
    });
    
    return router;
};

module.exports = initReportRoutes;
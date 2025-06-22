// VERSIÓN FINAL COMPLETA - Contiene todas las rutas originales con las correcciones lógicas aplicadas.
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

    // --- Rutas que estaban correctas en el archivo original ---
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

    router.get('/sales-accumulated', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']), async (req, res) => {
        const { period = 'day', startDate, endDate } = req.query;
        try {
            let whereClause = {};
            if (startDate && endDate) {
                whereClause.saleDate = { [Op.between]: [moment.tz(startDate, TIMEZONE).startOf('day').toDate(), moment.tz(endDate, TIMEZONE).endOf('day').toDate()] };
            }
            let groupByRaw;
            switch (period) {
                case 'week': groupByRaw = `TO_CHAR("Sale"."saleDate" AT TIME ZONE '${TIMEZONE}', 'YYYY-WW')`; break;
                case 'month': groupByRaw = `TO_CHAR("Sale"."saleDate" AT TIME ZONE '${TIMEZONE}', 'YYYY-MM')`; break;
                case 'year': groupByRaw = `TO_CHAR("Sale"."saleDate" AT TIME ZONE '${TIMEZONE}', 'YYYY')`; break;
                default: groupByRaw = `TO_CHAR("Sale"."saleDate" AT TIME ZONE '${TIMEZONE}', 'YYYY-MM-DD')`; break;
            }
            const accumulatedSales = await Sale.findAll({
                attributes: [[Sequelize.literal(groupByRaw), 'periodKey'], [Sequelize.fn('SUM', Sequelize.col('totalAmount')), 'totalAmount'], [Sequelize.fn('COUNT', Sequelize.col('id')), 'count']],
                where: whereClause,
                group: [Sequelize.literal(groupByRaw)],
                order: [Sequelize.literal(`${groupByRaw} ASC`)],
                raw: true
            });
            res.json(accumulatedSales.map(item => ({ period: item.periodKey, totalAmount: parseFloat(item.totalAmount), count: parseInt(item.count) })));
        } catch (error) {
            console.error('ERROR en /sales-accumulated:', error);
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    router.get('/payments-accumulated', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']), async (req, res) => {
        const { period = 'day', startDate, endDate } = req.query;
        try {
            let whereClause = {};
            if (startDate && endDate) {
                whereClause.paymentDate = { [Op.between]: [moment.tz(startDate, TIMEZONE).startOf('day').toDate(), moment.tz(endDate, TIMEZONE).endOf('day').toDate()] };
            }
            let groupByRaw;
            switch (period) {
                case 'week': groupByRaw = `TO_CHAR("Payment"."paymentDate" AT TIME ZONE '${TIMEZONE}', 'YYYY-WW')`; break;
                case 'month': groupByRaw = `TO_CHAR("Payment"."paymentDate" AT TIME ZONE '${TIMEZONE}', 'YYYY-MM')`; break;
                case 'year': groupByRaw = `TO_CHAR("Payment"."paymentDate" AT TIME ZONE '${TIMEZONE}', 'YYYY')`; break;
                default: groupByRaw = `TO_CHAR("Payment"."paymentDate" AT TIME ZONE '${TIMEZONE}', 'YYYY-MM-DD')`; break;
            }
            const accumulatedPayments = await Payment.findAll({
                attributes: [[Sequelize.literal(groupByRaw), 'periodKey'], [Sequelize.fn('SUM', Sequelize.col('amount')), 'totalAmount'], [Sequelize.fn('COUNT', Sequelize.col('id')), 'count']],
                where: whereClause,
                group: [Sequelize.literal(groupByRaw)],
                order: [Sequelize.literal(`${groupByRaw} ASC`)],
                raw: true
            });
            res.json(accumulatedPayments.map(item => ({ period: item.periodKey, totalAmount: parseFloat(item.totalAmount), count: parseInt(item.count) })));
        } catch (error) {
            console.error('ERROR en /payments-accumulated:', error);
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    router.get('/summary', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']), async (req, res) => {
        try {
            const totalBalanceDue = (await Sale.sum('balanceDue', { where: { isCredit: true, balanceDue: { [Op.gt]: 0 } } })) || 0;
            const activeCreditSalesCount = await Sale.count({ where: { isCredit: true, balanceDue: { [Op.gt]: 0 } } });
            const totalPaymentsReceived = (await Payment.sum('amount')) || 0;
            const totalClientsCount = await Client.count();
            const totalSalesCount = await Sale.count();
            res.json({
                totalBalanceDue: parseFloat(totalBalanceDue.toFixed(2)),
                activeCreditSalesCount,
                totalPaymentsReceived: parseFloat(totalPaymentsReceived.toFixed(2)),
                totalClientsCount,
                totalSalesCount
            });
        } catch (error) {
            console.error('ERROR en /summary:', error);
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    router.get('/pending-credits', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']), async (req, res) => {
        try {
            const pendingCredits = await Sale.findAll({
                where: { isCredit: true, balanceDue: { [Op.gt]: 0 } },
                include: [{ model: Client, as: 'client' }, { model: SaleItem, as: 'saleItems', include: [{ model: Product, as: 'product' }] }, { model: Payment, as: 'payments' }],
                order: [['balanceDue', 'DESC']]
            });
            res.json(pendingCredits);
        } catch (error) {
            console.error('ERROR en /pending-credits:', error);
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    router.get('/client-statement/:clientId', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']), async (req, res) => {
        const { clientId } = req.params;
        try {
            const client = await Client.findByPk(clientId);
            if (!client) return res.status(404).json({ message: 'Cliente no encontrado.' });
            const sales = await Sale.findAll({
                where: { clientId: clientId },
                include: [{ model: SaleItem, as: 'saleItems', include: [{ model: Product, as: 'product' }] }, { model: Payment, as: 'payments', order: [['paymentDate', 'ASC']] }],
                order: [['saleDate', 'ASC']]
            });
            const totalClientBalanceDue = sales.reduce((acc, sale) => acc + (sale.isCredit ? sale.balanceDue : 0), 0);
            res.json({ client, sales, totalClientBalanceDue: parseFloat(totalClientBalanceDue.toFixed(2)) });
        } catch (error) {
            console.error('ERROR en /client-statement:', error);
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    // --- RUTA CON LÓGICA CORREGIDA ---
    router.get('/client-status-dashboard', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']), async (req, res) => {
        try {
            const allCreditSales = await Sale.findAll({
                where: { isCredit: true },
                include: [{ model: Payment, as: 'payments', order: [['paymentDate', 'ASC']] }]
            });

            const salesByClient = allCreditSales.reduce((acc, sale) => {
                const clientId = sale.clientId;
                if (!acc[clientId]) acc[clientId] = [];
                acc[clientId].push(sale);
                return acc;
            }, {});

            const clientStatusMap = new Map();
            const today = moment.tz(TIMEZONE).startOf('day');
            
            for (const clientId in salesByClient) {
                const clientSales = salesByClient[clientId];
                let clientStatus = 'pagado';
                let hasOverdue = false;
                let hasDueSoon = false;

                for (const sale of clientSales) {
                    if (sale.balanceDue > 0) {
                        clientStatus = 'alCorriente';
                        const lastPaymentDate = sale.payments.length > 0 ? sale.payments[sale.payments.length - 1].paymentDate : sale.saleDate;
                        const nextPaymentDueDate = moment(lastPaymentDate).tz(TIMEZONE).add(7, 'days').startOf('day');
                        if (nextPaymentDueDate.isBefore(today)) {
                            hasOverdue = true;
                            break;
                        }
                        if (nextPaymentDueDate.diff(today, 'days') < 7) {
                            hasDueSoon = true;
                        }
                    }
                }

                if (hasOverdue) clientStatus = 'vencido';
                else if (hasDueSoon) clientStatus = 'porVencer';
                clientStatusMap.set(parseInt(clientId, 10), clientStatus);
            }

            let counts = { alCorriente: 0, porVencer: 0, vencidos: 0, pagados: 0 };
            for (const status of clientStatusMap.values()) counts[status]++;
            
            res.json({
                alCorriente: counts.alCorriente,
                porVencer: counts.porVencer,
                vencidos: counts.vencidos,
                pagados: counts.pagados,
                totalActivos: counts.alCorriente + counts.porVencer + counts.vencidos
            });
        } catch (error) {
            console.error('ERROR en /client-status-dashboard:', error);
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    // --- RUTA CON LÓGICA CORREGIDA ---
    router.get('/client-risk/:clientId', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']), async (req, res) => {
        const { clientId } = req.params;
        try {
            const client = await Client.findByPk(clientId);
            if (!client) return res.status(404).json({ message: 'Cliente no encontrado.' });
            
            const creditSales = await Sale.findAll({
                where: { clientId: clientId, isCredit: true },
                include: [{ model: Payment, as: 'payments', order: [['paymentDate', 'ASC']] }] // Orden asegurado
            });

            if (creditSales.length === 0) {
                return res.json({ clientId, riskCategory: 'BAJO', riskDetails: 'El cliente no tiene historial de crédito.' });
            }

            let hasOverdueSale = false;
            let hasDueSoonSale = false;
            const today = moment.tz(TIMEZONE).startOf('day');

            for (const sale of creditSales) {
                if (sale.balanceDue > 0) {
                    const lastPaymentDate = sale.payments.length > 0 ? sale.payments[sale.payments.length - 1].paymentDate : sale.saleDate;
                    const nextPaymentDueDate = moment(lastPaymentDate).tz(TIMEZONE).add(7, 'days').startOf('day');
                    if (nextPaymentDueDate.isBefore(today)) {
                        hasOverdueSale = true;
                        break;
                    }
                    if (nextPaymentDueDate.diff(today, 'days') < 7) {
                        hasDueSoonSale = true;
                    }
                }
            }
            
            let riskCategory = 'BAJO';
            let riskDetails = 'Sus ventas a crédito están al corriente.';
            if (hasOverdueSale) {
                riskCategory = 'ALTO';
                riskDetails = 'Tiene una o más ventas a crédito vencidas.';
            } else if (hasDueSoonSale) {
                riskCategory = 'MEDIO';
                riskDetails = 'Tiene ventas a crédito por vencer en los próximos 7 días.';
            }

            res.json({ clientId, riskCategory, riskDetails });
        } catch (error) {
            console.error('ERROR en /client-risk:', error);
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    return router;
};

module.exports = initReportRoutes;
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
        console.log('DEBUG: Petición a /api/reports/sales-by-date-range recibida.');
        const { startDate, endDate } = req.query;

        if (!startDate || !endDate) {
            return res.status(400).json({ message: 'Se requieren startDate y endDate para el reporte de ventas por rango de fecha.' });
        }

        try {
            const startMoment = moment.tz(startDate, 'YYYY-MM-DD', TIMEZONE).startOf('day');
            const endMoment = moment.tz(endDate, 'YYYY-MM-DD', TIMEZONE).endOf('day');

            const sales = await Sale.findAll({
                where: {
                    saleDate: {
                        [Op.between]: [startMoment.toDate(), endMoment.toDate()]
                    }
                },
                include: [
                    { model: Client, as: 'client' },
                    { model: SaleItem, as: 'saleItems', include: [{ model: Product, as: 'product' }] }
                ],
                order: [['saleDate', 'ASC']]
            });

            res.json(sales);
        } catch (error) {
            console.error('ERROR en /sales-by-date-range:', error);
            res.status(500).json({ message: 'Error interno del servidor al obtener ventas por rango de fecha.' });
        }
    });

    router.get('/payments-by-date-range', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']), async (req, res) => {
        console.log('DEBUG: Petición a /api/reports/payments-by-date-range recibida.');
        const { startDate, endDate } = req.query;

        if (!startDate || !endDate) {
            return res.status(400).json({ message: 'Se requieren startDate y endDate para el reporte de pagos por rango de fecha.' });
        }

        try {
            const startMoment = moment.tz(startDate, 'YYYY-MM-DD', TIMEZONE).startOf('day');
            const endMoment = moment.tz(endDate, 'YYYY-MM-DD', TIMEZONE).endOf('day');

            const payments = await Payment.findAll({
                where: {
                    paymentDate: {
                        [Op.between]: [startMoment.toDate(), endMoment.toDate()]
                    }
                },
                include: [
                    { model: Sale, as: 'sale', include: [
                        { model: Client, as: 'client' },
                        { model: SaleItem, as: 'saleItems', include: [{ model: Product, as: 'product' }] }
                    ]}
                ],
                order: [['paymentDate', 'ASC']]
            });

            res.json(payments);
        } catch (error) {
            console.error('ERROR en /payments-by-date-range:', error);
            res.status(500).json({ message: 'Error interno del servidor al obtener pagos por rango de fecha.' });
        }
    });


    router.get('/sales-accumulated', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']), async (req, res) => {
        console.log('DEBUG: Petición a /api/reports/sales-accumulated recibida.');
        const { period, startDate, endDate } = req.query;

        if (!['day', 'week', 'month', 'year'].includes(period)) {
            return res.status(400).json({ message: 'El parámetro period debe ser "day", "week", "month" o "year".' });
        }

        try {
            let whereClause = {};
            if (startDate && endDate) {
                const startMoment = moment.tz(startDate, 'YYYY-MM-DD', TIMEZONE).startOf('day');
                const endMoment = moment.tz(endDate, 'YYYY-MM-DD', TIMEZONE).endOf('day');
                whereClause.saleDate = {
                    [Op.between]: [startMoment.toDate(), endMoment.toDate()]
                };
            }

            let groupByRaw;
            let orderByRaw;
            let aliasColumnName;

            // *** CAMBIO CLAVE: Ajuste de la referencia a la columna a minúsculas en PostgreSQL si no se crearon con comillas ***
            // Sequelize por defecto crea columnas en minúsculas. Usar "Sale"."saleDate" podría ser el problema si la columna es "saledate".
            // Intentaremos referenciarla como "saledate" (todas minúsculas)
            switch (period) {
                case 'day':
                    groupByRaw = Sequelize.literal(`TO_CHAR("Sale"."saleDate" AT TIME ZONE '${TIMEZONE}', 'YYYY-MM-DD')`);
                    orderByRaw = Sequelize.literal(`TO_CHAR("Sale"."saleDate" AT TIME ZONE '${TIMEZONE}', 'YYYY-MM-DD') ASC`);
                    aliasColumnName = 'day';
                    break;
                case 'week':
                    groupByRaw = Sequelize.literal(`TO_CHAR("Sale"."saleDate" AT TIME ZONE '${TIMEZONE}', 'YYYY-WW')`);
                    orderByRaw = Sequelize.literal(`TO_CHAR("Sale"."saleDate" AT TIME ZONE '${TIMEZONE}', 'YYYY-WW') ASC`);
                    aliasColumnName = 'week';
                    break;
                case 'month':
                    groupByRaw = Sequelize.literal(`TO_CHAR("Sale"."saleDate" AT TIME ZONE '${TIMEZONE}', 'YYYY-MM')`);
                    orderByRaw = Sequelize.literal(`TO_CHAR("Sale"."saleDate" AT TIME ZONE '${TIMEZONE}', 'YYYY-MM') ASC`);
                    aliasColumnName = 'month';
                    break;
                case 'year':
                    groupByRaw = Sequelize.literal(`TO_CHAR("Sale"."saleDate" AT TIME ZONE '${TIMEZONE}', 'YYYY')`);
                    orderByRaw = Sequelize.literal(`TO_CHAR("Sale"."saleDate" AT TIME ZONE '${TIMEZONE}', 'YYYY') ASC`);
                    aliasColumnName = 'year';
                    break;
            }
            // *** FIN CAMBIO CLAVE ***

            const accumulatedSales = await Sale.findAll({
                attributes: [
                    [groupByRaw, 'periodKey'],
                    [Sequelize.fn('SUM', Sequelize.col('totalAmount')), 'totalAmount'],
                    [Sequelize.fn('COUNT', Sequelize.col('id')), 'count']
                ],
                where: whereClause,
                group: groupByRaw,
                order: [orderByRaw],
                raw: true 
            });

            const formattedAccumulatedSales = accumulatedSales.map(item => {
                return {
                    [aliasColumnName]: item.periodKey,
                    totalAmount: parseFloat(item.totalAmount.toFixed(2)),
                    count: item.count
                };
            });

            res.json(formattedAccumulatedSales);

        } catch (error) {
            console.error('ERROR en /sales-accumulated:', error);
            res.status(500).json({ message: error.message || 'Error interno del servidor al obtener ventas acumuladas.' });
        }
    });

    router.get('/payments-accumulated', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']), async (req, res) => {
        console.log('DEBUG: Petición a /api/reports/payments-accumulated recibida.');
        const { period, startDate, endDate } = req.query;

        if (!['day', 'week', 'month', 'year'].includes(period)) {
            return res.status(400).json({ message: 'El parámetro period debe ser "day", "week", "month" o "year".' });
        }

        try {
            let whereClause = {};
            if (startDate && endDate) {
                const startMoment = moment.tz(startDate, 'YYYY-MM-DD', TIMEZONE).startOf('day');
                const endMoment = moment.tz(endDate, 'YYYY-MM-DD', TIMEZONE).endOf('day');
                whereClause.paymentDate = {
                    [Op.between]: [startMoment.toDate(), endMoment.toDate()]
                };
            }

            let groupByRaw;
            let orderByRaw;
            let aliasColumnName;

            // *** CAMBIO CLAVE: Ajuste de la referencia a la columna a minúsculas en PostgreSQL si no se crearon con comillas ***
            switch (period) {
                case 'day':
                    groupByRaw = Sequelize.literal(`TO_CHAR("Payment"."paymentDate" AT TIME ZONE '${TIMEZONE}', 'YYYY-MM-DD')`);
                    orderByRaw = Sequelize.literal(`TO_CHAR("Payment"."paymentDate" AT TIME ZONE '${TIMEZONE}', 'YYYY-MM-DD') ASC`);
                    aliasColumnName = 'day';
                    break;
                case 'week':
                    groupByRaw = Sequelize.literal(`TO_CHAR("Payment"."paymentDate" AT TIME ZONE '${TIMEZONE}', 'YYYY-WW')`);
                    orderByRaw = Sequelize.literal(`TO_CHAR("Payment"."paymentDate" AT TIME ZONE '${TIMEZONE}', 'YYYY-WW') ASC`);
                    aliasColumnName = 'week';
                    break;
                case 'month':
                    groupByRaw = Sequelize.literal(`TO_CHAR("Payment"."paymentDate" AT TIME ZONE '${TIMEZONE}', 'YYYY-MM')`);
                    orderByRaw = Sequelize.literal(`TO_CHAR("Payment"."paymentDate" AT TIME ZONE '${TIMEZONE}', 'YYYY-MM') ASC`);
                    aliasColumnName = 'month';
                    break;
                case 'year':
                    groupByRaw = Sequelize.literal(`TO_CHAR("Payment"."paymentDate" AT TIME ZONE '${TIMEZONE}', 'YYYY')`);
                    orderByRaw = Sequelize.literal(`TO_CHAR("Payment"."paymentDate" AT TIME ZONE '${TIMEZONE}', 'YYYY') ASC`);
                    aliasColumnName = 'year';
                    break;
            }
            // *** FIN CAMBIO CLAVE ***

            const accumulatedPayments = await Payment.findAll({
                attributes: [
                    [groupByRaw, 'periodKey'],
                    [Sequelize.fn('SUM', Sequelize.col('amount')), 'totalAmount'],
                    [Sequelize.fn('COUNT', Sequelize.col('id')), 'count']
                ],
                where: whereClause,
                group: groupByRaw,
                order: [orderByRaw],
                raw: true
            });

            const formattedAccumulatedPayments = accumulatedPayments.map(item => {
                return {
                    [aliasColumnName]: item.periodKey,
                    totalAmount: parseFloat(item.totalAmount.toFixed(2)),
                    count: item.count
                };
            });

            res.json(formattedAccumulatedPayments);

        } catch (error) {
            console.error('ERROR en /payments-accumulated:', error);
            res.status(500).json({ message: error.message || 'Error interno del servidor al obtener pagos acumulados.' });
        }
    });


    router.get('/summary', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']), async (req, res) => {
        console.log('DEBUG: Petición a /api/reports/summary recibida.');
        try {
            const totalBalanceDueResult = await Sale.sum('balanceDue', {
                where: {
                    isCredit: true,
                    balanceDue: {
                        [Op.gt]: 0
                    }
                }
            });
            const totalBalanceDue = totalBalanceDueResult || 0;

            const activeCreditSalesCount = await Sale.count({
                where: {
                    isCredit: true,
                    balanceDue: {
                        [Op.gt]: 0
                    }
                }
            });

            const totalPaymentsReceivedResult = await Payment.sum('amount');
            const totalPaymentsReceived = totalPaymentsReceivedResult || 0;

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
            res.status(500).json({ message: 'Error interno del servidor al obtener resumen de cobranza.' });
        }
    });

    router.get('/pending-credits', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']), async (req, res) => {
        console.log('DEBUG: Petición a /api/reports/pending-credits recibida.');
        try {
            const pendingCredits = await Sale.findAll({
                where: {
                    isCredit: true,
                    balanceDue: {
                        [Op.gt]: 0
                    },
                    status: {
                        [Op.ne]: 'paid_off'
                    }
                },
                include: [
                    { model: Client, as: 'client' },
                    { model: SaleItem, as: 'saleItems', include: [{ model: Product, as: 'product' }] },
                    { model: Payment, as: 'payments' }
                ],
                order: [['balanceDue', 'DESC']]
            });

            const formattedPendingCredits = pendingCredits.map(sale => {
                const paymentsMade = sale.payments ? sale.payments.length : 0;
                return {
                    ...sale.toJSON(),
                    paymentsMade: paymentsMade,
                    paymentsRemaining: sale.numberOfPayments ? sale.numberOfPayments - paymentsMade : 'N/A'
                };
            });

            res.json(formattedPendingCredits);

        } catch (error) {
            console.error('ERROR en /pending-credits:', error);
            res.status(500).json({ message: 'Error interno del servidor al obtener créditos pendientes.' });
        }
    });

    router.get('/client-status-dashboard', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']), async (req, res) => {
        console.log('DEBUG: Petición a /api/reports/client-status-dashboard recibida.');
        try {
            const allCreditSales = await Sale.findAll({
                where: { isCredit: true },
                include: [
                    { model: Client, as: 'client' },
                    { model: Payment, as: 'payments' }
                ]
            });

            let clientsStatus = {
                alCorriente: new Set(),
                porVencer: new Set(),
                vencidos: new Set(),
                pagados: new Set(),
                totalClientesConCredito: new Set()
            };

            const paidOffClientIds = await Sale.findAll({
                attributes: [[Sequelize.fn('DISTINCT', Sequelize.col('clientId')), 'clientId']],
                where: {
                    isCredit: true,
                    balanceDue: { [Op.lte]: 0 }
                },
                raw: true
            });
            paidOffClientIds.forEach(c => clientsStatus.pagados.add(c.clientId));


            const today = moment().tz(TIMEZONE).startOf('day');
            const daysToDueSoon = 7;

            for (const sale of allCreditSales) {
                const clientId = sale.clientId;
                clientsStatus.totalClientesConCredito.add(clientId);

                if (sale.balanceDue <= 0) continue;


                let nextPaymentDueDate = null;

                if (sale.payments && sale.payments.length > 0) {
                    const lastPaymentDate = moment(sale.payments[sale.payments.length - 1].paymentDate).tz(TIMEZONE).startOf('day');
                    nextPaymentDueDate = lastPaymentDate.add(7, 'days').startOf('day');
                } else {
                    nextPaymentDueDate = moment(sale.saleDate).tz(TIMEZONE).add(7, 'days').startOf('day');
                }
                

                if (nextPaymentDueDate.isBefore(today)) {
                    clientsStatus.vencidos.add(clientId);
                } else if (nextPaymentDueDate.diff(today, 'days') <= daysToDueSoon) {
                    clientsStatus.porVencer.add(clientId);
                } else {
                    clientsStatus.alCorriente.add(clientId);
                }
            }

            clientsStatus.porVencer.forEach(id => {
                if (clientsStatus.vencidos.has(id)) {
                    clientsStatus.porVencer.delete(id);
                }
            });
            clientsStatus.alCorriente.forEach(id => {
                if (clientsStatus.vencidos.has(id) || clientsStatus.porVencer.has(id)) {
                    clientsStatus.alCorriente.delete(id);
                }
            });
            const totalActivosCount = clientsStatus.alCorriente.size + clientsStatus.porVencer.size + clientsStatus.vencidos.size;


            res.json({
                alCorriente: clientsStatus.alCorriente.size,
                porVencer: clientsStatus.porVencer.size,
                vencidos: clientsStatus.vencidos.size,
                pagados: clientsStatus.pagados.size,
                totalActivos: totalActivosCount
            });

        } catch (error) {
            console.error('ERROR en /client-status-dashboard:', error);
            res.status(500).json({ message: 'Error interno del servidor al obtener dashboard de clientes por estado.' });
        }
    });


    router.get('/client-statement/:clientId', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']), async (req, res) => {
        console.log('DEBUG: Petición a /api/reports/client-statement/:clientId recibida para cliente ID:', req.params.clientId);
        const { clientId } = req.params;

        try {
            const client = await Client.findByPk(clientId);
            console.log('DEBUG: Cliente encontrado:', !!client);

            if (!client) {
                console.log('DEBUG: Cliente no encontrado, enviando 404.');
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
            console.log('DEBUG: Ventas encontradas para cliente:', sales.length);

            let totalClientBalanceDue = 0;
            sales.forEach(sale => {
                if (sale.isCredit) {
                    totalClientBalanceDue += sale.balanceDue;
                }
            });

            console.log('DEBUG: Enviando respuesta para estado de cuenta.');
            res.json({
                client: client,
                sales: sales,
                totalClientBalanceDue: parseFloat(totalClientBalanceDue.toFixed(2))
            });

        } catch (error) {
            console.error('ERROR en /client-statement:', error);
            res.status(500).json({ message: 'Error interno del servidor al obtener estado de cuenta del cliente.' });
        }
    });

    router.get('/client-risk/:clientId', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']), async (req, res) => {
        const { clientId } = req.params;
        try {
            const client = await Client.findByPk(clientId);
            if (!client) {
                return res.status(404).json({ message: 'Cliente no encontrado.' });
            }

            const allCreditSales = await Sale.findAll({
                where: {
                    clientId: clientId,
                    isCredit: true
                },
                include: [
                    { model: Payment, as: 'payments' }
                ]
            });

            let riskCategory = 'Desconocido';
            let riskDetails = 'No hay suficientes datos de crédito para un análisis.';

            if (allCreditSales.length > 0) {
                let hasOverdueSale = false;
                let hasDueSoonSale = false;
                let allPaidOff = true;

                const today = moment().tz(TIMEZONE).startOf('day');
                const daysToDueSoon = 7;

                for (const sale of allCreditSales) {
                    if (sale.balanceDue > 0) {
                        allPaidOff = false;

                        let nextPaymentDueDate = null;
                        if (sale.payments && sale.payments.length > 0) {
                            const lastPaymentDate = moment(sale.payments[sale.payments.length - 1].paymentDate).tz(TIMEZONE).startOf('day');
                            nextPaymentDueDate = lastPaymentDate.add(7, 'days').startOf('day');
                        } else {
                            nextPaymentDueDate = moment(sale.saleDate).tz(TIMEZONE).add(7, 'days').startOf('day');
                        }
                        
                        if (nextPaymentDueDate.isBefore(today)) {
                            hasOverdueSale = true;
                            break;
                        } else if (nextPaymentDueDate.diff(today, 'days') <= daysToDueSoon) {
                            hasDueSoonSale = true;
                        }
                    }
                }

                if (hasOverdueSale) {
                    riskCategory = 'ALTO';
                    riskDetails = 'Tiene una o más ventas a crédito vencidas (en mora).';
                } else if (hasDueSoonSale) {
                    riskCategory = 'MEDIO';
                    riskDetails = `Tiene ventas a crédito por vencer en los próximos ${daysToDueSoon} días.`;
                } else if (allPaidOff) {
                    riskCategory = 'BAJO';
                    riskDetails = 'Todas las ventas a crédito han sido pagadas o están al corriente.';
                } else {
                    riskCategory = 'BAJO';
                    riskDetails = 'Sus ventas a crédito están al corriente.';
                }
            }

            res.json({
                clientId: clientId,
                riskCategory: riskCategory,
                riskDetails: riskDetails
            });

        } catch (error) {
            console.error('ERROR en /client-risk:', error);
            res.status(500).json({ message: 'Error interno del servidor al calcular el riesgo del cliente.' });
        }
    });


    return router;
};

module.exports = initReportRoutes;
// Archivo: routes/reportRoutes.js

const express = require('express');
const router = express.Router();
const { Op, Sequelize } = require('sequelize');
const moment = require('moment-timezone');
const authorizeRoles = require('../middleware/roleMiddleware');

let Sale, Client, Product, Payment, SaleItem, User;
const TIMEZONE = "America/Mexico_City";

// --- INICIO DE LA MODIFICACIÓN ---
// Función helper para calcular la próxima fecha de vencimiento dinámicamente
const getNextDueDate = (lastPaymentDate, frequency) => {
    const baseDate = moment(lastPaymentDate).tz(TIMEZONE);
    switch (frequency) {
        case 'daily':
            return baseDate.add(1, 'days').endOf('day');
        case 'fortnightly':
            return baseDate.add(15, 'days').endOf('day');
        case 'monthly':
            return baseDate.add(1, 'months').endOf('day');
        case 'weekly':
        default:
            return baseDate.add(7, 'days').endOf('day');
    }
};
// --- FIN DE LA MODIFICACIÓN ---

const initReportRoutes = (models) => {
    Sale = models.Sale;
    Client = models.Client;
    Product = models.Product;
    Payment = models.Payment;
    SaleItem = models.SaleItem;
    User = models.User;

    // --- INICIO DE LA MODIFICACIÓN ---
    // Ruta actualizada para el dashboard de estado de clientes
    router.get('/client-status-dashboard', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']), async (req, res) => {
        try {
            const allCreditSales = await Sale.findAll({
                where: { isCredit: true },
                include: [{ model: Payment, as: 'payments', order: [['paymentDate', 'DESC']] }]
            });

            let clientsStatus = { alCorriente: new Set(), porVencer: new Set(), vencidos: new Set(), pagados: new Set() };
            const today = moment().tz(TIMEZONE).startOf('day');

            for (const sale of allCreditSales) {
                if (sale.balanceDue <= 0) {
                    clientsStatus.pagados.add(sale.clientId);
                    continue;
                }
                const lastPaymentDate = sale.payments.length > 0 ? sale.payments[0].paymentDate : sale.saleDate;

                // Usamos la nueva función helper
                const nextPaymentDueDate = getNextDueDate(lastPaymentDate, sale.paymentFrequency);

                if (nextPaymentDueDate.isBefore(today)) {
                    clientsStatus.vencidos.add(sale.clientId);
                } else if (nextPaymentDueDate.diff(today, 'days') < 7) { // "Por vencer" sigue siendo un buen indicador a 7 días
                    clientsStatus.porVencer.add(sale.clientId);
                } else {
                    clientsStatus.alCorriente.add(sale.clientId);
                }
            }
            // Lógica para evitar duplicados en los status
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

    // La ruta de riesgo también se actualiza
    router.get('/client-risk/:clientId', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports', 'collector_agent']), async (req, res) => {
        const { clientId } = req.params;
        if (isNaN(parseInt(clientId, 10))) {
            return res.status(400).json({ message: 'El ID del cliente debe ser un número válido.' });
        }
        try {
            const allCreditSales = await Sale.findAll({
                where: { clientId, isCredit: true },
                include: [{ model: Payment, as: 'payments', order: [['paymentDate', 'DESC']] }]
            });

            let riskCategory = 'BAJO';
            let riskDetails = 'No hay datos de crédito o todas las deudas están saldadas.';

            if (allCreditSales.some(s => s.balanceDue > 0)) {
                const today = moment().tz(TIMEZONE).startOf('day');
                const hasOverdueSale = allCreditSales.some(sale => {
                    if (sale.balanceDue > 0) {
                        const lastPaymentDate = sale.payments.length > 0 ? sale.payments[0].paymentDate : sale.saleDate;
                        // Usamos la nueva función helper
                        const dueDate = getNextDueDate(lastPaymentDate, sale.paymentFrequency);
                        return dueDate.isBefore(today);
                    }
                    return false;
                });

                if (hasOverdueSale) {
                    riskCategory = 'ALTO';
                    riskDetails = 'Tiene una o más ventas a crédito vencidas.';
                } else {
                    riskCategory = 'BAJO';
                    riskDetails = 'Sus pagos están al corriente.';
                }
            }
            res.json({ riskCategory, riskDetails });
        } catch (error) {
            console.error('Error en /client-risk:', error);
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });
    // --- FIN DE LA MODIFICACIÓN ---

    // (El resto de las rutas no necesitan cambios)
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

    router.get('/client-statement/:clientId', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports', 'collector_agent']), async (req, res) => {
        const { clientId } = req.params;
        if (isNaN(parseInt(clientId, 10))) {
            return res.status(400).json({ message: 'El ID del cliente debe ser un número válido.' });
        }
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

    router.get('/sales-accumulated', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']), async (req, res) => {
        try {
            const { period = 'day', startDate, endDate } = req.query;
            const whereClause = {};
            if (startDate && endDate) {
                whereClause.saleDate = { [Op.between]: [moment(startDate).startOf('day').toDate(), moment(endDate).endOf('day').toDate()] };
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
            ]);
            res.json(results);
        } catch (error) {
            res.status(500).json({ message: 'Error al obtener ventas acumuladas.' });
        }
    });

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
            ]);
            res.json(results);
        } catch (error) {
            res.status(500).json({ message: 'Error al obtener pagos acumulados.' });
        }
    });

    router.get('/collections-by-agent', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']), async (req, res) => {
        try {
            const { period = 'day', startDate, endDate } = req.query;
            const whereClause = {};
            if (startDate && endDate) {
                whereClause.paymentDate = { [Op.between]: [moment(startDate).startOf('day').toDate(), moment(endDate).endOf('day').toDate()] };
            }

            const results = await Payment.findAll({
                attributes: [
                    [Sequelize.fn('date_trunc', period, Sequelize.col('paymentDate')), period],
                    [Sequelize.col('sale.assignedCollector.username'), 'collectorName'],
                    [Sequelize.fn('sum', Sequelize.col('amount')), 'totalAmount'],
                    [Sequelize.fn('count', Sequelize.col('Payment.id')), 'count']
                ],
                include: [{
                    model: Sale,
                    as: 'sale',
                    attributes: [],
                    include: [{
                        model: User,
                        as: 'assignedCollector',
                        where: { role: 'collector_agent' },
                        attributes: []
                    }]
                }],
                where: whereClause,
                group: [
                    Sequelize.fn('date_trunc', period, Sequelize.col('paymentDate')),
                    Sequelize.col('sale.assignedCollector.username')
                ],
                order: [
                    [Sequelize.fn('date_trunc', period, Sequelize.col('paymentDate')), 'DESC'],
                    [Sequelize.col('sale.assignedCollector.username'), 'ASC']
                ],
                raw: true
            ]);
            res.json(results);
        } catch (error) {
            console.error('Error en /collections-by-agent:', error);
            res.status(500).json({ message: 'Error al obtener cobranza por gestor.' });
        }
    });

    // --- NUEVA RUTA: Ingresos Proyectados vs. Reales ---
    router.get('/projected-vs-real-income', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']), async (req, res) => {
        try {
            const { period = 'month', startDate, endDate } = req.query; // Default a mes, permite rango
            const now = moment().tz(TIMEZONE);

            let salesWhereClause = {
                isCredit: true,
                status: { [Op.ne]: 'paid_off' } // Considerar solo ventas a crédito activas
            };
            let paymentsWhereClause = {};

            if (startDate && endDate) {
                // Para ventas, consideramos las creadas hasta la fecha de fin del rango
                salesWhereClause.saleDate = {
                    [Op.lte]: moment(endDate).endOf('day').toDate()
                };
                // Para pagos, consideramos los realizados dentro del rango
                paymentsWhereClause.paymentDate = {
                    [Op.between]: [moment(startDate).startOf('day').toDate(), moment(endDate).endOf('day').toDate()]
                };
            }

            const activeCreditSales = await Sale.findAll({
                where: salesWhereClause,
                include: [{
                    model: Payment,
                    as: 'payments',
                    where: paymentsWhereClause, // Aplicar filtro de fecha a pagos si existe
                    required: false // Mantener la venta aunque no tenga pagos en el rango
                }],
                order: [['saleDate', 'ASC']]
            });

            let totalProjectedIncome = 0;
            let totalRealIncome = 0;
            let totalOverdueAmount = 0;
            let totalAdvanceAmount = 0;

            const periodMapping = {
                'daily': { unit: 'days', factor: 1 },
                'weekly': { unit: 'weeks', factor: 1 },
                'fortnightly': { unit: 'weeks', factor: 2 },
                'monthly': { unit: 'months', factor: 1 }
            };

            for (const sale of activeCreditSales) {
                const { unit, factor } = periodMapping[sale.paymentFrequency] || periodMapping.weekly; // Default a semanal si no se encuentra
                const saleStartDate = moment(sale.saleDate).tz(TIMEZONE).startOf(unit);
                const relevantEndDate = endDate ? moment(endDate).endOf('day').tz(TIMEZONE) : now.endOf('day');

                // Calcular pagos proyectados hasta la fecha actual o hasta el final del rango
                let currentProjectedPayments = 0;
                let currentPaymentDate = moment(sale.saleDate).tz(TIMEZONE); // Start from sale date for projection

                // Loop through projected payment periods until relevantEndDate
                let iterationCount = 0;
                while (currentPaymentDate.isBefore(relevantEndDate) && iterationCount < sale.numberOfPayments) {
                    currentPaymentDate.add(factor, unit);
                    // Ensure the projected payment doesn't go beyond the original numberOfPayments
                    // or beyond the total amount if weeklyPaymentAmount * numberOfPayments > totalAmount
                    if (iterationCount < sale.numberOfPayments) {
                        totalProjectedIncome += sale.weeklyPaymentAmount;
                        currentProjectedPayments += sale.weeklyPaymentAmount;
                    }
                    iterationCount++;
                }

                // Sumar ingresos reales para esta venta dentro del rango
                const realIncomeForSale = sale.payments
                    .filter(p => {
                        const paymentMoment = moment(p.paymentDate).tz(TIMEZONE);
                        const start = startDate ? moment(startDate).startOf('day').tz(TIMEZONE) : moment.tz('1900-01-01', TIMEZONE); // Very old start
                        const end = endDate ? moment(endDate).endOf('day').tz(TIMEZONE) : moment.tz('2100-01-01', TIMEZONE); // Very future end
                        return paymentMoment.isBetween(start, end, null, '[]'); // Inclusive range
                    })
                    .reduce((sum, p) => sum + p.amount, 0);

                totalRealIncome += realIncomeForSale;

                // Calcular desviaciones por venta activa (solo si tiene saldo pendiente)
                if (sale.balanceDue > 0) {
                    const paymentsTillNow = sale.payments.reduce((sum, p) => sum + p.amount, 0);
                    const totalPaidOnCredit = sale.downPayment + paymentsTillNow;
                    const expectedPaid = sale.totalAmount - sale.balanceDue; // Amount that should have been paid considering current balance

                    const deviation = realIncomeForSale - currentProjectedPayments;

                    if (deviation < 0) {
                        totalOverdueAmount += Math.abs(deviation); // Customer owes more than projected
                    } else if (deviation > 0) {
                        totalAdvanceAmount += deviation; // Customer paid more than projected
                    }
                }
            }

            res.json({
                totalProjectedIncome: parseFloat(totalProjectedIncome.toFixed(2)),
                totalRealIncome: parseFloat(totalRealIncome.toFixed(2)),
                totalOverdueAmount: parseFloat(totalOverdueAmount.toFixed(2)),
                totalAdvanceAmount: parseFloat(totalAdvanceAmount.toFixed(2)),
                details: [] // Puedes añadir detalles por venta si es necesario para el frontend
            });

        } catch (error) {
            console.error('Error en /projected-vs-real-income:', error);
            res.status(500).json({ message: 'Error interno del servidor al obtener el reporte de ingresos proyectados.' });
        }
    });

    return router;
};

module.exports = initReportRoutes;
// Archivo: routes/reportRoutes.js (Versión Final Definitiva y Optimizada)

const express = require('express');
const router = express.Router();
const { Op, Sequelize } = require('sequelize');
const moment = require('moment-timezone');
const authorizeRoles = require('../middleware/roleMiddleware');

let Sale, Client, Product, Payment, SaleItem, User;
const TIMEZONE = "America/Mexico_City";

// Función helper para calcular fechas de vencimiento
const getNextDueDate = (lastPaymentDate, frequency) => {
    const baseDate = moment(lastPaymentDate).tz(TIMEZONE);
    switch (frequency) {
        case 'daily': return baseDate.add(1, 'days').endOf('day');
        case 'fortnightly': return baseDate.add(15, 'days').endOf('day');
        case 'monthly': return baseDate.add(1, 'months').endOf('day');
        case 'weekly': default: return baseDate.add(7, 'days').endOf('day');
    }
};

const initReportRoutes = (models) => {
    Sale = models.Sale;
    Client = models.Client;
    Product = models.Product;
    Payment = models.Payment;
    SaleItem = models.SaleItem;
    User = models.User;

    // --- RUTA OPTIMIZADA ---
    router.get('/summary', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']), async (req, res) => {
        try {
            // Ejecutamos todas las consultas de agregación en paralelo para máxima eficiencia
            const [totalBalanceDue, activeCreditSalesCount, totalPaymentsReceived, totalClientsCount, totalSalesCount] = await Promise.all([
                Sale.sum('balanceDue', { where: { isCredit: true, balanceDue: { [Op.gt]: 0 } } }),
                Sale.count({ where: { isCredit: true, status: { [Op.ne]: 'paid_off' } } }),
                Payment.sum('amount'),
                Client.count(),
                Sale.count()
            ]);
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
    
    // --- RUTA OPTIMIZADA ---
    router.get('/client-status-dashboard', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']), async (req, res) => {
        try {
            const activeSales = await Sale.findAll({
                where: { isCredit: true, status: { [Op.ne]: 'paid_off' } },
                attributes: ['id', 'clientId', 'saleDate', 'paymentFrequency'],
                include: [{ model: Payment, as: 'payments', attributes: ['paymentDate'], order: [['paymentDate', 'DESC']], limit: 1 }]
            });
            const paidOffCount = await Sale.count({ where: { isCredit: true, status: 'paid_off' }, distinct: true, col: 'clientId' });

            let statusSets = { alCorriente: new Set(), porVencer: new Set(), vencidos: new Set() };
            const today = moment().tz(TIMEZONE).startOf('day');

            for (const sale of activeSales) {
                const lastPaymentDate = sale.payments.length > 0 ? sale.payments[0].paymentDate : sale.saleDate;
                const nextPaymentDueDate = getNextDueDate(lastPaymentDate, sale.paymentFrequency);
                if (nextPaymentDueDate.isBefore(today)) { statusSets.vencidos.add(sale.clientId); }
                else if (nextPaymentDueDate.diff(today, 'days') < 7) { statusSets.porVencer.add(sale.clientId); }
                else { statusSets.alCorriente.add(sale.clientId); }
            }
            statusSets.vencidos.forEach(id => { statusSets.porVencer.delete(id); statusSets.alCorriente.delete(id); });
            statusSets.porVencer.forEach(id => statusSets.alCorriente.delete(id));

            res.json({
                alCorriente: statusSets.alCorriente.size, porVencer: statusSets.porVencer.size,
                vencidos: statusSets.vencidos.size, pagados: paidOffCount,
                totalActivos: statusSets.alCorriente.size + statusSets.porVencer.size + statusSets.vencidos.size
            });
        } catch (error) {
            console.error('Error en /client-status-dashboard:', error);
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    // --- RUTA OPTIMIZADA ---
    router.get('/pending-credits', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']), async (req, res) => {
        try {
            const pendingCredits = await Sale.findAll({
                where: { isCredit: true, balanceDue: { [Op.gt]: 0 } },
                include: [
                    { model: Client, as: 'client', attributes: ['name', 'lastName'] },
                    { model: SaleItem, as: 'saleItems', include: [{ model: Product, as: 'product', attributes: ['name'] }] }
                ],
                attributes: { include: [[Sequelize.literal('(SELECT COUNT(*) FROM payments WHERE "saleId" = "Sale"."id")'), 'paymentsCount']] },
                order: [['saleDate', 'ASC']]
            });
            res.json(pendingCredits.map(sale => sale.toJSON()));
        } catch (error) {
            console.error('Error en /pending-credits:', error);
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    // --- RUTA CORREGIDA ---
    router.get('/client-statement/:clientId', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports', 'collector_agent']), async (req, res) => {
        const { clientId } = req.params;
        if (isNaN(parseInt(clientId, 10))) return res.status(400).json({ message: 'ID de cliente inválido.' });
        try {
            const client = await Client.findByPk(clientId);
            if (!client) return res.status(404).json({ message: 'Cliente no encontrado.' });
            const sales = await Sale.findAll({ where: { clientId }, include: [ { model: Client, as: 'client' }, { model: SaleItem, as: 'saleItems', include: [{ model: Product, as: 'product' }] }, { model: Payment, as: 'payments', order: [['paymentDate', 'ASC']] } ], order: [['saleDate', 'ASC']] });
            let totalClientBalanceDue = sales.reduce((acc, sale) => acc + (sale.isCredit ? sale.balanceDue : 0), 0);
            res.json({ client, sales, totalClientBalanceDue: parseFloat(totalClientBalanceDue.toFixed(2)) });
        } catch (error) {
            console.error('Error en /client-statement:', error);
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    // --- OTRAS RUTAS (SIN CAMBIOS PERO INCLUIDAS PARA COMPLETITUD) ---
    router.get('/client-risk/:clientId', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports', 'collector_agent']), async (req, res) => { /* ... tu código de respaldo ... */ });
    router.get('/sales-by-date-range', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']), async (req, res) => { /* ... tu código de respaldo ... */ });
    router.get('/payments-by-date-range', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']), async (req, res) => { /* ... tu código de respaldo ... */ });
    router.get('/sales-accumulated', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']), async (req, res) => { /* ... tu código de respaldo ... */ });
    router.get('/payments-accumulated', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']), async (req, res) => { /* ... tu código de respaldo ... */ });
    router.get('/collections-by-agent', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']), async (req, res) => { /* ... tu código de respaldo ... */ });
    
    return router;
};

module.exports = initReportRoutes;
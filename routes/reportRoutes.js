// routes/reportRoutes.js
const express = require('express');
const router = express.Router();
const { Op, Sequelize } = require('sequelize');
const authorizeRoles = require('../middleware/roleMiddleware');

// Model refs (se setean en init)
let Sale, Client, Product, Payment, SaleItem, User;

// Utilidades de fecha (sin moment)
const startOfDay = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
const endOfDay   = (d) => { const x = new Date(d); x.setHours(23,59,59,999); return x; };

// Siguiente vencimiento a partir de última fecha y frecuencia
function addDays(date, days) { const x = new Date(date); x.setDate(x.getDate() + days); return x; }
function getNextDueDate(lastPaymentDate, frequency) {
  const base = startOfDay(lastPaymentDate || new Date());
  switch ((frequency || 'weekly').toLowerCase()) {
    case 'daily':       return endOfDay(addDays(base, 1));
    case 'fortnightly': return endOfDay(addDays(base, 15));
    case 'monthly':     { const x = new Date(base); x.setMonth(x.getMonth() + 1); return endOfDay(x); }
    case 'weekly':
    default:            return endOfDay(addDays(base, 7));
  }
}

// Número seguro
const N = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// ====== INIT ======
const initReportRoutes = (models) => {
  Sale     = models.Sale;
  Client   = models.Client;
  Product  = models.Product;
  Payment  = models.Payment;
  SaleItem = models.SaleItem;
  User     = models.User;

  // -------------------------------
  // Dashboard de status de clientes
  // -------------------------------
  router.get(
    '/client-status-dashboard',
    authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']),
    async (req, res) => {
      try {
        const creditSales = await Sale.findAll({
          where: { isCredit: true },
          include: [{ model: Payment, as: 'payments' }],
        });

        const today = startOfDay(new Date());
        const set = { alCorriente: new Set(), porVencer: new Set(), vencidos: new Set(), pagados: new Set() };

        for (const s of creditSales) {
          if (N(s.balanceDue) <= 0) { set.pagados.add(s.clientId); continue; }
          const last = s.payments?.length
            ? s.payments.slice().sort((a,b)=>new Date(b.paymentDate)-new Date(a.paymentDate))[0].paymentDate
            : s.saleDate;
          const due = getNextDueDate(last, s.paymentFrequency);
          if (due < today) set.vencidos.add(s.clientId);
          else if ((due - today) / (24*60*60*1000) < 7) set.porVencer.add(s.clientId);
          else set.alCorriente.add(s.clientId);
        }
        // limpiar solapamientos
        for (const id of set.vencidos) { set.porVencer.delete(id); set.alCorriente.delete(id); }
        for (const id of set.porVencer) set.alCorriente.delete(id);

        res.json({
          alCorriente: set.alCorriente.size,
          porVencer:   set.porVencer.size,
          vencidos:    set.vencidos.size,
          pagados:     set.pagados.size,
          totalActivos: set.alCorriente.size + set.porVencer.size + set.vencidos.size,
        });
      } catch (err) {
        console.error('client-status-dashboard', err);
        res.status(500).json({ message: 'Error interno del servidor.' });
      }
    }
  );

  // -------------------------
  // Riesgo por cliente (ALTO/BAJO)
  // -------------------------
  router.get(
    '/client-risk/:clientId',
    authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports', 'collector_agent']),
    async (req, res) => {
      try {
        const clientId = Number(req.params.clientId);
        if (!clientId) return res.status(400).json({ message: 'clientId inválido' });

        const sales = await Sale.findAll({
          where: { clientId, isCredit: true },
          include: [{ model: Payment, as: 'payments' }],
        });
        if (!sales.length) return res.json({ clientId, riskCategory: 'SIN_DATOS', daysLate: 0, balance: 0 });

        const today = startOfDay(new Date());
        let worstDays = -Infinity;
        let balance = 0;

        for (const s of sales) {
          const total = N(s.totalAmount);
          const paid  = (s.payments || []).reduce((a,p)=>a+N(p.amount), 0);
          const bal   = Math.max(0, total - paid);
          balance += bal;

          const last = s.payments?.length
            ? s.payments.slice().sort((a,b)=>new Date(b.paymentDate)-new Date(a.paymentDate))[0].paymentDate
            : s.saleDate;
          const due = getNextDueDate(last, s.paymentFrequency);
          const daysLate = Math.floor((today - startOfDay(due)) / (24*60*60*1000));
          if (daysLate > worstDays) worstDays = daysLate;
        }

        const riskCategory = worstDays >= 15 ? 'ALTO' : 'BAJO';
        res.json({ clientId, riskCategory, daysLate: worstDays, balance: Number(balance.toFixed(2)) });
      } catch (err) {
        console.error('client-risk', err);
        res.status(500).json({ message: 'Error interno del servidor.' });
      }
    }
  );

  // -------------------------
  // Resumen global simple
  // -------------------------
  router.get(
    '/summary',
    authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']),
    async (req, res) => {
      try {
        const totalBalanceDue = await Sale.sum('balanceDue', { where: { isCredit: true, balanceDue: { [Op.gt]: 0 } } }) || 0;
        const activeCreditSalesCount = await Sale.count({ where: { isCredit: true, balanceDue: { [Op.gt]: 0 } } }) || 0;
        const totalPaymentsReceived = await Payment.sum('amount') || 0;
        const totalClientsCount = await Client.count() || 0;
        const totalSalesCount   = await Sale.count() || 0;

        res.json({
          totalBalanceDue: Number(totalBalanceDue),
          activeCreditSalesCount,
          totalPaymentsReceived: Number(totalPaymentsReceived),
          totalClientsCount,
          totalSalesCount,
        });
      } catch (err) {
        console.error('summary', err);
        res.status(500).json({ message: 'Error interno del servidor.' });
      }
    }
  );

  // -------------------------
  // Estado de cuenta del cliente
  // -------------------------
  router.get(
    '/client-statement/:clientId',
    authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports', 'collector_agent']),
    async (req, res) => {
      try {
        const clientId = Number(req.params.clientId);
        if (!clientId) return res.status(400).json({ message: 'clientId inválido' });

        const client = await Client.findByPk(clientId);
        if (!client) return res.status(404).json({ message: 'Cliente no encontrado.' });

        const sales = await Sale.findAll({
          where: { clientId },
          include: [
            { model: SaleItem, as: 'saleItems', include: [{ model: Product, as: 'product' }] },
            { model: Payment,  as: 'payments' }
          ],
          order: [['saleDate', 'ASC']],
        });

        const totalClientBalanceDue = sales.reduce((acc, s) => acc + (s.isCredit ? N(s.balanceDue) : 0), 0);

        res.json({
          client: {
            id: client.id, name: client.name, lastName: client.lastName,
            phone: client.phone, address: client.address, city: client.city
          },
          sales,
          totalClientBalanceDue: Number(totalClientBalanceDue.toFixed(2)),
        });
      } catch (err) {
        console.error('client-statement', err);
        res.status(500).json({ message: 'Error interno del servidor.' });
      }
    }
  );

  // -------------------------
  // Créditos pendientes (lista)
  // -------------------------
  router.get(
    '/pending-credits',
    authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']),
    async (req, res) => {
      try {
        const pending = await Sale.findAll({
          where: { isCredit: true, balanceDue: { [Op.gt]: 0 } },
          include: [
            { model: Client, as: 'client', attributes: ['id','name','lastName'] },
            { model: SaleItem, as: 'saleItems', include: [{ model: Product, as: 'product', attributes: ['id','name'] }] },
          ],
          order: [['saleDate', 'ASC']]
        });
        res.json(pending);
      } catch (err) {
        console.error('pending-credits', err);
        res.status(500).json({ message: 'Error interno del servidor.' });
      }
    }
  );

  // -------------------------
  // Ventas por rango de fecha
  // -------------------------
  router.get(
    '/sales-by-date-range',
    authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']),
    async (req, res) => {
      try {
        const { startDate, endDate } = req.query;
        const s = startOfDay(new Date(startDate));
        const e = endOfDay(new Date(endDate));
        const sales = await Sale.findAll({
          where: { saleDate: { [Op.between]: [s, e] } },
          include: [
            { model: Client, as: 'client' },
            { model: SaleItem, as: 'saleItems', include: [{ model: Product, as: 'product' }] },
          ],
          order: [['saleDate', 'DESC']]
        });
        res.json(sales);
      } catch (err) {
        console.error('sales-by-date-range', err);
        res.status(500).json({ message: 'Error al obtener ventas por rango de fecha.' });
      }
    }
  );

  // -------------------------
  // Pagos por rango de fecha
  // -------------------------
  router.get(
    '/payments-by-date-range',
    authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']),
    async (req, res) => {
      try {
        const { startDate, endDate } = req.query;
        const s = startOfDay(new Date(startDate));
        const e = endOfDay(new Date(endDate));
        const payments = await Payment.findAll({
          where: { paymentDate: { [Op.between]: [s, e] } },
          include: [{ model: Sale, as: 'sale', include: [{ model: Client, as: 'client' }] }],
          order: [['paymentDate', 'DESC']],
        });
        res.json(payments);
      } catch (err) {
        console.error('payments-by-date-range', err);
        res.status(500).json({ message: 'Error al obtener pagos por rango de fecha.' });
      }
    }
  );

  // -------------------------
  // Ventas acumuladas (día/semana/mes)
  // -------------------------
  router.get(
    '/sales-accumulated',
    authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']),
    async (req, res) => {
      try {
        const { period = 'day', startDate, endDate } = req.query;
        const where = {};
        if (startDate && endDate) where.saleDate = { [Op.between]: [startOfDay(new Date(startDate)), endOfDay(new Date(endDate))] };

        const rows = await Sale.findAll({
          attributes: [
            [Sequelize.fn('date_trunc', period, Sequelize.col('saleDate')), 'bucket'],
            [Sequelize.fn('sum', Sequelize.col('totalAmount')), 'totalAmount'],
            [Sequelize.fn('count', Sequelize.col('id')), 'count'],
          ],
          where,
          group: [Sequelize.fn('date_trunc', period, Sequelize.col('saleDate'))],
          order: [[Sequelize.fn('date_trunc', period, Sequelize.col('saleDate')), 'DESC']],
          raw: true,
        });
        res.json(rows);
      } catch (err) {
        console.error('sales-accumulated', err);
        res.status(500).json({ message: 'Error al obtener ventas acumuladas.' });
      }
    }
  );

  // -------------------------
  // Pagos acumulados (día/semana/mes)
  // -------------------------
  router.get(
    '/payments-accumulated',
    authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']),
    async (req, res) => {
      try {
        const { period = 'day', startDate, endDate } = req.query;
        const where = {};
        if (startDate && endDate) where.paymentDate = { [Op.between]: [startOfDay(new Date(startDate)), endOfDay(new Date(endDate))] };

        const rows = await Payment.findAll({
          attributes: [
            [Sequelize.fn('date_trunc', period, Sequelize.col('paymentDate')), 'bucket'],
            [Sequelize.fn('sum', Sequelize.col('amount')), 'totalAmount'],
            [Sequelize.fn('count', Sequelize.col('id')), 'count'],
          ],
          where,
          group: [Sequelize.fn('date_trunc', period, Sequelize.col('paymentDate'))],
          order: [[Sequelize.fn('date_trunc', period, Sequelize.col('paymentDate')), 'DESC']],
          raw: true,
        });
        res.json(rows);
      } catch (err) {
        console.error('payments-accumulated', err);
        res.status(500).json({ message: 'Error al obtener pagos acumulados.' });
      }
    }
  );

  // -------------------------
  // Cobranza por agente
  // -------------------------
  router.get(
    '/collections-by-agent',
    authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']),
    async (req, res) => {
      try {
        const { period = 'day', startDate, endDate } = req.query;
        const where = {};
        if (startDate && endDate) where.paymentDate = { [Op.between]: [startOfDay(new Date(startDate)), endOfDay(new Date(endDate))] };

        const rows = await Payment.findAll({
          attributes: [
            [Sequelize.fn('date_trunc', period, Sequelize.col('paymentDate')), 'bucket'],
            [Sequelize.col('sale.assignedCollector.username'), 'collectorName'],
            [Sequelize.fn('sum', Sequelize.col('amount')), 'totalAmount'],
            [Sequelize.fn('count', Sequelize.col('Payment.id')), 'count'],
          ],
          include: [{
            model: Sale,
            as: 'sale',
            attributes: [],
            include: [{ model: User, as: 'assignedCollector', where: { role: 'collector_agent' }, attributes: [] }]
          }],
          where,
          group: [Sequelize.fn('date_trunc', period, Sequelize.col('paymentDate')), Sequelize.col('sale.assignedCollector.username')],
          order: [[Sequelize.fn('date_trunc', period, Sequelize.col('paymentDate')), 'DESC'], [Sequelize.col('sale.assignedCollector.username'), 'ASC']],
          raw: true,
        });

        res.json(rows);
      } catch (err) {
        console.error('collections-by-agent', err);
        res.status(500).json({ message: 'Error al obtener cobranza por gestor.' });
      }
    }
  );

  // ---------------------------------------------------
  // Ingresos proyectados vs reales (evita 404 del front)
  // ---------------------------------------------------
  // GET /api/reports/projected-vs-real-income?period=day|week|month&start=YYYY-MM-DD&end=YYYY-MM-DD
  router.get(
    '/projected-vs-real-income',
    authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']),
    async (req, res) => {
      try {
        const { period = 'month', start, end } = req.query;

        // rango
        let rangeStart, rangeEnd;
        if (start && end) {
          rangeStart = startOfDay(new Date(start));
          rangeEnd   = endOfDay(new Date(end));
        } else {
          const today = startOfDay(new Date());
          const s = new Date(today), e = new Date(today);
          if (period === 'day') {
            // hoy
          } else if (period === 'week') {
            // lunes a domingo aprox
            const day = today.getDay(); // 0=dom
            const diffToMon = (day + 6) % 7;
            s.setDate(today.getDate() - diffToMon);
            e.setDate(s.getDate() + 6);
          } else { // month
            s.setDate(1);
            e.setMonth(s.getMonth() + 1); e.setDate(0);
          }
          rangeStart = startOfDay(s);
          rangeEnd   = endOfDay(e);
        }

        // REAL: suma de pagos en el rango
        const realRows = await Payment.findAll({
          where: { paymentDate: { [Op.between]: [rangeStart, rangeEnd] } },
          attributes: ['amount'], raw: true
        });
        const real = realRows.reduce((a,r)=>a+N(r.amount), 0);

        // PROYECTADO: weeklyPaymentAmount * factor (cap al saldo)
        let factor = 4;                // mes ≈ 4 semanas
        if (period === 'day') factor = 1/7;
        else if (period === 'week') factor = 1;

        const credits = await Sale.findAll({
          where: { isCredit: true, balanceDue: { [Op.gt]: 0 } },
          attributes: ['weeklyPaymentAmount', 'balanceDue'],
          raw: true
        });

        const projected = credits.reduce((acc, s) => {
          const weekly = N(s.weeklyPaymentAmount);
          if (!weekly) return acc;
          const base = weekly * factor;
          const cap  = N(s.balanceDue);
          return acc + Math.min(base, cap);
        }, 0);

        res.json({
          period,
          range: { start: rangeStart.toISOString(), end: rangeEnd.toISOString() },
          projected: Number(projected.toFixed(2)),
          real: Number(real.toFixed(2)),
          difference: Number((projected - real).toFixed(2)),
        });
      } catch (err) {
        console.error('projected-vs-real-income', err);
        res.status(500).json({ message: 'Error al calcular ingresos proyectados vs reales.' });
      }
    }
  );

  return router;
};

module.exports = initReportRoutes;

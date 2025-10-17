// routes/reportRoutes.js

const express = require('express');
const router = express.Router();
const { Op, Sequelize } = require('sequelize');
const authorizeRoles = require('../middleware/roleMiddleware');

// Importamos dayjs para manejar mejor el inicio y fin del mes
const dayjs = require('dayjs');
const timezone = require('dayjs/plugin/timezone');
const utc = require('dayjs/plugin/utc');
dayjs.extend(utc);
dayjs.extend(timezone);

const TIMEZONE = "America/Mexico_City";

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

// Número seguro - versión mejorada (CRÍTICO para evitar TypeError)
const N = (v) => {
  if (v === null || v === undefined || v === '') return 0;
  const num = Number(v);
  return Number.isFinite(num) ? num : 0;
};

// Función para formatear de forma segura con decimales
const toSafeFixed = (value, decimals = 2) => {
  const num = N(value);
  return Number(num.toFixed(decimals));
};

// Mapeo para agrupar en Sequelize
const periodMap = {
  day: 'day',
  week: 'week',
  month: 'month',
  year: 'year',
};

// ====== INIT ======
const initReportRoutes = (models) => {
  Sale     = models.Sale;
  Client   = models.Client;
  Product  = models.Product;
  Payment  = models.Payment;
  SaleItem = models.SaleItem;
  User     = models.User;

  // -------------------------
  // 1. Resumen global simple (/summary)
  // -------------------------
  router.get(
    '/summary',
    authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']),
    async (req, res) => {
      try {
        const totalBalanceDue = N(await Sale.sum('balanceDue', { where: { isCredit: true, balanceDue: { [Op.gt]: 0 } } }));
        const activeCreditSalesCount = await Sale.count({ where: { isCredit: true, balanceDue: { [Op.gt]: 0 } } }) || 0;
        const totalPaymentsReceived = N(await Payment.sum('amount'));
        const totalClientsCount = await Client.count() || 0;
        const totalSalesCount   = await Sale.count() || 0;

        res.json({
          totalBalanceDue: toSafeFixed(totalBalanceDue),
          activeCreditSalesCount,
          totalPaymentsReceived: toSafeFixed(totalPaymentsReceived),
          totalClientsCount,
          totalSalesCount,
        });
      } catch (err) {
        console.error('summary', err);
        res.status(500).json({ message: 'Error interno del servidor.' });
      }
    }
  );

  // ---------------------------------------------------
  // 2. Ingresos proyectados vs reales (/projected-vs-real-income)
  // CORRECCIÓN: Ajustamos el rango por defecto para consultar el período completo.
  // ---------------------------------------------------
  router.get(
    '/projected-vs-real-income',
    authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']),
    async (req, res) => {
      try {
        const { period = 'month', start, end } = req.query;

        // --- 1. Definir Rango (Lógica Corregida) ---
        let rangeStart, rangeEnd;
        if (start && end) {
          // Si el frontend envió fechas, las usamos
          rangeStart = startOfDay(new Date(start));
          rangeEnd   = endOfDay(new Date(end));
        } else {
          // Si el frontend no envió fechas (se selecciona solo el período, ej. "Mes")
          const now = dayjs().tz(TIMEZONE);
          switch (period) {
            case 'day':
                rangeStart = startOfDay(now.toDate());
                rangeEnd = endOfDay(now.toDate());
                break;
            case 'week':
                rangeStart = startOfDay(now.startOf('week').toDate());
                rangeEnd = endOfDay(now.endOf('week').toDate());
                break;
            case 'month':
            default:
                // Por defecto, cubrimos todo el mes si las fechas están vacías.
                rangeStart = startOfDay(now.startOf('month').toDate());
                rangeEnd = endOfDay(now.endOf('month').toDate());
                break;
          }
        }

        // --- 2. Ingreso Real ---
        const realRows = await Payment.findAll({
          where: { paymentDate: { [Op.between]: [rangeStart, rangeEnd] } },
          attributes: ['amount'], raw: true
        });
        const totalRealIncome = realRows.reduce((a,r)=>a+N(r.amount), 0);

        // --- 3. Ingreso Proyectado (Basado en simplificación semanal) ---
        // La proyección se basa en los créditos activos y no cambia con el rango.
        // Solo el "factor" de cálculo (ej: x4 para mes) cambia según el 'period'.
        let factor = 4; // mes ≈ 4 semanas 
        if (period === 'day') factor = 1/7;
        else if (period === 'week') factor = 1;

        const credits = await Sale.findAll({
          where: { isCredit: true, balanceDue: { [Op.gt]: 0 } },
          attributes: ['weeklyPaymentAmount', 'balanceDue'],
          raw: true
        });

        const totalProjectedIncome = credits.reduce((acc, s) => {
          const weekly = N(s.weeklyPaymentAmount);
          if (!weekly) return acc;
          const base = weekly * factor;
          const cap  = N(s.balanceDue);
          return acc + Math.min(base, cap);
        }, 0);
        
        // --- 4. Calcular Atraso/Adelanto ---
        const difference = totalProjectedIncome - totalRealIncome;
        
        let totalOverdueAmount = 0;
        let totalAdvanceAmount = 0;
        
        if (difference > 0) {
            totalOverdueAmount = difference; // Proyectado > Real -> Atraso
        } else {
            totalAdvanceAmount = Math.abs(difference); // Proyectado < Real -> Adelanto
        }

        res.json({
          totalProjectedIncome: toSafeFixed(totalProjectedIncome),
          totalRealIncome: toSafeFixed(totalRealIncome),
          totalOverdueAmount: toSafeFixed(totalOverdueAmount),
          totalAdvanceAmount: toSafeFixed(totalAdvanceAmount),
        });
      } catch (err) {
        console.error('projected-vs-real-income', err);
        // Devolver ceros seguros si hay un error
        res.status(500).json({ 
            totalProjectedIncome: 0,
            totalRealIncome: 0,
            totalOverdueAmount: 0,
            totalAdvanceAmount: 0,
            message: 'Error al calcular ingresos proyectados vs reales.' 
        });
      }
    }
  );
  
  // -------------------------------
  // 3. Dashboard de status de clientes (/client-status-dashboard)
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
        // CRÍTICO: Devolver un objeto con ceros si falla para evitar el error de renderizado
        res.status(500).json({ 
            alCorriente: 0, porVencer: 0, vencidos: 0, pagados: 0, totalActivos: 0,
            message: 'Error interno del servidor.'
        });
      }
    }
  );
  
  // -------------------------------
  // 4. Créditos Pendientes (/pending-credits)
  // -------------------------------
  router.get(
    '/pending-credits',
    authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']),
    async (req, res) => {
      try {
        const pendingCredits = await Sale.findAll({
          where: { isCredit: true, balanceDue: { [Op.gt]: 0 } },
          include: [
            { model: Client, as: 'client', attributes: ['name', 'lastName'] },
            { model: SaleItem, as: 'saleItems', include: [{ model: Product, as: 'product' }] },
            { model: Payment, as: 'payments', attributes: ['id'] } 
          ],
          order: [['saleDate', 'DESC']]
        });

        res.json(pendingCredits); 
      } catch (err) {
        console.error('Error al obtener créditos pendientes:', err);
        res.status(500).json({ message: 'Error al cargar créditos pendientes.' }); 
      }
    }
  );
  
  // ------------------------------------------------------------------
  // 5. Ventas por rango de fechas (/sales-by-date-range)
  // ------------------------------------------------------------------
  router.get(
    '/sales-by-date-range',
    authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']),
    async (req, res) => {
        const { startDate, endDate } = req.query;
        try {
            const sales = await Sale.findAll({
                where: {
                    saleDate: {
                        [Op.between]: [startOfDay(new Date(startDate)), endOfDay(new Date(endDate))]
                    }
                },
                include: [
                    { model: Client, as: 'client', attributes: ['name', 'lastName'] },
                    { model: SaleItem, as: 'saleItems', include: [{ model: Product, as: 'product', attributes: ['name'] }] }
                ],
                order: [['saleDate', 'DESC']]
            });
            res.json(sales);
        } catch (err) {
             console.error('Error en /sales-by-date-range:', err);
             res.status(500).json([]); // Devuelve una lista vacía para no romper el frontend
        }
    }
  );

  // ------------------------------------------------------------------
  // 6. Pagos por rango de fechas (/payments-by-date-range)
  // ------------------------------------------------------------------
  router.get(
    '/payments-by-date-range',
    authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']),
    async (req, res) => {
        const { startDate, endDate } = req.query;
        try {
            const payments = await Payment.findAll({
                where: {
                    paymentDate: {
                         [Op.between]: [startOfDay(new Date(startDate)), endOfDay(new Date(endDate))]
                    }
                },
                include: [{ model: Sale, as: 'sale', include: [{ model: Client, as: 'client' }] }],
                order: [['paymentDate', 'DESC']]
            });
             res.json(payments);
        } catch (err) {
            console.error('Error en /payments-by-date-range:', err);
            res.status(500).json([]); // Devuelve una lista vacía para no romper el frontend
        }
    }
  );

  // ------------------------------------------------------------------
  // 7. Ventas Acumuladas (/sales-accumulated)
  // ------------------------------------------------------------------
  router.get(
    '/sales-accumulated',
    authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']),
    async (req, res) => {
        const { period = 'day', startDate, endDate } = req.query;
        const groupingPeriod = periodMap[period] || 'day';
        const whereClause = {};

        if (startDate && endDate) {
            whereClause.saleDate = { [Op.between]: [startOfDay(new Date(startDate)), endOfDay(new Date(endDate))] };
        }
        
        try {
            const sales = await Sale.findAll({
                where: whereClause,
                attributes: [
                    [Sequelize.fn('date_trunc', groupingPeriod, Sequelize.col('saleDate')), groupingPeriod],
                    [Sequelize.fn('sum', Sequelize.col('totalAmount')), 'totalAmount'],
                    [Sequelize.fn('count', Sequelize.col('id')), 'count']
                ],
                group: [Sequelize.fn('date_trunc', groupingPeriod, Sequelize.col('saleDate'))],
                order: [[Sequelize.fn('date_trunc', groupingPeriod, Sequelize.col('saleDate')), 'ASC']]
            });
             res.json(sales);
        } catch (err) {
            console.error('Error en /sales-accumulated:', err);
            res.status(500).json([]);
        }
    }
  );

  // ------------------------------------------------------------------
  // 8. Pagos Acumulados (/payments-accumulated)
  // ------------------------------------------------------------------
  router.get(
    '/payments-accumulated',
    authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']),
    async (req, res) => {
        const { period = 'day', startDate, endDate } = req.query;
        const groupingPeriod = periodMap[period] || 'day';
        const whereClause = {};

        if (startDate && endDate) {
            whereClause.paymentDate = { [Op.between]: [startOfDay(new Date(startDate)), endOfDay(new Date(endDate))] };
        }
        
        try {
            const payments = await Payment.findAll({
                where: whereClause,
                attributes: [
                    [Sequelize.fn('date_trunc', groupingPeriod, Sequelize.col('paymentDate')), groupingPeriod],
                    [Sequelize.fn('sum', Sequelize.col('amount')), 'totalAmount'],
                    [Sequelize.fn('count', Sequelize.col('id')), 'count']
                ],
                group: [Sequelize.fn('date_trunc', groupingPeriod, Sequelize.col('paymentDate'))],
                order: [[Sequelize.fn('date_trunc', groupingPeriod, Sequelize.col('paymentDate')), 'ASC']]
            });
             res.json(payments);
        } catch (err) {
            console.error('Error en /payments-accumulated:', err);
            res.status(500).json([]);
        }
    }
  );

  // ------------------------------------------------------------------
  // 9. Cobranza por Gestor (/collections-by-agent)
  // ------------------------------------------------------------------
  router.get(
    '/collections-by-agent',
    authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']),
    async (req, res) => {
        const { period = 'day', startDate, endDate } = req.query;
        const groupingPeriod = periodMap[period] || 'day';
        const whereClause = {};

        if (startDate && endDate) {
            whereClause.paymentDate = { [Op.between]: [startOfDay(new Date(startDate)), endOfDay(new Date(endDate))] };
        }

        try {
            const collections = await Payment.findAll({
                where: whereClause,
                attributes: [
                    [Sequelize.fn('date_trunc', groupingPeriod, Sequelize.col('paymentDate')), groupingPeriod],
                    [Sequelize.fn('sum', Sequelize.col('amount')), 'totalAmount'],
                    [Sequelize.fn('count', Sequelize.col('Payment.id')), 'count'],
                    // Atributo del nombre del gestor
                    [Sequelize.col('sale->assignedCollector.username'), 'collectorName'] 
                ],
                include: [{
                    model: Sale, as: 'sale', required: true,
                    // CORRECCIÓN CLAVE: No seleccionar atributos de Sale para evitar 42803
                    attributes: [], 
                    include: [{ 
                        model: User, as: 'assignedCollector', attributes: [], required: true, 
                        where: { role: 'collector_agent' } // Filtrar solo gestores
                    }]
                }],
                group: [
                    Sequelize.fn('date_trunc', groupingPeriod, Sequelize.col('paymentDate')),
                    Sequelize.col('sale->assignedCollector.username') // Agrupar por el nombre del gestor
                ],
                order: [[Sequelize.fn('date_trunc', groupingPeriod, Sequelize.col('paymentDate')), 'ASC']],
                raw: true // Usar raw para simplificar la salida y hacer la agrupación más limpia
            });

            // Mapear los resultados para asegurar que las claves sean correctas y seguras
            const result = collections.map(c => ({
                [groupingPeriod]: c[groupingPeriod],
                totalAmount: N(c.totalAmount),
                count: N(c.count),
                collectorName: c.collectorName
            }));
            
             res.json(result);
        } catch (err) {
            console.error('Error CRÍTICO en /collections-by-agent:', err);
            // Devolver un array vacío en caso de error 500 para evitar que el frontend falle
            res.status(500).json([]);
        }
    }
  );
  
  // ------------------------------------------------------------------
  // 10. Estado de Cuenta de Cliente (/client-statement/:clientId)
  // SOLUCIÓN AL ERROR 404 DE /client-statement/14
  // ------------------------------------------------------------------
  router.get(
    '/client-statement/:clientId',
    authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']),
    async (req, res) => {
        try {
            const clientId = req.params.clientId;

            const client = await Client.findByPk(clientId, {
                attributes: ['id', 'name', 'lastName']
            });
            
            if (!client) {
                return res.status(404).json({ message: 'Cliente no encontrado.' });
            }

            // Obtener todas las ventas y pagos asociados a este cliente para construir el estado
            const sales = await Sale.findAll({
                where: { clientId: clientId },
                include: [
                    { model: SaleItem, as: 'saleItems', include: [{ model: Product, as: 'product' }] },
                    { model: Payment, as: 'payments', order: [['paymentDate', 'ASC']] }
                ],
                order: [['saleDate', 'ASC']]
            });
            
            // Devolver el cliente y sus ventas/pagos
            res.json({ client, sales });
        } catch (err) {
            console.error('Error al obtener estado de cuenta de cliente:', err);
            res.status(500).json({ message: 'Error al cargar el estado de cuenta.' });
        }
    }
  );

  // ------------------------------------------------------------------
  // 11. Riesgo de Cliente (/client-risk/:clientId)
  // SOLUCIÓN AL ERROR 404 DE /client-risk/5
  // ------------------------------------------------------------------
  router.get(
    '/client-risk/:clientId',
    authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']),
    async (req, res) => {
        try {
            const clientId = req.params.clientId;
            
            // Lógica de Riesgo Simplificada: Basada en el balance pendiente
            const totalBalance = N(await Sale.sum('balanceDue', { 
                where: { clientId: clientId, isCredit: true } 
            }));
            
            // Contar el número de ventas Vencidas (ejemplo: due < today)
            const today = startOfDay(new Date());
            const creditSales = await Sale.findAll({
              where: { clientId: clientId, isCredit: true, balanceDue: { [Op.gt]: 0 } },
              include: [{ model: Payment, as: 'payments' }],
            });

            let overdueSalesCount = 0;
            for (const s of creditSales) {
                const last = s.payments?.length
                  ? s.payments.slice().sort((a,b)=>new Date(b.paymentDate)-new Date(a.paymentDate))[0].paymentDate
                  : s.saleDate;
                const due = getNextDueDate(last, s.paymentFrequency);
                if (due < today) overdueSalesCount++;
            }
            
            let riskLevel = 'Bajo';
            // Reglas de ejemplo:
            if (overdueSalesCount > 0 && totalBalance > 0) { 
                riskLevel = 'Medio';
            }
            if (overdueSalesCount > 2 && totalBalance > 1000) { // Alto riesgo por alto balance y múltiples vencimientos
                riskLevel = 'Alto';
            }
            
            res.json({ 
                clientId: clientId, 
                totalBalanceDue: toSafeFixed(totalBalance), 
                overdueSalesCount: overdueSalesCount,
                riskLevel: riskLevel 
            });
        } catch (err) {
            console.error('Error al calcular riesgo de cliente:', err);
            res.status(500).json({ message: 'Error al calcular riesgo.' });
        }
    }
  );
  
  // Se exportan las utilidades para ser usadas en remindersRoutes.js
  module.exports.startOfDay = startOfDay;
  module.exports.endOfDay = endOfDay;
  module.exports.getNextDueDate = getNextDueDate; 
  module.exports.N = N;

  return router;
};

module.exports = initReportRoutes;
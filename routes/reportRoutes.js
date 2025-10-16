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

// Número seguro - versión mejorada
const N = (v) => {
  if (v === null || v === undefined || v === '') return 0;
  const num = Number(v);
  // Importante: Chequeo de isNaN para strings que no son números y isFinite para Infinito/NaN
  return Number.isFinite(num) ? num : 0;
};

// Función para formatear de forma segura con decimales
const toSafeFixed = (value, decimals = 2) => {
  const num = N(value);
  return Number(num.toFixed(decimals));
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
  // Resumen global simple (El origen más probable del fallo de toLocaleString)
  // -------------------------
  router.get(
    '/summary',
    authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']),
    async (req, res) => {
      try {
        // USO CRÍTICO DE N() para asegurar que el resultado de .sum() sea un número
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
  // Ingresos proyectados vs reales (Ruta que falla en /admin/reports)
  // ---------------------------------------------------
  router.get(
    '/projected-vs-real-income',
    authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']),
    async (req, res) => {
      try {
        const { period = 'month', start, end } = req.query;

        // --- 1. Definir Rango ---
        let rangeStart, rangeEnd;
        if (start && end) {
          rangeStart = startOfDay(new Date(start));
          rangeEnd   = endOfDay(new Date(end));
        } else {
          // Lógica de período por defecto (día, semana, mes actual)
          const today = startOfDay(new Date());
          const s = new Date(today), e = new Date(today);
          if (period === 'week') {
            const day = today.getDay(); 
            const diffToMon = (day + 6) % 7;
            s.setDate(today.getDate() - diffToMon);
            e.setDate(s.getDate() + 6);
          } else if (period === 'month') {
            s.setDate(1);
            e.setMonth(s.getMonth() + 1); e.setDate(0);
          }
          rangeStart = startOfDay(s);
          rangeEnd   = endOfDay(e);
        }

        // --- 2. Ingreso Real ---
        const realRows = await Payment.findAll({
          where: { paymentDate: { [Op.between]: [rangeStart, rangeEnd] } },
          attributes: ['amount'], raw: true
        });
        const totalRealIncome = realRows.reduce((a,r)=>a+N(r.amount), 0);

        // --- 3. Ingreso Proyectado (Basado en simplificación semanal) ---
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
          // Se devuelven los montos explícitamente para el frontend
          totalOverdueAmount: toSafeFixed(totalOverdueAmount),
          totalAdvanceAmount: toSafeFixed(totalAdvanceAmount),
        });
      } catch (err) {
        console.error('projected-vs-real-income', err);
        // Devolver un objeto vacío o con ceros si hay un error para evitar el fallo del frontend
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
  // Dashboard de status de clientes (Usa getNextDueDate)
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
  
  // ... (El resto de las rutas de reportes se mantienen igual) ...

  // Se exportan las utilidades para ser usadas en remindersRoutes.js
  module.exports.startOfDay = startOfDay;
  module.exports.endOfDay = endOfDay;
  module.exports.getNextDueDate = getNextDueDate; 
  module.exports.N = N;

  return router;
};

module.exports = initReportRoutes;
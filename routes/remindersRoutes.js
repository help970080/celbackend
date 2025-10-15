// routes/remindersRoutes.js
const express = require('express');
const router = express.Router();

/**
 * Clasificación a nivel cliente según su peor atraso:
 *  - ALTO: días de atraso >= 15
 *  - BAJO: resto (<= 14, incluyendo 0 y negativos → por vencer/hoy)
 */
function deriveSeverity(daysLate) {
  return daysLate >= 15 ? 'ALTO' : 'BAJO';
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

// Pequeña tolerancia para evitar contar residuos por redondeo (centavos)
const EPS = 0.009;

// saldo real por venta = total - suma(pagos)
function calcSaleBalance(sale) {
  const total = Number(sale.totalAmount || 0);
  const paid = (sale.payments || []).reduce((acc, p) => acc + Number(p.amount || 0), 0);
  const bal = total - paid;
  // si el saldo es muy pequeño (<= EPS), tratar como 0
  return bal > EPS ? bal : 0;
}

// nextDueDate robusto: respeta BD; si no hay, usa último pago o fecha de venta + 7 días
function calcNextDueDate(sale) {
  if (sale.nextDueDate) return startOfDay(new Date(sale.nextDueDate));
  const paymentsSorted = [...(sale.payments || [])].sort(
    (a, b) => new Date(b.paymentDate) - new Date(a.paymentDate)
  );
  const base = paymentsSorted.length
    ? startOfDay(new Date(paymentsSorted[0].paymentDate))
    : (sale.saleDate ? startOfDay(new Date(sale.saleDate)) : startOfDay(new Date()));
  return startOfDay(new Date(base.getTime() + 7 * 24 * 60 * 60 * 1000));
}

module.exports = (models) => {
  const { Sale, Client, Payment } = models;

  /**
   * GET /api/reminders/overdue
   * Devuelve **un registro por cliente** con saldo > 0 (sumando todas sus ventas),
   * severidad por el peor atraso entre sus ventas.
   *
   * Partimos de Sale.findAll para usar alias existentes: 'client' y 'payments'.
   */
  router.get('/overdue', async (req, res) => {
    try {
      const sales = await Sale.findAll({
        include: [
          {
            model: Client,
            as: 'client',
            required: true,
            attributes: ['id', 'name', 'lastName', 'phone', 'address', 'city'],
          },
          {
            model: Payment,
            as: 'payments',
            required: false,
            attributes: ['id', 'amount', 'paymentDate', 'paymentMethod'],
          },
        ],
        order: [['id', 'DESC']],
      });

      const today = startOfDay(new Date());

      // Agregado por cliente (key = client.id)
      const byClient = new Map();

      for (const s of sales) {
        const c = s.client;
        if (!c) continue;

        // saldo real por venta con tolerancia EPS
        const saleBalance = calcSaleBalance(s);
        if (saleBalance <= EPS) continue; // descartar ventas con saldo 0

        // cálculo de fechas y atraso
        const nextDue = calcNextDueDate(s);
        const daysLate = Math.floor((today.getTime() - nextDue.getTime()) / (24 * 60 * 60 * 1000));
        const sev = deriveSeverity(daysLate);

        const key = c.id;
        if (!byClient.has(key)) {
          byClient.set(key, {
            client: {
              id: c.id,
              name: c.name,
              lastName: c.lastName,
              phone: c.phone,
              address: c.address,
              city: c.city,
            },
            balanceDue: 0,
            weeklyPaymentAmount: 0,   // referencia (tomamos el mayor)
            totalAmount: 0,
            worstDaysLate: -Infinity,
            worstSeverity: 'BAJO',
            nextDueDate: null,        // más cercana (mínima)
            sales: [],
          });
        }

        const agg = byClient.get(key);
        agg.balanceDue += saleBalance;
        agg.totalAmount += Number(s.totalAmount || 0);

        // semanal: mayor como referencia de cobro
        const weekly = Number(s.weeklyPaymentAmount || 0);
        if (weekly > agg.weeklyPaymentAmount) agg.weeklyPaymentAmount = weekly;

        // próxima fecha más cercana
        if (!agg.nextDueDate || nextDue < new Date(agg.nextDueDate)) {
          agg.nextDueDate = nextDue.toISOString();
        }

        // peor atraso para severidad del cliente
        if (daysLate > agg.worstDaysLate) {
          agg.worstDaysLate = daysLate;
          agg.worstSeverity = sev;
        }

        agg.sales.push({
          id: s.id,
          saleBalance: Number(saleBalance.toFixed(2)),
          totalAmount: Number(s.totalAmount || 0),
          weeklyPaymentAmount: weekly,
          nextDueDate: nextDue.toISOString(),
          daysLate,
          severity: sev,
          isCredit: !!s.isCredit,
        });
      }

      // Construimos salida: un registro por cliente con saldo > 0 (considerando EPS)
      const out = [];
      for (const [, v] of byClient) {
        if (v.balanceDue <= EPS) continue; // excluir clientes con saldo 0
        out.push({
          client: v.client,
          sale: {
            id: v.sales.length ? v.sales[0].id : null, // referencia opcional
            balanceDue: Number(v.balanceDue.toFixed(2)),
            weeklyPaymentAmount: Number(v.weeklyPaymentAmount || 0),
            totalAmount: Number(v.totalAmount || 0),
            nextDueDate: v.nextDueDate,
          },
          daysLate: v.worstDaysLate,
          severity: v.worstSeverity, // ALTO si alguna venta está muy vencida
          sales: v.sales,            // útil para depurar si lo necesitas
        });
      }

      // Orden: ALTO primero; dentro, por mayor atraso
      out.sort((a, b) => {
        if (a.severity !== b.severity) return a.severity === 'ALTO' ? -1 : 1;
        return (b.daysLate || 0) - (a.daysLate || 0);
      });

      res.json(out);
    } catch (err) {
      console.error('GET /api/reminders/overdue error:', err);
      res.status(500).json({ message: 'Error al calcular recordatorios de pago.' });
    }
  });

  return router;
};

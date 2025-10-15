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

// saldo real por venta = total - suma(pagos)
function calcSaleBalance(sale) {
  const total = Number(sale.totalAmount || 0);
  const paid = (sale.payments || []).reduce((acc, p) => acc + Number(p.amount || 0), 0);
  const bal = total - paid;
  return bal > 0 ? bal : 0;
}

// nextDueDate robusto: respeta BD, si no: último pago o venta + 7 días
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
  const { Client, Sale, Payment } = models;

  /**
   * GET /api/reminders/overdue
   * Devuelve **un registro por cliente** con saldo > 0 (sumando todas sus ventas),
   * severidad por el peor atraso entre sus ventas.
   */
  router.get('/overdue', async (req, res) => {
    try {
      const clients = await Client.findAll({
        attributes: ['id', 'name', 'lastName', 'phone', 'address', 'city'],
        include: [
          {
            model: Sale,
            as: 'sales',
            required: false, // traer todos los clientes aunque no tengan ventas
            attributes: ['id', 'totalAmount', 'weeklyPaymentAmount', 'saleDate', 'nextDueDate', 'isCredit'],
            include: [
              {
                model: Payment,
                as: 'payments',
                required: false,
                attributes: ['id', 'amount', 'paymentDate', 'paymentMethod'],
              },
            ],
          },
        ],
        order: [['id', 'DESC']],
      });

      const today = startOfDay(new Date());
      const out = [];

      for (const c of clients) {
        const sales = Array.isArray(c.sales) ? c.sales : [];

        // Agregados por cliente
        let clientBalance = 0;
        let clientWeekly = 0;           // tomamos el mayor semanal como referencia de cobro
        let clientTotalAmount = 0;
        let worstDaysLate = -Infinity;  // peor atraso
        let worstSeverity = 'BAJO';
        let nextDueClosest = null;      // próxima fecha más cercana (mínima)
        const salesSnapshot = [];

        for (const s of sales) {
          const saleBalance = calcSaleBalance(s);
          if (saleBalance <= 0) continue; // ignorar ventas sin saldo

          // acumular al cliente
          clientBalance += saleBalance;
          clientTotalAmount += Number(s.totalAmount || 0);

          // weekly mayor
          const weekly = Number(s.weeklyPaymentAmount || 0);
          if (weekly > clientWeekly) clientWeekly = weekly;

          const nextDue = calcNextDueDate(s);
          if (!nextDueClosest || nextDue < new Date(nextDueClosest)) {
            nextDueClosest = nextDue.toISOString();
          }

          const daysLate = Math.floor((today.getTime() - nextDue.getTime()) / (24 * 60 * 60 * 1000));
          const sev = deriveSeverity(daysLate);
          if (daysLate > worstDaysLate) {
            worstDaysLate = daysLate;
            worstSeverity = sev;
          }

          salesSnapshot.push({
            id: s.id,
            saleBalance,
            totalAmount: Number(s.totalAmount || 0),
            weeklyPaymentAmount: weekly,
            nextDueDate: nextDue.toISOString(),
            daysLate,
            severity: sev,
            isCredit: !!s.isCredit,
          });
        }

        // Solo clientes con saldo > 0 (sumando todas sus ventas)
        if (clientBalance > 0) {
          out.push({
            client: {
              id: c.id,
              name: c.name,
              lastName: c.lastName,
              phone: c.phone,
              address: c.address,
              city: c.city,
            },
            sale: {
              id: salesSnapshot.length ? salesSnapshot[0].id : null, // referencia (opcional)
              balanceDue: Number(clientBalance.toFixed(2)),
              weeklyPaymentAmount: Number(clientWeekly || 0),
              totalAmount: Number(clientTotalAmount || 0),
              nextDueDate: nextDueClosest,
            },
            daysLate: worstDaysLate,
            severity: worstSeverity, // peor atraso define el riesgo del cliente
            sales: salesSnapshot,    // para depurar si lo necesitas en el front
          });
        }
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

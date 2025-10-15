// routes/remindersRoutes.js
const express = require('express');
const router = express.Router();

/**
 * Clasificación:
 *  - ALTO:    días de atraso >= 15
 *  - BAJO:    resto (<= 14, incluyendo 0 y negativos → por vencer/hoy)
 */
function deriveSeverity(daysLate) {
  return daysLate >= 15 ? 'ALTO' : 'BAJO';
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

// calcula saldo real por venta: total - suma(pagos)
function calcSaleBalance(sale) {
  const total = Number(sale.totalAmount || 0);
  const paid = (sale.payments || []).reduce((acc, p) => acc + Number(p.amount || 0), 0);
  return Math.max(0, total - paid);
}

// nextDueDate robusto (respeta BD, si no: último pago o venta + 7 días)
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
   * Devuelve **UN registro por cliente** con saldo > 0 (sumando sus ventas activas).
   * Severidad por el peor atraso entre sus ventas.
   */
  router.get('/overdue', async (req, res) => {
    try {
      const sales = await Sale.findAll({
        // Importante: NO filtramos por isCredit aquí para no excluir casos reales con saldo.
        // Si quieres forzarlo, añade where: { isCredit: true }
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

      // Agregamos por cliente
      const byClient = new Map();

      for (const sale of sales) {
        const client = sale.client;
        if (!client) continue;

        // saldo real por venta
        const saleBalance = calcSaleBalance(sale);
        if (saleBalance <= 0) continue; // sólo ventas con saldo

        const nextDue = calcNextDueDate(sale);
        const daysLate = Math.floor((today.getTime() - nextDue.getTime()) / (24 * 60 * 60 * 1000));
        const severity = deriveSeverity(daysLate);

        const key = client.id;
        if (!byClient.has(key)) {
          byClient.set(key, {
            client: {
              id: client.id,
              name: client.name,
              lastName: client.lastName,
              phone: client.phone,
              address: client.address,
              city: client.city,
            },
            // agregados a nivel cliente
            balanceDue: 0,
            weeklyPaymentAmount: 0,     // puedes cambiar a promedio o máximo si prefieres
            totalAmount: 0,
            // métrica de severidad/atraso "peor" entre sus ventas
            worstDaysLate: -Infinity,
            worstSeverity: 'BAJO',
            // próxima fecha más cercana (la mínima)
            nextDueDate: null,
            // opcional: lista de ventas para referencia
            sales: [],
          });
        }

        const agg = byClient.get(key);
        agg.balanceDue += saleBalance;
        agg.totalAmount += Number(sale.totalAmount || 0);

        // usamos el mayor atraso para severidad del cliente
        if (daysLate > agg.worstDaysLate) {
          agg.worstDaysLate = daysLate;
          agg.worstSeverity = severity;
        }

        // tomamos la fecha de pago más próxima (mínima)
        if (!agg.nextDueDate || nextDue < new Date(agg.nextDueDate)) {
          agg.nextDueDate = nextDue.toISOString();
        }

        // conservar alguna referencia de semanal (elige mayor para “capacidad de pago”)
        const weekly = Number(sale.weeklyPaymentAmount || 0);
        if (weekly > agg.weeklyPaymentAmount) {
          agg.weeklyPaymentAmount = weekly;
        }

        agg.sales.push({
          id: sale.id,
          saleBalance,
          totalAmount: Number(sale.totalAmount || 0),
          weeklyPaymentAmount: weekly,
          nextDueDate: nextDue.toISOString(),
          daysLate,
          severity,
        });
      }

      // construir salida (un registro por cliente)
      const out = [];
      for (const [, v] of byClient) {
        if (v.balanceDue <= 0) continue; // por seguridad
        out.push({
          client: v.client,
          sale: {
            // valores representativos a nivel cliente
            id: v.sales.length ? v.sales[0].id : null, // opcional
            balanceDue: Number(v.balanceDue.toFixed(2)),
            weeklyPaymentAmount: Number(v.weeklyPaymentAmount || 0),
            totalAmount: Number(v.totalAmount || 0),
            nextDueDate: v.nextDueDate,
          },
          daysLate: v.worstDaysLate,
          severity: v.worstSeverity, // "ALTO" si alguna venta está muy vencida
          // útil para depurar si lo necesitas en el front (puedes omitir)
          sales: v.sales,
        });
      }

      // Orden: primero ALTO, luego BAJO; dentro, por días de atraso desc/fecha próxima
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

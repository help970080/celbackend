// routes/remindersRoutes.js
const express = require('express');
const router = express.Router();

// Regla de severidad:
// ALTO: días >= 15 || saldo >= 2000 || vencidos >= 2
// BAJO:  1..14  && saldo > 0
function deriveSeverity({ daysLate, balanceDue, overdueCount }) {
  if (daysLate >= 15 || balanceDue >= 2000 || overdueCount >= 2) return 'ALTO';
  if (daysLate > 0 && daysLate <= 14 && balanceDue > 0) return 'BAJO';
  return null;
}

// Estimar cantidad de pagos vencidos en base semanal simple
function estimateOverdueCount(sale, daysLate) {
  if (!sale || !sale.isCredit) return 0;
  return sale.weeklyPaymentAmount && daysLate > 0
    ? Math.floor(daysLate / 7)
    : (daysLate > 0 ? 1 : 0);
}

module.exports = (models) => {
  const { Sale, Client, Payment } = models; // usamos tus modelos con alias consistentes

  router.get('/overdue', async (req, res) => {
    try {
      const sales = await Sale.findAll({
        where: { isCredit: true },
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

      const today = new Date();
      const out = [];

      for (const sale of sales) {
        const client = sale.client;
        if (!client) continue;

        const balanceDue = Number(sale.balanceDue || 0);
        if (balanceDue <= 0) continue;

        // Próxima fecha de pago: usa nextDueDate si existe; si no, calcula 7 días después del último pago (o de saleDate)
        let nextDue = sale.nextDueDate ? new Date(sale.nextDueDate) : null;

        const payments = [...(sale.payments || [])].sort(
          (a, b) => new Date(b.paymentDate) - new Date(a.paymentDate)
        );

        if (!nextDue) {
          const baseDate = payments.length
            ? new Date(payments[0].paymentDate)
            : new Date(sale.saleDate);
          nextDue = new Date(baseDate.getTime() + 7 * 24 * 60 * 60 * 1000);
        }

        const daysLate = Math.floor((today - nextDue) / (24 * 60 * 60 * 1000));
        if (daysLate <= 0) continue;

        const overdueCount = estimateOverdueCount(sale, daysLate);
        const severity = deriveSeverity({ daysLate, balanceDue, overdueCount });
        if (!severity) continue;

        const lastPayment = payments[0] || null;

        out.push({
          client: {
            id: client.id,
            name: client.name,
            lastName: client.lastName,
            phone: client.phone,
            address: client.address,
            city: client.city,
          },
          sale: {
            id: sale.id,
            balanceDue,
            weeklyPaymentAmount: Number(sale.weeklyPaymentAmount || 0),
            totalAmount: Number(sale.totalAmount || 0),
            nextDueDate: nextDue.toISOString(),
          },
          daysLate,
          overdueCount,
          severity, // "ALTO" | "BAJO"
          lastPayment: lastPayment
            ? {
                id: lastPayment.id,
                amount: Number(lastPayment.amount || 0),
                paymentDate: new Date(lastPayment.paymentDate).toISOString(),
                paymentMethod: lastPayment.paymentMethod || null,
              }
            : null,
        });
      }

      res.json(out);
    } catch (err) {
      console.error('GET /api/reminders/overdue error:', err);
      res.status(500).json({ message: 'Error al calcular recordatorios de pago.' });
    }
  });

  return router;
};

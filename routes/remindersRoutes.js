// routes/remindersRoutes.js
const express = require('express');
const router = express.Router();

const { authenticateToken } = require('../authMiddleware');        // ya existe en tu proyecto
const { authorizeRoles } = require('../roleMiddleware');           // ya existe en tu proyecto
const { Sale, Client, Payment } = require('../models');            // index.js exporta los modelos

// Regla de severidad (ajusta si quieres):
// ALTO: daysLate >= 15 || balanceDue >= 2000 || pagos vencidos >= 2
// BAJO: 1 <= daysLate <= 14 && balanceDue > 0
// EXCLUIR: balanceDue <= 0 || daysLate <= 0
function deriveSeverity({ daysLate, balanceDue, overdueCount }) {
  if (daysLate >= 15 || balanceDue >= 2000 || overdueCount >= 2) return 'ALTO';
  if (daysLate > 0 && daysLate <= 14 && balanceDue > 0) return 'BAJO';
  return null;
}

// Estima "siguientes pagos vencidos" básicos basado en semanalidad
function estimateOverdueCount(sale, daysLate) {
  if (!sale || !sale.isCredit) return 0;
  // si weeklyPaymentAmount existe, consideramos 7 días por pago:
  if (sale.weeklyPaymentAmount && daysLate > 0) {
    return Math.floor(daysLate / 7);
  }
  return daysLate > 0 ? 1 : 0;
}

router.get(
  '/overdue',
  authenticateToken,
  // Permite a super_admin, regular_admin, sales_admin y collector_agent ver recordatorios:
  authorizeRoles('super_admin', 'regular_admin', 'sales_admin', 'collector_agent'),
  async (req, res) => {
    try {
      // Traemos ventas con cliente y pagos (último pago para referencia)
      const sales = await Sale.findAll({
        where: { isCredit: true }, // sobre crédito, recordatorios de abono
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
        const balanceDue = Number(sale.balanceDue || 0);
        if (balanceDue <= 0) continue; // no recordatorio si ya está saldada

        // Fecha de referencia para atraso (nextDueDate si existe, si no, aproximamos semanal)
        let refDate = sale.nextDueDate ? new Date(sale.nextDueDate) : null;
        if (!refDate) {
          // aproximar siguiente vencimiento: si hay pagos, suma 7 días al último, si no, a saleDate
          const allPayments = (sale.payments || []).sort(
            (a, b) => new Date(b.paymentDate) - new Date(a.paymentDate)
          );
          const baseDate = allPayments.length ? new Date(allPayments[0].paymentDate) : new Date(sale.saleDate);
          refDate = new Date(baseDate.getTime() + 7 * 24 * 60 * 60 * 1000);
        }

        const ms = today - refDate;
        const daysLate = Math.floor(ms / (24 * 60 * 60 * 1000));
        if (daysLate <= 0) continue; // aún no está vencida

        const overdueCount = estimateOverdueCount(sale, daysLate);
        const severity = deriveSeverity({ daysLate, balanceDue, overdueCount });
        if (!severity) continue;

        // último pago (si lo hay)
        const sortedPayments = (sale.payments || []).sort(
          (a, b) => new Date(b.paymentDate) - new Date(a.paymentDate)
        );
        const lastPayment = sortedPayments[0] || null;

        out.push({
          client: {
            id: sale.client.id,
            name: sale.client.name,
            lastName: sale.client.lastName,
            phone: sale.client.phone,
            address: sale.client.address,
            city: sale.client.city,
          },
          sale: {
            id: sale.id,
            balanceDue,
            weeklyPaymentAmount: Number(sale.weeklyPaymentAmount || 0),
            totalAmount: Number(sale.totalAmount || 0),
            nextDueDate: refDate.toISOString(),
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
  }
);

module.exports = router;

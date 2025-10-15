// routes/reportRoutes.js
const express = require('express');

module.exports = (models) => {
  const router = express.Router();
  const { Client, Sale, Payment, SaleItem, Product } = models;

  // Utilidades
  const safeNum = (v) => Number(v || 0);
  const fmt2 = (n) => Number(n.toFixed(2));

  // --- GET /api/reports/client-statement/:clientId
  // Estado de cuenta del cliente: ventas, pagos y totales.
  router.get(['/client-statement/:clientId', '/client/:clientId/statement', '/statement/:clientId'], async (req, res) => {
    try {
      const clientId = Number(req.params.clientId);
      if (!clientId) return res.status(400).json({ message: 'clientId inválido' });

      const client = await Client.findByPk(clientId, {
        attributes: ['id', 'name', 'lastName', 'phone', 'address', 'city'],
        include: [{
          model: Sale,
          as: 'sales',                // <- en tu proyecto suele estar definido así
          required: false,
          attributes: ['id', 'totalAmount', 'downPayment', 'balanceDue', 'weeklyPaymentAmount', 'saleDate', 'nextDueDate', 'isCredit'],
          include: [
            { model: Payment, as: 'payments', required: false, attributes: ['id', 'amount', 'paymentDate', 'paymentMethod', 'note'] },
            { 
              model: SaleItem, as: 'saleItems', required: false, 
              attributes: ['id', 'quantity', 'unitPrice', 'totalPrice'],
              include: [{ model: Product, as: 'product', required: false, attributes: ['id', 'name', 'sku'] }]
            }
          ]
        }]
      });

      if (!client) return res.status(404).json({ message: 'Cliente no encontrado' });

      // Calcular totales por venta y totales generales
      let grandTotal = 0;
      let grandPaid = 0;
      let grandBalance = 0;

      const sales = (client.sales || []).map(s => {
        const total = safeNum(s.totalAmount);
        const paid = (s.payments || []).reduce((acc, p) => acc + safeNum(p.amount), 0);
        const balance = Math.max(0, total - paid);

        grandTotal += total;
        grandPaid += paid;
        grandBalance += balance;

        return {
          id: s.id,
          saleDate: s.saleDate,
          nextDueDate: s.nextDueDate,
          isCredit: !!s.isCredit,
          weeklyPaymentAmount: safeNum(s.weeklyPaymentAmount),
          totalAmount: fmt2(total),
          paidAmount: fmt2(paid),
          balanceDue: fmt2(balance),
          downPayment: fmt2(safeNum(s.downPayment)),
          items: (s.saleItems || []).map(it => ({
            id: it.id,
            quantity: safeNum(it.quantity),
            unitPrice: fmt2(safeNum(it.unitPrice)),
            totalPrice: fmt2(safeNum(it.totalPrice)),
            product: it.product ? { id: it.product.id, name: it.product.name, sku: it.product.sku } : null
          })),
          payments: (s.payments || []).map(p => ({
            id: p.id,
            amount: fmt2(safeNum(p.amount)),
            paymentDate: p.paymentDate,
            paymentMethod: p.paymentMethod || null,
            note: p.note || null
          }))
        };
      });

      // Ordena pagos/ventas por fecha descendente para que el front los muestre “bonito”
      sales.sort((a, b) => new Date(b.saleDate || 0) - new Date(a.saleDate || 0));

      return res.json({
        client: {
          id: client.id,
          name: client.name,
          lastName: client.lastName,
          phone: client.phone,
          address: client.address,
          city: client.city
        },
        summary: {
          total: fmt2(grandTotal),
          paid: fmt2(grandPaid),
          balance: fmt2(grandBalance)
        },
        sales
      });
    } catch (err) {
      console.error('GET /api/reports/client-statement error:', err);
      return res.status(500).json({ message: 'Error al generar estado de cuenta' });
    }
  });

  // --- GET /api/reports/client-risk/:clientId
  // Devuelve un nivel de riesgo simple basado en días de atraso "peor" y saldo.
  router.get(['/client-risk/:clientId', '/client/:clientId/risk'], async (req, res) => {
    try {
      const clientId = Number(req.params.clientId);
      if (!clientId) return res.status(400).json({ message: 'clientId inválido' });

      // Trae ventas y pagos para calcular atraso y saldo
      const sales = await Sale.findAll({
        where: { clientId },
        attributes: ['id', 'totalAmount', 'weeklyPaymentAmount', 'saleDate', 'nextDueDate', 'isCredit'],
        include: [{ model: Payment, as: 'payments', required: false, attributes: ['id', 'amount', 'paymentDate'] }]
      });

      if (!sales.length) {
        return res.json({ clientId, risk: 'SIN_DATOS', daysLate: 0, balance: 0 });
      }

      const today = new Date(); today.setHours(0,0,0,0);

      let worstDaysLate = -Infinity;
      let balance = 0;

      for (const s of sales) {
        const total = safeNum(s.totalAmount);
        const paid = (s.payments || []).reduce((acc, p) => acc + safeNum(p.amount), 0);
        const bal = Math.max(0, total - paid);
        balance += bal;

        // calcula atraso simple
        let ref = s.nextDueDate ? new Date(s.nextDueDate) : (s.saleDate ? new Date(s.saleDate) : today);
        ref.setHours(0,0,0,0);
        const daysLate = Math.floor((today - ref) / (24 * 60 * 60 * 1000));
        if (daysLate > worstDaysLate) worstDaysLate = daysLate;
      }

      let risk = 'BAJO';
      if (worstDaysLate >= 15) risk = 'ALTO';

      return res.json({
        clientId,
        risk,
        daysLate: worstDaysLate,
        balance: fmt2(balance)
      });
    } catch (err) {
      console.error('GET /api/reports/client-risk error:', err);
      return res.status(500).json({ message: 'Error al calcular riesgo' });
    }
  });

  return router;
};

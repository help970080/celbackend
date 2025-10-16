// routes/remindersRoutes.js 

const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');

// --- Replicar/Definir utilidades de fecha de reportRoutes.js (o importarlas) ---
// Se replican aquí para evitar problemas de ruteo/dependencias
const startOfDay = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
const endOfDay   = (d) => { const x = new Date(d); x.setHours(23,59,59,999); return x; };
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
// Número seguro N
const N = (v) => {
  if (v === null || v === undefined || v === '') return 0;
  const num = Number(v);
  return Number.isFinite(num) ? num : 0;
};
// --- FIN Utilidades ---

// Regla de severidad 
function deriveSeverity({ daysLate, balanceDue, overdueCount }) {
  if (daysLate >= 15 || balanceDue >= 2000 || overdueCount >= 2) return 'ALTO';
  if (daysLate > 0 && daysLate <= 14 && balanceDue > 0) return 'BAJO';
  return null;
}

// Estimar cantidad de pagos vencidos en base a la frecuencia
function estimateOverdueCount(sale, daysLate) {
  if (!sale || !sale.isCredit) return 0;
  
  let daysPerPeriod = 7; // default: weekly
  switch((sale.paymentFrequency || 'weekly').toLowerCase()) {
    case 'daily': daysPerPeriod = 1; break;
    case 'fortnightly': daysPerPeriod = 15; break;
    case 'monthly': daysPerPeriod = 30; break; 
    case 'weekly':
    default: daysPerPeriod = 7; break;
  }
  
  return daysLate > 0 ? Math.floor(daysLate / daysPerPeriod) : 0;
}

module.exports = (models) => {
  const { Sale, Client, Payment } = models; 

  router.get('/overdue', async (req, res) => {
    try {
      const sales = await Sale.findAll({
        where: { isCredit: true, balanceDue: { [Op.gt]: 0 } }, 
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
      const out = [];

      for (const sale of sales) {
        const client = sale.client;
        if (!client) continue;

        const balanceDue = N(sale.balanceDue); // Usamos N() para seguridad
        if (balanceDue <= 0) continue; 
        
        const payments = [...(sale.payments || [])].sort((a, b) => new Date(b.paymentDate) - new Date(a.paymentDate));
        const lastBaseDate = payments.length
            ? new Date(payments[0].paymentDate)
            : new Date(sale.saleDate); 
        
        let nextDue = getNextDueDate(lastBaseDate, sale.paymentFrequency);
        
        const isOverdue = nextDue.getTime() < today.getTime(); 
        if (isOverdue) {
            const daysLate = Math.floor((today.getTime() - nextDue.getTime()) / (24 * 60 * 60 * 1000));
            const overdueCount = estimateOverdueCount(sale, daysLate);
            const severity = deriveSeverity({ daysLate, balanceDue, overdueCount });
            
            if (severity) {
                out.push({
                    client: client.toJSON(),
                    sale: {
                        id: sale.id,
                        balanceDue,
                        weeklyPaymentAmount: N(sale.weeklyPaymentAmount), 
                        totalAmount: N(sale.totalAmount),               
                        nextDueDate: nextDue.toISOString(),
                        paymentFrequency: sale.paymentFrequency,
                    },
                    daysLate,
                    overdueCount,
                    severity, 
                });
            }
        } 
        
        const daysToDue = Math.ceil((nextDue.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
        if (!isOverdue && daysToDue <= 7 && daysToDue >= 0) { 
             out.push({
                client: client.toJSON(),
                sale: {
                    id: sale.id,
                    balanceDue,
                    weeklyPaymentAmount: N(sale.weeklyPaymentAmount), 
                    totalAmount: N(sale.totalAmount),               
                    nextDueDate: nextDue.toISOString(),
                    paymentFrequency: sale.paymentFrequency,
                },
                daysLate: 0, 
                overdueCount: 0,
                severity: 'POR_VENCER', 
            });
        }
      }

      res.json(out);
    } catch (err) {
      console.error('GET /api/reminders/overdue error:', err);
      res.status(500).json({ message: 'Error al calcular recordatorios de pago.' });
    }
  });

  return router;
};
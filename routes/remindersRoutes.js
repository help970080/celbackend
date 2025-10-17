// routes/remindersRoutes.js

const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const authorizeRoles = require('../middleware/roleMiddleware');

// Importar utilidades de fecha del módulo de reportes (asumiendo que está en el mismo nivel)
// Si no puedes usar require directamente, ajusta la importación según tu estructura.
const { startOfDay, getNextDueDate, N } = require('./reportRoutes'); 

// Referencias a Modelos
let Sale, Client, User, Payment, CollectionLog; // Añadimos CollectionLog

// Función principal de lógica para los recordatorios
const fetchRemindersLogic = async () => {
    // 1. Obtener todas las ventas a crédito activas
    const sales = await Sale.findAll({
        where: { isCredit: true, balanceDue: { [Op.gt]: 0 } },
        include: [
            { model: Client, as: 'client' },
            { model: Payment, as: 'payments', attributes: ['paymentDate'] },
            // CRÍTICO: Incluir el último CollectionLog
            { 
                model: CollectionLog, 
                as: 'collectionLogs', // Usamos el alias definido en models/index.js
                limit: 1, 
                order: [['date', 'DESC']],
                separate: true, // Fuerza una consulta separada para usar LIMIT/ORDER correctamente en el include
                include: [{ model: User, as: 'collector', attributes: ['username'] }] // Quién lo gestionó
            }
        ],
    });

    const today = startOfDay(new Date());
    const msPerDay = 24 * 60 * 60 * 1000;
    const remindersList = [];

    for (const sale of sales) {
        if (N(sale.balanceDue) <= 0) continue; 
        
        // Determinar la última fecha de pago o de venta
        const lastPaymentDate = sale.payments?.length
            ? sale.payments.slice().sort((a, b) => new Date(b.paymentDate) - new Date(a.paymentDate))[0].paymentDate
            : sale.saleDate;

        // Calcular la fecha del próximo vencimiento
        const dueDate = getNextDueDate(lastPaymentDate, sale.paymentFrequency);
        const diffDays = Math.ceil((dueDate.getTime() - today.getTime()) / msPerDay);
        
        let severity = 'POR_VENCER';
        let daysLate = 0;

        if (dueDate < today) {
            daysLate = Math.abs(diffDays);
            severity = daysLate >= 7 ? 'ALTO' : 'BAJO';
        }
        
        // Obtener el último log de gestión
        const lastLog = sale.collectionLogs?.[0];

        remindersList.push({
            severity,
            daysLate,
            client: {
                id: sale.client.id,
                name: sale.client.name,
                lastName: sale.client.lastName,
                phone: sale.client.phone
            },
            sale: {
                id: sale.id,
                balanceDue: sale.balanceDue,
                weeklyPaymentAmount: sale.weeklyPaymentAmount,
                paymentFrequency: sale.paymentFrequency,
            },
            // CRÍTICO: Añadir los datos del último log
            lastManagement: lastLog ? {
                date: lastLog.date,
                result: lastLog.result,
                collector: lastLog.collector?.username || 'N/A'
            } : null
        });
    }

    return remindersList.sort((a, b) => {
        // Primero, ordenar por severidad (ALTO, BAJO, POR_VENCER)
        const order = { 'ALTO': 1, 'BAJO': 2, 'POR_VENCER': 3 };
        if (order[a.severity] !== order[b.severity]) {
            return order[a.severity] - order[b.severity];
        }
        // Segundo, ordenar por días de atraso (más atraso primero)
        return b.daysLate - a.daysLate;
    });
};

// =========================================================
// FUNCIÓN DE INICIALIZACIÓN DE RUTAS
// =========================================================
const initRemindersRoutes = (models) => {
    Sale = models.Sale;
    Client = models.Client;
    User = models.User;
    Payment = models.Payment;
    CollectionLog = models.CollectionLog; // Aseguramos que el modelo esté disponible

    // ---------------------------------------------------
    // GET /api/reminders/overdue - Obtiene la lista de recordatorios y su último seguimiento
    // ---------------------------------------------------
    router.get(
        '/overdue',
        authorizeRoles(['super_admin', 'regular_admin', 'collector_agent']),
        async (req, res) => {
            try {
                const reminders = await fetchRemindersLogic();
                res.json(reminders);
            } catch (err) {
                console.error('Error al obtener recordatorios con gestión:', err);
                res.status(500).json({ message: 'Error interno al cargar la lista de recordatorios.' });
            }
        }
    );

    return router;
};

module.exports = initRemindersRoutes;
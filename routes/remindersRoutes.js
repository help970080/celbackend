// routes/remindersRoutes.js - VERSIÓN CORREGIDA

const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const authorizeRoles = require('../middleware/roleMiddleware');
const applyStoreFilter = require('../middleware/storeFilterMiddleware'); // ⭐ NUEVO

// ⭐ CORRECCIÓN: Importar desde utils en lugar de reportRoutes
const { startOfDay, getNextDueDate, N } = require('../utils/dateHelpers');

// Referencias a Modelos
let Sale, Client, User, Payment, CollectionLog;

/**
 * Lógica principal para obtener recordatorios de cobranza
 * @param {Object} storeFilter - Filtro de tienda para multi-tenant
 * @returns {Array} Lista de recordatorios ordenados por severidad
 */
const fetchRemindersLogic = async (storeFilter = {}) => {
    // 1. Obtener todas las ventas a crédito activas (con filtro de tienda)
    const sales = await Sale.findAll({
        where: { 
            isCredit: true, 
            balanceDue: { [Op.gt]: 0 },
            ...storeFilter // ⭐ APLICAR FILTRO MULTI-TENANT
        },
        include: [
            { 
                model: Client, 
                as: 'client',
                attributes: ['id', 'name', 'lastName', 'phone']
            },
            { 
                model: Payment, 
                as: 'payments', 
                attributes: ['paymentDate'],
                order: [['paymentDate', 'DESC']]
            },
            { 
                model: CollectionLog, 
                as: 'collectionLogs',
                limit: 1, 
                order: [['date', 'DESC']],
                separate: true, // Fuerza consulta separada para LIMIT/ORDER
                include: [{ 
                    model: User, 
                    as: 'collector', 
                    attributes: ['username'] 
                }]
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
            ? sale.payments.slice().sort((a, b) => 
                new Date(b.paymentDate) - new Date(a.paymentDate)
              )[0].paymentDate
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
            dueDate: dueDate.toISOString().split('T')[0], // Formato YYYY-MM-DD
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
                saleDate: sale.saleDate
            },
            lastManagement: lastLog ? {
                date: lastLog.date,
                result: lastLog.result,
                notes: lastLog.notes,
                collector: lastLog.collector?.username || 'N/A',
                nextActionDate: lastLog.nextActionDate
            } : null
        });
    }

    // Ordenar por severidad y días de atraso
    return remindersList.sort((a, b) => {
        const order = { 'ALTO': 1, 'BAJO': 2, 'POR_VENCER': 3 };
        if (order[a.severity] !== order[b.severity]) {
            return order[a.severity] - order[b.severity];
        }
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
    CollectionLog = models.CollectionLog;

    /**
     * GET /api/reminders/overdue 
     * Obtiene la lista de recordatorios de cobranza con último seguimiento
     * Roles permitidos: super_admin, regular_admin, collector_agent
     * Multi-tenant: Solo muestra recordatorios de la tienda del usuario
     */
    router.get(
        '/overdue',
        authorizeRoles(['super_admin', 'regular_admin', 'collector_agent']),
        applyStoreFilter, // ⭐ APLICAR FILTRO MULTI-TENANT
        async (req, res) => {
            try {
                const reminders = await fetchRemindersLogic(req.storeFilter);
                
                res.json({
                    success: true,
                    count: reminders.length,
                    reminders: reminders
                });
            } catch (err) {
                console.error('Error al obtener recordatorios con gestión:', err);
                res.status(500).json({ 
                    success: false,
                    message: 'Error interno al cargar la lista de recordatorios.',
                    error: err.message 
                });
            }
        }
    );

    /**
     * GET /api/reminders/summary
     * Obtiene resumen estadístico de recordatorios
     */
    router.get(
        '/summary',
        authorizeRoles(['super_admin', 'regular_admin', 'collector_agent']),
        applyStoreFilter,
        async (req, res) => {
            try {
                const reminders = await fetchRemindersLogic(req.storeFilter);
                
                const summary = {
                    total: reminders.length,
                    alto: reminders.filter(r => r.severity === 'ALTO').length,
                    bajo: reminders.filter(r => r.severity === 'BAJO').length,
                    porVencer: reminders.filter(r => r.severity === 'POR_VENCER').length,
                    totalDebt: reminders.reduce((sum, r) => sum + N(r.sale.balanceDue), 0),
                    withManagement: reminders.filter(r => r.lastManagement !== null).length,
                    withoutManagement: reminders.filter(r => r.lastManagement === null).length
                };
                
                res.json({
                    success: true,
                    summary: summary
                });
            } catch (err) {
                console.error('Error al obtener resumen de recordatorios:', err);
                res.status(500).json({ 
                    success: false,
                    message: 'Error al obtener resumen.',
                    error: err.message 
                });
            }
        }
    );

    return router;
};

module.exports = initRemindersRoutes;
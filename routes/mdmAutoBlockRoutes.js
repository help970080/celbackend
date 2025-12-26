// routes/mdmAutoBlockRoutes.js - Rutas para bloqueo automático por mora
const express = require('express');
const router = express.Router();
const autoBlockService = require('../services/autoBlockService');
const authorizeRoles = require('../middleware/roleMiddleware');
const applyStoreFilter = require('../middleware/storeFilterMiddleware');

const initMdmAutoBlockRoutes = (models) => {
    // Inicializar el servicio con los modelos
    autoBlockService.init(models);

    // =========================================================
    // EJECUTAR CICLO DE VERIFICACIÓN
    // =========================================================

    /**
     * POST /api/mdm-auto/run-cycle
     * Ejecuta el ciclo completo de bloqueos y desbloqueos
     * Solo super_admin puede ejecutar manualmente
     */
    router.post('/run-cycle',
        authorizeRoles(['super_admin']),
        applyStoreFilter,
        async (req, res) => {
            try {
                console.log('🔄 Ejecución manual de ciclo MDM solicitada');
                
                const results = await autoBlockService.runFullCycle(req.storeFilter);
                
                res.json({
                    success: true,
                    message: 'Ciclo de verificación completado',
                    results
                });
            } catch (error) {
                console.error('Error ejecutando ciclo MDM:', error);
                res.status(500).json({
                    success: false,
                    message: 'Error al ejecutar ciclo de verificación',
                    error: error.message
                });
            }
        }
    );

    /**
     * POST /api/mdm-auto/process-blocks
     * Solo procesa bloqueos (sin desbloqueos)
     */
    router.post('/process-blocks',
        authorizeRoles(['super_admin', 'regular_admin']),
        applyStoreFilter,
        async (req, res) => {
            try {
                const results = await autoBlockService.processAutoBlocks(req.storeFilter);
                
                res.json({
                    success: true,
                    message: `${results.blocked} dispositivos bloqueados`,
                    results
                });
            } catch (error) {
                console.error('Error procesando bloqueos:', error);
                res.status(500).json({
                    success: false,
                    message: 'Error al procesar bloqueos',
                    error: error.message
                });
            }
        }
    );

    /**
     * POST /api/mdm-auto/process-unblocks
     * Solo procesa desbloqueos (sin bloqueos)
     */
    router.post('/process-unblocks',
        authorizeRoles(['super_admin', 'regular_admin']),
        applyStoreFilter,
        async (req, res) => {
            try {
                const results = await autoBlockService.processAutoUnblocks(req.storeFilter);
                
                res.json({
                    success: true,
                    message: `${results.unblocked} dispositivos desbloqueados`,
                    results
                });
            } catch (error) {
                console.error('Error procesando desbloqueos:', error);
                res.status(500).json({
                    success: false,
                    message: 'Error al procesar desbloqueos',
                    error: error.message
                });
            }
        }
    );

    // =========================================================
    // REPORTES Y ESTADÍSTICAS
    // =========================================================

    /**
     * GET /api/mdm-auto/stats
     * Obtener estadísticas de dispositivos MDM
     */
    router.get('/stats',
        authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']),
        applyStoreFilter,
        async (req, res) => {
            try {
                const stats = await autoBlockService.getStats(req.storeFilter);
                
                res.json({
                    success: true,
                    stats
                });
            } catch (error) {
                console.error('Error obteniendo estadísticas:', error);
                res.status(500).json({
                    success: false,
                    message: 'Error al obtener estadísticas',
                    error: error.message
                });
            }
        }
    );

    /**
     * GET /api/mdm-auto/at-risk
     * Obtener dispositivos en riesgo de bloqueo
     * (1 día de atraso, se bloquearán mañana si no pagan)
     */
    router.get('/at-risk',
        authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'collector_agent']),
        applyStoreFilter,
        async (req, res) => {
            try {
                const devices = await autoBlockService.getAtRiskDevices(req.storeFilter);
                
                res.json({
                    success: true,
                    count: devices.length,
                    message: devices.length > 0 
                        ? `${devices.length} dispositivos en riesgo de bloqueo`
                        : 'No hay dispositivos en riesgo',
                    devices
                });
            } catch (error) {
                console.error('Error obteniendo dispositivos en riesgo:', error);
                res.status(500).json({
                    success: false,
                    message: 'Error al obtener dispositivos en riesgo',
                    error: error.message
                });
            }
        }
    );

    /**
     * GET /api/mdm-auto/overdue
     * Obtener todas las ventas con dispositivo que tienen atraso
     */
    router.get('/overdue',
        authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'collector_agent']),
        applyStoreFilter,
        async (req, res) => {
            try {
                const salesWithDevices = await autoBlockService.getSalesWithDevices(req.storeFilter);
                
                // Filtrar solo los que tienen atraso
                const overdue = salesWithDevices
                    .filter(item => item.daysLate > 0)
                    .map(item => ({
                        saleId: item.sale.id,
                        clientId: item.sale.client?.id,
                        clientName: `${item.sale.client?.name} ${item.sale.client?.lastName}`,
                        clientPhone: item.sale.client?.phone,
                        deviceNumber: item.sale.device?.deviceNumber,
                        deviceStatus: item.sale.device?.status,
                        daysLate: item.daysLate,
                        dueDate: item.dueDate,
                        balanceDue: item.sale.balanceDue,
                        weeklyPayment: item.sale.weeklyPaymentAmount,
                        isBlocked: item.sale.device?.status === 'locked'
                    }))
                    .sort((a, b) => b.daysLate - a.daysLate); // Mayor atraso primero
                
                res.json({
                    success: true,
                    count: overdue.length,
                    overdue
                });
            } catch (error) {
                console.error('Error obteniendo ventas atrasadas:', error);
                res.status(500).json({
                    success: false,
                    message: 'Error al obtener ventas atrasadas',
                    error: error.message
                });
            }
        }
    );

    // =========================================================
    // ACCIONES MANUALES SOBRE DISPOSITIVOS
    // =========================================================

    /**
     * POST /api/mdm-auto/block/:saleId
     * Bloquear manualmente el dispositivo de una venta
     */
    router.post('/block/:saleId',
        authorizeRoles(['super_admin', 'regular_admin']),
        applyStoreFilter,
        async (req, res) => {
            try {
                const { saleId } = req.params;
                const { reason } = req.body;
                const mdmService = require('../services/mdmService');

                // Buscar la venta con su dispositivo
                const Sale = models.Sale;
                const DeviceMdm = models.DeviceMdm;
                const AuditLog = models.AuditLog;

                const sale = await Sale.findOne({
                    where: {
                        id: saleId,
                        ...req.storeFilter
                    },
                    include: [
                        { model: DeviceMdm, as: 'device' },
                        { model: models.Client, as: 'client' }
                    ]
                });

                if (!sale) {
                    return res.status(404).json({
                        success: false,
                        message: 'Venta no encontrada'
                    });
                }

                if (!sale.device) {
                    return res.status(400).json({
                        success: false,
                        message: 'Esta venta no tiene dispositivo MDM vinculado'
                    });
                }

                if (sale.device.status === 'locked') {
                    return res.status(400).json({
                        success: false,
                        message: 'El dispositivo ya está bloqueado'
                    });
                }

                // Bloquear en MDM
                await mdmService.lockDevice(
                    sale.device.deviceNumber,
                    reason || `Bloqueo manual - Venta #${saleId}`
                );

                // Actualizar estado local
                await sale.device.update({
                    status: 'locked',
                    lastLockedAt: new Date(),
                    lockReason: reason || 'Bloqueo manual'
                });

                // Auditoría
                await AuditLog.create({
                    userId: req.user.userId,
                    username: req.user.username,
                    action: 'BLOQUEO MANUAL MDM',
                    details: `Dispositivo ${sale.device.deviceNumber} bloqueado manualmente. Cliente: ${sale.client?.name} ${sale.client?.lastName}. Razón: ${reason || 'No especificada'}`,
                    tiendaId: req.user.tiendaId
                });

                res.json({
                    success: true,
                    message: `Dispositivo ${sale.device.deviceNumber} bloqueado exitosamente`,
                    device: {
                        deviceNumber: sale.device.deviceNumber,
                        status: 'locked',
                        lockedAt: new Date()
                    }
                });

            } catch (error) {
                console.error('Error bloqueando dispositivo:', error);
                res.status(500).json({
                    success: false,
                    message: 'Error al bloquear dispositivo',
                    error: error.message
                });
            }
        }
    );

    /**
     * POST /api/mdm-auto/unblock/:saleId
     * Desbloquear manualmente el dispositivo de una venta
     */
    router.post('/unblock/:saleId',
        authorizeRoles(['super_admin', 'regular_admin']),
        applyStoreFilter,
        async (req, res) => {
            try {
                const { saleId } = req.params;
                const { reason } = req.body;
                const mdmService = require('../services/mdmService');

                const Sale = models.Sale;
                const DeviceMdm = models.DeviceMdm;
                const AuditLog = models.AuditLog;

                const sale = await Sale.findOne({
                    where: {
                        id: saleId,
                        ...req.storeFilter
                    },
                    include: [
                        { model: DeviceMdm, as: 'device' },
                        { model: models.Client, as: 'client' }
                    ]
                });

                if (!sale) {
                    return res.status(404).json({
                        success: false,
                        message: 'Venta no encontrada'
                    });
                }

                if (!sale.device) {
                    return res.status(400).json({
                        success: false,
                        message: 'Esta venta no tiene dispositivo MDM vinculado'
                    });
                }

                if (sale.device.status !== 'locked') {
                    return res.status(400).json({
                        success: false,
                        message: 'El dispositivo no está bloqueado'
                    });
                }

                // Desbloquear en MDM
                await mdmService.unlockDevice(sale.device.deviceNumber);

                // Actualizar estado local
                await sale.device.update({
                    status: 'active',
                    lastUnlockedAt: new Date(),
                    lockReason: null
                });

                // Auditoría
                await AuditLog.create({
                    userId: req.user.userId,
                    username: req.user.username,
                    action: 'DESBLOQUEO MANUAL MDM',
                    details: `Dispositivo ${sale.device.deviceNumber} desbloqueado manualmente. Cliente: ${sale.client?.name} ${sale.client?.lastName}. Razón: ${reason || 'No especificada'}`,
                    tiendaId: req.user.tiendaId
                });

                res.json({
                    success: true,
                    message: `Dispositivo ${sale.device.deviceNumber} desbloqueado exitosamente`,
                    device: {
                        deviceNumber: sale.device.deviceNumber,
                        status: 'active',
                        unlockedAt: new Date()
                    }
                });

            } catch (error) {
                console.error('Error desbloqueando dispositivo:', error);
                res.status(500).json({
                    success: false,
                    message: 'Error al desbloquear dispositivo',
                    error: error.message
                });
            }
        }
    );

    // =========================================================
    // CONFIGURACIÓN
    // =========================================================

    /**
     * GET /api/mdm-auto/config
     * Obtener configuración actual del sistema de bloqueo
     */
    router.get('/config',
        authorizeRoles(['super_admin']),
        async (req, res) => {
            res.json({
                success: true,
                config: {
                    daysToBlock: parseInt(process.env.MDM_DAYS_TO_BLOCK) || 2,
                    daysToWarn: parseInt(process.env.MDM_DAYS_TO_WARN) || 1,
                    mdmBaseUrl: process.env.MDM_BASE_URL || 'https://mdm.celexpress.org',
                    normalConfigId: process.env.MDM_NORMAL_CONFIG_ID || 1,
                    blockedConfigId: process.env.MDM_BLOCKED_CONFIG_ID || 2
                }
            });
        }
    );

    return router;
};

module.exports = initMdmAutoBlockRoutes;

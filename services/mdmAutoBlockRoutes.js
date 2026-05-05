/**
 * Rutas Auto-bloqueo MDM
 * VERSIÓN AMPLIADA con:
 *  - /list-locked        Lista de equipos bloqueados con datos del cliente
 *  - /list-active        Lista de equipos activos (al corriente)
 *  - /list-all           Lista completa de devices con su estado
 *  - /unlock/:imei       Desbloqueo manual por IMEI (con auditoría)
 *  - /lock/:imei         Bloqueo manual por IMEI (con auditoría)
 *  - /diagnose/:imei     Diagnóstico de un IMEI sin tocarlo
 *  - /diagnose-sale/:id  Diagnóstico de una venta específica
 */

const express = require('express');
const autoBlockService = require('./autoBlockService');
const mdmService = require('./mdmService');

function initMdmAutoBlockRoutes(models) {
    const router = express.Router();
    const { MdmAccount, DeviceMdm, Sale, Client, Payment, AuditLog } = models;

    // ====================================================
    // CICLO COMPLETO Y STATS (existentes)
    // ====================================================

    router.post('/run-cycle', async (req, res) => {
        try {
            const results = await autoBlockService.runFullCycle(models, {
                storeFilter: req.storeFilter || {}
            });
            res.json({ success: true, results });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.get('/stats', async (req, res) => {
        try {
            const stats = await autoBlockService.getStats(models, {
                storeFilter: req.storeFilter || {}
            });
            res.json({ success: true, stats });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.get('/config', async (req, res) => {
        try {
            const accounts = await mdmService.getActiveAccounts(MdmAccount);
            res.json({
                success: true,
                config: {
                    daysToBlock: parseInt(process.env.MDM_DAYS_TO_BLOCK) || 7,
                    phone: process.env.CELEXPRESS_PHONE || 'No configurado',
                    accountsConfigured: accounts.length
                }
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ====================================================
    // NUEVOS: LISTAR EQUIPOS
    // ====================================================

    /**
     * GET /api/mdm-auto/list-locked
     * Lista todos los equipos bloqueados con datos del cliente
     */
    router.get('/list-locked', async (req, res) => {
        try {
            const where = { status: 'locked', ...(req.storeFilter || {}) };

            const devices = await DeviceMdm.findAll({
                where,
                order: [['last_locked_at', 'DESC']]
            });

            // Enriquecer con datos del cliente
            const enriched = await Promise.all(devices.map(async (d) => {
                let saleData = null;
                let clientData = null;

                if (d.sale_id || d.saleId) {
                    const saleId = d.sale_id || d.saleId;
                    try {
                        const sale = await Sale.findByPk(saleId, {
                            include: [{ model: Client, as: 'client' }]
                        });
                        if (sale) {
                            saleData = {
                                id: sale.id,
                                balanceDue: sale.balanceDue,
                                saleDate: sale.saleDate,
                                status: sale.status
                            };
                            if (sale.client) {
                                clientData = {
                                    id: sale.client.id,
                                    name: `${sale.client.name} ${sale.client.lastName || ''}`.trim(),
                                    phone: sale.client.phone || sale.client.telefono,
                                    address: sale.client.address || sale.client.direccion
                                };
                            }
                        }
                    } catch (e) {}
                }

                return {
                    deviceId: d.id,
                    imei: d.imei,
                    deviceNumber: d.device_number,
                    status: d.status,
                    lockedAt: d.last_locked_at,
                    lockReason: d.lock_reason,
                    tiendaId: d.tienda_id,
                    sale: saleData,
                    client: clientData
                };
            }));

            res.json({
                success: true,
                count: enriched.length,
                locked: enriched
            });
        } catch (error) {
            console.error('Error listando bloqueados:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    /**
     * GET /api/mdm-auto/list-active
     * Lista todos los equipos activos
     */
    router.get('/list-active', async (req, res) => {
        try {
            const where = { status: 'active', ...(req.storeFilter || {}) };

            const devices = await DeviceMdm.findAll({
                where,
                order: [['id', 'DESC']],
                limit: 500
            });

            res.json({
                success: true,
                count: devices.length,
                active: devices.map(d => ({
                    deviceId: d.id,
                    imei: d.imei,
                    deviceNumber: d.device_number,
                    status: d.status,
                    lastUnlockedAt: d.last_unlocked_at,
                    tiendaId: d.tienda_id
                }))
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    /**
     * GET /api/mdm-auto/list-all
     * Lista todos los equipos con su estado actual
     */
    router.get('/list-all', async (req, res) => {
        try {
            const where = { ...(req.storeFilter || {}) };

            const devices = await DeviceMdm.findAll({
                where,
                order: [['status', 'ASC'], ['id', 'DESC']]
            });

            const grouped = {
                active: [],
                locked: [],
                wiped: [],
                other: []
            };

            devices.forEach(d => {
                const item = {
                    deviceId: d.id,
                    imei: d.imei,
                    deviceNumber: d.device_number,
                    status: d.status,
                    lockedAt: d.last_locked_at,
                    unlockedAt: d.last_unlocked_at,
                    lockReason: d.lock_reason,
                    tiendaId: d.tienda_id
                };
                if (grouped[d.status]) grouped[d.status].push(item);
                else grouped.other.push(item);
            });

            res.json({
                success: true,
                total: devices.length,
                summary: {
                    active: grouped.active.length,
                    locked: grouped.locked.length,
                    wiped: grouped.wiped.length,
                    other: grouped.other.length
                },
                devices: grouped
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ====================================================
    // NUEVOS: BLOQUEAR / DESBLOQUEAR MANUALMENTE
    // ====================================================

    /**
     * POST /api/mdm-auto/unlock/:imei
     * Desbloqueo manual con auditoría
     * Body opcional: { reason: "Cliente pagó en efectivo", user: "Leo" }
     */
    router.post('/unlock/:imei', async (req, res) => {
        try {
            const { imei } = req.params;
            const { reason, user } = req.body || {};

            // 1. Mandar comando de desbloqueo a Zoho
            const result = await mdmService.unlockDeviceByImei(MdmAccount, imei);

            // 2. Actualizar BD
            const device = await DeviceMdm.findOne({ where: { imei } });
            if (device) {
                await device.update({
                    status: 'active',
                    last_unlocked_at: new Date(),
                    lock_reason: null
                });
            }

            // 3. Auditar
            if (AuditLog) {
                try {
                    await AuditLog.create({
                        tabla: 'devices_mdm',
                        accion: 'DESBLOQUEO MANUAL',
                        descripcion: `IMEI ${imei} desbloqueado manualmente. Razón: ${reason || 'No especificada'}. Por: ${user || 'sistema'}`,
                        tienda_id: device?.tienda_id || null
                    });
                } catch (e) {}
            }

            res.json({
                success: true,
                message: 'Dispositivo desbloqueado manualmente',
                imei,
                reason: reason || null,
                user: user || null,
                result
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    /**
     * POST /api/mdm-auto/lock/:imei
     * Bloqueo manual con auditoría
     * Body opcional: { reason: "...", user: "Leo", message: "msg pantalla" }
     */
    router.post('/lock/:imei', async (req, res) => {
        try {
            const { imei } = req.params;
            const { reason, user, message } = req.body || {};

            const lockMessage = message || `Equipo bloqueado. Contacte a CelExpress: ${process.env.CELEXPRESS_PHONE || ''}`;

            const result = await mdmService.lockDeviceByImei(
                MdmAccount,
                imei,
                lockMessage,
                process.env.CELEXPRESS_PHONE
            );

            const device = await DeviceMdm.findOne({ where: { imei } });
            if (device) {
                await device.update({
                    status: 'locked',
                    last_locked_at: new Date(),
                    lock_reason: `Bloqueo manual: ${reason || 'No especificada'}`
                });
            }

            if (AuditLog) {
                try {
                    await AuditLog.create({
                        tabla: 'devices_mdm',
                        accion: 'BLOQUEO MANUAL',
                        descripcion: `IMEI ${imei} bloqueado manualmente. Razón: ${reason || 'No especificada'}. Por: ${user || 'sistema'}`,
                        tienda_id: device?.tienda_id || null
                    });
                } catch (e) {}
            }

            res.json({
                success: true,
                message: 'Dispositivo bloqueado manualmente',
                imei,
                reason: reason || null,
                user: user || null,
                result
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ====================================================
    // DIAGNÓSTICO
    // ====================================================

    /**
     * GET /api/mdm-auto/diagnose/:imei
     * Ver el estado de un IMEI en Zoho sin tocarlo
     */
    router.get('/diagnose/:imei', async (req, res) => {
        try {
            const result = await mdmService.diagnoseImei(MdmAccount, req.params.imei);
            res.json({ success: true, diagnosis: result });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    /**
     * GET /api/mdm-auto/diagnose-sale/:saleId
     * Ver por qué una venta se está o no bloqueando
     */
    router.get('/diagnose-sale/:saleId', async (req, res) => {
        try {
            const result = await autoBlockService.diagnoseSale(models, req.params.saleId);
            res.json({ success: true, diagnosis: result });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ====================================================
    // TESTS (existentes, conservados)
    // ====================================================

    router.post('/test-lock/:imei', async (req, res) => {
        try {
            const { imei } = req.params;
            const { message } = req.body;

            const result = await mdmService.lockDeviceByImei(
                MdmAccount,
                imei,
                message || 'PRUEBA: Dispositivo bloqueado por CelExpress.',
                process.env.CELEXPRESS_PHONE
            );

            res.json({ success: true, message: 'Dispositivo bloqueado (prueba)', result });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.post('/test-unlock/:imei', async (req, res) => {
        try {
            const result = await mdmService.unlockDeviceByImei(MdmAccount, req.params.imei);
            res.json({ success: true, message: 'Dispositivo desbloqueado (prueba)', result });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    return router;
}

module.exports = initMdmAutoBlockRoutes;

/**
 * mdmAutoBlockRoutes.js — VERSIÓN COMPLETA con:
 *  - Importación masiva desde Zoho
 *  - Bloqueo masivo
 *  - Vinculación manual device <-> venta
 *  - Listados, diagnóstico, bloqueo/desbloqueo manual
 */

const express = require('express');
const autoBlockService = require('./autoBlockService');
const mdmService = require('./mdmService');
const importService = require('./mdmImportService');

function initMdmAutoBlockRoutes(models) {
    const router = express.Router();
    const { MdmAccount, DeviceMdm, Sale, Client, Payment, AuditLog } = models;

    // CICLO Y STATS

    router.post('/run-cycle', async (req, res) => {
        try {
            const results = await autoBlockService.runFullCycle(models, { storeFilter: req.storeFilter || {} });
            res.json({ success: true, results });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.get('/stats', async (req, res) => {
        try {
            const stats = await autoBlockService.getStats(models, { storeFilter: req.storeFilter || {} });
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

    // IMPORTACIÓN

    router.post('/import-from-zoho', async (req, res) => {
        try {
            const results = await importService.importAllFromZoho(models, { storeFilter: req.storeFilter || {} });
            res.json({ success: true, results });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // BLOQUEO MASIVO

    router.post('/lock-all', async (req, res) => {
        try {
            const { reason, message, user } = req.body || {};
            const results = await importService.lockAllDevices(models, {
                reason: reason || 'Bloqueo masivo administrativo',
                message,
                user: user || 'sistema',
                storeFilter: req.storeFilter || {}
            });
            res.json({ success: true, results });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // VINCULACIÓN

    router.get('/orphan-devices', async (req, res) => {
        try {
            const devices = await importService.getOrphanDevices(models, { storeFilter: req.storeFilter || {} });
            res.json({ success: true, count: devices.length, devices });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.get('/sales-without-device', async (req, res) => {
        try {
            const sales = await importService.getSalesWithoutDevice(models, { storeFilter: req.storeFilter || {} });
            res.json({ success: true, count: sales.length, sales });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.post('/link/:deviceId/:saleId', async (req, res) => {
        try {
            const { deviceId, saleId } = req.params;
            const { user } = req.body || {};
            const result = await importService.linkDeviceToSale(models, deviceId, saleId, { user });
            res.json({ success: true, ...result });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.post('/unlink/:deviceId', async (req, res) => {
        try {
            const { deviceId } = req.params;
            const { user } = req.body || {};
            const result = await importService.unlinkDevice(models, deviceId, { user });
            res.json({ success: true, ...result });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // LISTADOS

    router.get('/list-locked', async (req, res) => {
        try {
            const where = { status: 'locked', ...(req.storeFilter || {}) };
            const devices = await DeviceMdm.findAll({ where, order: [['last_locked_at', 'DESC']] });
            const enriched = await Promise.all(devices.map(async (d) => {
                let saleData = null;
                let clientData = null;
                if (d.sale_id) {
                    try {
                        const sale = await Sale.findByPk(d.sale_id, { include: [{ model: Client, as: 'client' }] });
                        if (sale) {
                            saleData = {
                                id: sale.id,
                                balanceDue: sale.balanceDue,
                                saleDate: sale.saleDate,
                                status: sale.status,
                                weeklyPaymentAmount: sale.weeklyPaymentAmount
                            };
                            if (sale.client) {
                                clientData = {
                                    id: sale.client.id,
                                    name: `${sale.client.name || ''} ${sale.client.lastName || ''}`.trim(),
                                    phone: sale.client.phone || sale.client.telefono,
                                    address: sale.client.address || sale.client.direccion
                                };
                            }
                        }
                    } catch (e) {}
                }
                return {
                    deviceId: d.id, imei: d.imei, deviceNumber: d.device_number,
                    status: d.status, lockedAt: d.last_locked_at, lockReason: d.lock_reason,
                    tiendaId: d.tienda_id, sale: saleData, client: clientData
                };
            }));
            res.json({ success: true, count: enriched.length, locked: enriched });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.get('/list-active', async (req, res) => {
        try {
            const where = { status: 'active', ...(req.storeFilter || {}) };
            const devices = await DeviceMdm.findAll({ where, order: [['id', 'DESC']], limit: 500 });
            res.json({
                success: true, count: devices.length,
                active: devices.map(d => ({
                    deviceId: d.id, imei: d.imei, deviceNumber: d.device_number,
                    status: d.status, saleId: d.sale_id, clientId: d.client_id,
                    lastUnlockedAt: d.last_unlocked_at, tiendaId: d.tienda_id
                }))
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // BLOQUEO/DESBLOQUEO MANUAL

    router.post('/unlock/:imei', async (req, res) => {
        try {
            const { imei } = req.params;
            const { reason, user, saleId } = req.body || {};
            const result = await mdmService.unlockDeviceByImei(MdmAccount, imei);

            const device = await DeviceMdm.findOne({ where: { imei } });
            if (device) {
                const updateData = { status: 'active', last_unlocked_at: new Date(), lock_reason: null };
                if (saleId) {
                    const sale = await Sale.findByPk(saleId);
                    if (sale) {
                        updateData.sale_id = sale.id;
                        updateData.client_id = sale.clientId;
                    }
                }
                await device.update(updateData);
            }

            if (AuditLog) {
                try {
                    await AuditLog.create({
                        tabla: 'devices_mdm', accion: 'DESBLOQUEO MANUAL',
                        descripcion: `IMEI ${imei} desbloqueado. Razón: ${reason || 'N/A'}. ${saleId ? 'Vinculado a venta ' + saleId + '. ' : ''}Por: ${user || 'sistema'}`,
                        tienda_id: device?.tienda_id || null
                    });
                } catch (e) {}
            }

            res.json({ success: true, message: 'Desbloqueado', imei, reason, user, result });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.post('/lock/:imei', async (req, res) => {
        try {
            const { imei } = req.params;
            const { reason, user, message } = req.body || {};
            const lockMessage = message || `Equipo bloqueado. Contacte a CelExpress: ${process.env.CELEXPRESS_PHONE || ''}`;
            const result = await mdmService.lockDeviceByImei(MdmAccount, imei, lockMessage, process.env.CELEXPRESS_PHONE);

            const device = await DeviceMdm.findOne({ where: { imei } });
            if (device) {
                await device.update({
                    status: 'locked', last_locked_at: new Date(),
                    lock_reason: `Bloqueo manual: ${reason || 'N/A'}`
                });
            }

            if (AuditLog) {
                try {
                    await AuditLog.create({
                        tabla: 'devices_mdm', accion: 'BLOQUEO MANUAL',
                        descripcion: `IMEI ${imei} bloqueado. Razón: ${reason || 'N/A'}. Por: ${user || 'sistema'}`,
                        tienda_id: device?.tienda_id || null
                    });
                } catch (e) {}
            }

            res.json({ success: true, message: 'Bloqueado', imei, reason, user, result });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // DIAGNÓSTICO

    router.get('/diagnose/:imei', async (req, res) => {
        try {
            const result = await mdmService.diagnoseImei(MdmAccount, req.params.imei);
            res.json({ success: true, diagnosis: result });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.get('/diagnose-sale/:saleId', async (req, res) => {
        try {
            const result = await autoBlockService.diagnoseSale(models, req.params.saleId);
            res.json({ success: true, diagnosis: result });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // TESTS

    router.post('/test-lock/:imei', async (req, res) => {
        try {
            const result = await mdmService.lockDeviceByImei(MdmAccount, req.params.imei,
                req.body?.message || 'PRUEBA: Dispositivo bloqueado por CelExpress.', process.env.CELEXPRESS_PHONE);
            res.json({ success: true, result });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.post('/test-unlock/:imei', async (req, res) => {
        try {
            const result = await mdmService.unlockDeviceByImei(MdmAccount, req.params.imei);
            res.json({ success: true, result });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    return router;
}

module.exports = initMdmAutoBlockRoutes;

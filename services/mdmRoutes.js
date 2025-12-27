/**
 * Rutas MDM Operativas - Bloqueo/Desbloqueo de dispositivos
 */

const express = require('express');
const mdmService = require('./mdmService');

function initMdmRoutes(models) {
    const router = express.Router();
    const { MdmAccount, DeviceMdm, Sale, Client, AuditLog } = models;

    // =========================================================
    // GET /api/mdm/status - Estado del sistema MDM
    // =========================================================
    router.get('/status', async (req, res) => {
        try {
            const accounts = await mdmService.getActiveAccounts(MdmAccount);
            
            if (accounts.length === 0) {
                return res.json({
                    success: false,
                    message: 'No hay cuentas MDM configuradas',
                    accountCount: 0
                });
            }

            let totalDevices = 0;
            let connectedAccounts = 0;

            for (const account of accounts) {
                try {
                    const devices = await mdmService.getDevicesFromAccount(account);
                    totalDevices += devices.filter(d => d.is_removed === 'false').length;
                    connectedAccounts++;
                } catch (error) {
                    // Cuenta con error
                }
            }

            res.json({
                success: true,
                message: 'Sistema MDM operativo',
                accountCount: accounts.length,
                connectedAccounts,
                totalDevices
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // =========================================================
    // GET /api/mdm/devices - Listar todos los dispositivos
    // =========================================================
    router.get('/devices', async (req, res) => {
        try {
            const devices = await mdmService.getAllDevices(MdmAccount);
            const activeDevices = devices.filter(d => d.is_removed === 'false');

            res.json({
                success: true,
                total: activeDevices.length,
                devices: activeDevices.map(d => ({
                    deviceId: d.device_id,
                    deviceName: d.device_name,
                    model: d.model,
                    imei: d.imei,
                    platform: d.platform_type,
                    isLostMode: d.is_lost_mode_enabled,
                    lastContact: d.last_contact_time,
                    accountName: d._accountName
                }))
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // =========================================================
    // GET /api/mdm/devices/search/:imei - Buscar por IMEI
    // =========================================================
    router.get('/devices/search/:imei', async (req, res) => {
        try {
            const { account, device } = await mdmService.findDeviceByImei(MdmAccount, req.params.imei);

            if (!device) {
                return res.status(404).json({ success: false, message: 'Dispositivo no encontrado' });
            }

            res.json({
                success: true,
                device: {
                    deviceId: device.device_id,
                    deviceName: device.device_name,
                    model: device.model,
                    imei: device.imei,
                    platform: device.platform_type,
                    isLostMode: device.is_lost_mode_enabled,
                    lastContact: device.last_contact_time
                },
                account: account.nombre
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // =========================================================
    // POST /api/mdm/devices/:imei/lock - Bloquear dispositivo
    // =========================================================
    router.post('/devices/:imei/lock', async (req, res) => {
        try {
            const { imei } = req.params;
            const { message, phone, reason } = req.body;

            const result = await mdmService.lockDeviceByImei(MdmAccount, imei, message, phone);

            // Actualizar BD local
            if (DeviceMdm) {
                const record = await DeviceMdm.findOne({ where: { imei } });
                if (record) {
                    await record.update({
                        status: 'locked',
                        lastLockedAt: new Date(),
                        lockReason: reason || 'Bloqueo manual'
                    });
                }
            }

            // Auditoría
            if (AuditLog) {
                await AuditLog.create({
                    tabla: 'devices_mdm',
                    accion: 'BLOQUEO MDM',
                    descripcion: `IMEI ${imei} bloqueado. Razón: ${reason || 'Manual'}`,
                    usuarioId: req.user?.id,
                    tiendaId: req.storeFilter?.tienda_id
                });
            }

            res.json({ success: true, message: 'Dispositivo bloqueado', result });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // =========================================================
    // POST /api/mdm/devices/:imei/unlock - Desbloquear dispositivo
    // =========================================================
    router.post('/devices/:imei/unlock', async (req, res) => {
        try {
            const { imei } = req.params;
            const { reason } = req.body;

            const result = await mdmService.unlockDeviceByImei(MdmAccount, imei);

            // Actualizar BD local
            if (DeviceMdm) {
                const record = await DeviceMdm.findOne({ where: { imei } });
                if (record) {
                    await record.update({
                        status: 'active',
                        lastUnlockedAt: new Date(),
                        lockReason: null
                    });
                }
            }

            // Auditoría
            if (AuditLog) {
                await AuditLog.create({
                    tabla: 'devices_mdm',
                    accion: 'DESBLOQUEO MDM',
                    descripcion: `IMEI ${imei} desbloqueado. Razón: ${reason || 'Manual'}`,
                    usuarioId: req.user?.id,
                    tiendaId: req.storeFilter?.tienda_id
                });
            }

            res.json({ success: true, message: 'Dispositivo desbloqueado', result });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // =========================================================
    // POST /api/mdm/devices/:imei/ring - Alarma remota
    // =========================================================
    router.post('/devices/:imei/ring', async (req, res) => {
        try {
            const { account, device } = await mdmService.findDeviceByImei(MdmAccount, req.params.imei);

            if (!device) {
                return res.status(404).json({ success: false, message: 'Dispositivo no encontrado' });
            }

            const result = await mdmService.ringDevice(account, device.device_id);
            res.json({ success: true, message: 'Alarma activada', result });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // =========================================================
    // GET /api/mdm/devices/:imei/location - Ubicación
    // =========================================================
    router.get('/devices/:imei/location', async (req, res) => {
        try {
            const { account, device } = await mdmService.findDeviceByImei(MdmAccount, req.params.imei);

            if (!device) {
                return res.status(404).json({ success: false, message: 'Dispositivo no encontrado' });
            }

            const location = await mdmService.getDeviceLocation(account, device.device_id);
            res.json({ success: true, location });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // =========================================================
    // POST /api/mdm/sales/:saleId/link-device - Vincular a venta
    // =========================================================
    router.post('/sales/:saleId/link-device', async (req, res) => {
        try {
            const { saleId } = req.params;
            const { imei } = req.body;

            if (!imei) {
                return res.status(400).json({ success: false, message: 'IMEI requerido' });
            }

            // Verificar venta
            const sale = await Sale.findByPk(saleId, {
                include: [{ model: Client, as: 'client' }]
            });

            if (!sale) {
                return res.status(404).json({ success: false, message: 'Venta no encontrada' });
            }

            // Buscar dispositivo en ManageEngine
            const { account, device } = await mdmService.findDeviceByImei(MdmAccount, imei);

            if (!device) {
                return res.status(404).json({
                    success: false,
                    message: 'Dispositivo no encontrado en ManageEngine. Asegúrate de que esté enrollado.'
                });
            }

            // Crear o actualizar registro
            let record = await DeviceMdm.findOne({ where: { imei } });

            if (record) {
                await record.update({
                    saleId: sale.id,
                    clientId: sale.clientId,
                    tiendaId: sale.tiendaId,
                    mdmAccountId: account.id
                });
            } else {
                record = await DeviceMdm.create({
                    deviceNumber: device.device_name || `MDM-${imei.slice(-6)}`,
                    imei,
                    serialNumber: device.serial_number,
                    brand: device.product_name,
                    model: device.model,
                    saleId: sale.id,
                    clientId: sale.clientId,
                    status: device.is_lost_mode_enabled ? 'locked' : 'active',
                    tiendaId: sale.tiendaId,
                    mdmAccountId: account.id
                });
            }

            // Auditoría
            if (AuditLog) {
                await AuditLog.create({
                    tabla: 'devices_mdm',
                    accion: 'VINCULAR DISPOSITIVO',
                    descripcion: `IMEI ${imei} vinculado a venta #${saleId}. Cliente: ${sale.client?.nombre}`,
                    usuarioId: req.user?.id,
                    tiendaId: sale.tiendaId
                });
            }

            res.json({
                success: true,
                message: 'Dispositivo vinculado a la venta',
                device: record,
                client: sale.client?.nombre
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    return router;
}

module.exports = initMdmRoutes;

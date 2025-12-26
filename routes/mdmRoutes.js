// routes/mdmRoutes.js - Rutas de integración MDM para CelExpress
const express = require('express');
const router = express.Router();
const mdmService = require('../services/mdmService');

let Sale, Client, AuditLog;

const initMdmRoutes = (models) => {
    Sale = models.Sale;
    Client = models.Client;
    AuditLog = models.AuditLog;

    // =========================================================
    // RUTAS DE DISPOSITIVOS MDM
    // =========================================================

    /**
     * GET /api/mdm/devices
     * Obtener lista de todos los dispositivos registrados en MDM
     */
    router.get('/devices', async (req, res) => {
        try {
            const devices = await mdmService.getDevices();
            res.json({
                success: true,
                count: devices.length,
                devices
            });
        } catch (error) {
            console.error('Error obteniendo dispositivos MDM:', error);
            res.status(500).json({
                success: false,
                message: 'Error al obtener dispositivos del MDM',
                error: error.message
            });
        }
    });

    /**
     * GET /api/mdm/devices/:deviceNumber
     * Obtener información de un dispositivo específico
     */
    router.get('/devices/:deviceNumber', async (req, res) => {
        try {
            const { deviceNumber } = req.params;
            const device = await mdmService.findDeviceByNumber(deviceNumber);
            
            if (!device) {
                return res.status(404).json({
                    success: false,
                    message: `Dispositivo ${deviceNumber} no encontrado`
                });
            }

            res.json({
                success: true,
                device
            });
        } catch (error) {
            console.error('Error obteniendo dispositivo:', error);
            res.status(500).json({
                success: false,
                message: 'Error al obtener dispositivo',
                error: error.message
            });
        }
    });

    /**
     * POST /api/mdm/devices
     * Registrar un nuevo dispositivo en MDM
     */
    router.post('/devices', async (req, res) => {
        try {
            const { number, imei, description, clientId, saleId } = req.body;

            if (!number && !imei) {
                return res.status(400).json({
                    success: false,
                    message: 'Se requiere número o IMEI del dispositivo'
                });
            }

            // Crear dispositivo en MDM
            const device = await mdmService.createDevice({
                number: number || imei,
                description: description || `CelExpress - Cliente: ${clientId || 'N/A'}`
            });

            // Registrar en auditoría
            if (AuditLog && req.user) {
                await AuditLog.create({
                    userId: req.user.userId,
                    username: req.user.username,
                    action: 'REGISTRÓ DISPOSITIVO MDM',
                    details: `Dispositivo: ${number || imei}. Cliente ID: ${clientId || 'N/A'}. Venta ID: ${saleId || 'N/A'}`,
                    tiendaId: req.user.tiendaId
                });
            }

            res.status(201).json({
                success: true,
                message: 'Dispositivo registrado exitosamente',
                device
            });
        } catch (error) {
            console.error('Error registrando dispositivo:', error);
            res.status(500).json({
                success: false,
                message: 'Error al registrar dispositivo',
                error: error.message
            });
        }
    });

    // =========================================================
    // RUTAS DE BLOQUEO/DESBLOQUEO
    // =========================================================

    /**
     * POST /api/mdm/devices/:deviceNumber/lock
     * Bloquear un dispositivo
     */
    router.post('/devices/:deviceNumber/lock', async (req, res) => {
        try {
            const { deviceNumber } = req.params;
            const { reason, saleId } = req.body;

            const result = await mdmService.lockDevice(deviceNumber, reason || 'Mora en pagos');

            // Registrar en auditoría
            if (AuditLog && req.user) {
                await AuditLog.create({
                    userId: req.user.userId,
                    username: req.user.username,
                    action: 'BLOQUEÓ DISPOSITIVO',
                    details: `Dispositivo: ${deviceNumber}. Razón: ${reason || 'Mora en pagos'}. Venta ID: ${saleId || 'N/A'}`,
                    tiendaId: req.user.tiendaId
                });
            }

            res.json({
                success: true,
                message: `Dispositivo ${deviceNumber} bloqueado exitosamente`,
                result
            });
        } catch (error) {
            console.error('Error bloqueando dispositivo:', error);
            res.status(500).json({
                success: false,
                message: 'Error al bloquear dispositivo',
                error: error.message
            });
        }
    });

    /**
     * POST /api/mdm/devices/:deviceNumber/unlock
     * Desbloquear un dispositivo
     */
    router.post('/devices/:deviceNumber/unlock', async (req, res) => {
        try {
            const { deviceNumber } = req.params;
            const { saleId } = req.body;

            const result = await mdmService.unlockDevice(deviceNumber);

            // Registrar en auditoría
            if (AuditLog && req.user) {
                await AuditLog.create({
                    userId: req.user.userId,
                    username: req.user.username,
                    action: 'DESBLOQUEÓ DISPOSITIVO',
                    details: `Dispositivo: ${deviceNumber}. Venta ID: ${saleId || 'N/A'}`,
                    tiendaId: req.user.tiendaId
                });
            }

            res.json({
                success: true,
                message: `Dispositivo ${deviceNumber} desbloqueado exitosamente`,
                result
            });
        } catch (error) {
            console.error('Error desbloqueando dispositivo:', error);
            res.status(500).json({
                success: false,
                message: 'Error al desbloquear dispositivo',
                error: error.message
            });
        }
    });

    // =========================================================
    // RUTAS DE ACCIONES REMOTAS
    // =========================================================

    /**
     * POST /api/mdm/devices/:deviceNumber/wipe
     * Borrar datos del dispositivo remotamente
     */
    router.post('/devices/:deviceNumber/wipe', async (req, res) => {
        try {
            const { deviceNumber } = req.params;
            const { confirmation } = req.body;

            // Requiere confirmación explícita
            if (confirmation !== 'CONFIRMAR_WIPE') {
                return res.status(400).json({
                    success: false,
                    message: 'Se requiere confirmación. Envía { confirmation: "CONFIRMAR_WIPE" }'
                });
            }

            const result = await mdmService.wipeDevice(deviceNumber);

            // Registrar en auditoría
            if (AuditLog && req.user) {
                await AuditLog.create({
                    userId: req.user.userId,
                    username: req.user.username,
                    action: 'WIPE REMOTO',
                    details: `Dispositivo: ${deviceNumber} - DATOS BORRADOS`,
                    tiendaId: req.user.tiendaId
                });
            }

            res.json({
                success: true,
                message: `Wipe remoto enviado a dispositivo ${deviceNumber}`,
                result
            });
        } catch (error) {
            console.error('Error haciendo wipe:', error);
            res.status(500).json({
                success: false,
                message: 'Error al hacer wipe del dispositivo',
                error: error.message
            });
        }
    });

    /**
     * POST /api/mdm/devices/:deviceNumber/reboot
     * Reiniciar dispositivo remotamente
     */
    router.post('/devices/:deviceNumber/reboot', async (req, res) => {
        try {
            const { deviceNumber } = req.params;
            const result = await mdmService.rebootDevice(deviceNumber);

            res.json({
                success: true,
                message: `Comando de reinicio enviado a ${deviceNumber}`,
                result
            });
        } catch (error) {
            console.error('Error reiniciando dispositivo:', error);
            res.status(500).json({
                success: false,
                message: 'Error al reiniciar dispositivo',
                error: error.message
            });
        }
    });

    /**
     * GET /api/mdm/devices/:deviceNumber/location
     * Obtener ubicación del dispositivo
     */
    router.get('/devices/:deviceNumber/location', async (req, res) => {
        try {
            const { deviceNumber } = req.params;
            const location = await mdmService.getDeviceLocation(deviceNumber);

            res.json({
                success: true,
                deviceNumber,
                location
            });
        } catch (error) {
            console.error('Error obteniendo ubicación:', error);
            res.status(500).json({
                success: false,
                message: 'Error al obtener ubicación',
                error: error.message
            });
        }
    });

    // =========================================================
    // RUTAS DE CONFIGURACIONES
    // =========================================================

    /**
     * GET /api/mdm/configurations
     * Obtener configuraciones disponibles en MDM
     */
    router.get('/configurations', async (req, res) => {
        try {
            const configurations = await mdmService.getConfigurations();
            res.json({
                success: true,
                configurations
            });
        } catch (error) {
            console.error('Error obteniendo configuraciones:', error);
            res.status(500).json({
                success: false,
                message: 'Error al obtener configuraciones',
                error: error.message
            });
        }
    });

    // =========================================================
    // RUTAS DE INTEGRACIÓN CON VENTAS
    // =========================================================

    /**
     * POST /api/mdm/sales/:saleId/link-device
     * Vincular un dispositivo MDM a una venta
     */
    router.post('/sales/:saleId/link-device', async (req, res) => {
        try {
            const { saleId } = req.params;
            const { deviceNumber, imei } = req.body;

            if (!deviceNumber && !imei) {
                return res.status(400).json({
                    success: false,
                    message: 'Se requiere número o IMEI del dispositivo'
                });
            }

            // Buscar la venta
            const sale = await Sale.findByPk(saleId, {
                include: [{ model: Client, as: 'client' }]
            });

            if (!sale) {
                return res.status(404).json({
                    success: false,
                    message: 'Venta no encontrada'
                });
            }

            // Verificar que el dispositivo existe en MDM
            let device = await mdmService.findDeviceByNumber(deviceNumber || imei);
            
            // Si no existe, crearlo
            if (!device) {
                device = await mdmService.createDevice({
                    number: deviceNumber || imei,
                    description: `CelExpress - ${sale.client?.name || 'Cliente'} - Venta #${saleId}`
                });
            }

            // Guardar el deviceNumber en la venta (necesitarás agregar este campo al modelo Sale)
            // sale.mdmDeviceNumber = deviceNumber || imei;
            // await sale.save();

            // Registrar en auditoría
            if (AuditLog && req.user) {
                await AuditLog.create({
                    userId: req.user.userId,
                    username: req.user.username,
                    action: 'VINCULÓ DISPOSITIVO A VENTA',
                    details: `Dispositivo: ${deviceNumber || imei} vinculado a Venta ID: ${saleId}`,
                    tiendaId: req.user.tiendaId
                });
            }

            res.json({
                success: true,
                message: 'Dispositivo vinculado a la venta exitosamente',
                saleId,
                deviceNumber: deviceNumber || imei,
                device
            });
        } catch (error) {
            console.error('Error vinculando dispositivo a venta:', error);
            res.status(500).json({
                success: false,
                message: 'Error al vincular dispositivo',
                error: error.message
            });
        }
    });

    /**
     * POST /api/mdm/sales/:saleId/check-status
     * Verificar estado de mora y bloquear/desbloquear según corresponda
     */
    router.post('/sales/:saleId/check-status', async (req, res) => {
        try {
            const { saleId } = req.params;
            const { deviceNumber } = req.body;

            if (!deviceNumber) {
                return res.status(400).json({
                    success: false,
                    message: 'Se requiere el número del dispositivo'
                });
            }

            const sale = await Sale.findByPk(saleId);

            if (!sale) {
                return res.status(404).json({
                    success: false,
                    message: 'Venta no encontrada'
                });
            }

            let action = null;
            let result = null;

            // Si la venta está pagada, desbloquear
            if (sale.status === 'paid_off' || sale.balanceDue <= 0) {
                result = await mdmService.unlockDevice(deviceNumber);
                action = 'unlocked';
            }
            // Si tiene saldo pendiente y está en mora (puedes agregar lógica de días de mora)
            else if (sale.isCredit && sale.balanceDue > 0) {
                // Aquí podrías verificar días de mora antes de bloquear
                // Por ahora, solo informamos el estado
                action = 'pending';
            }

            res.json({
                success: true,
                saleId,
                deviceNumber,
                saleStatus: sale.status,
                balanceDue: sale.balanceDue,
                action,
                result
            });
        } catch (error) {
            console.error('Error verificando estado:', error);
            res.status(500).json({
                success: false,
                message: 'Error al verificar estado',
                error: error.message
            });
        }
    });

    // =========================================================
    // RUTA DE ESTADO/HEALTH CHECK
    // =========================================================

    /**
     * GET /api/mdm/status
     * Verificar conexión con el servidor MDM
     */
    router.get('/status', async (req, res) => {
        try {
            await mdmService.authenticate();
            res.json({
                success: true,
                message: 'Conexión con MDM establecida',
                mdmUrl: process.env.MDM_BASE_URL || 'https://mdm.celexpress.org'
            });
        } catch (error) {
            res.status(503).json({
                success: false,
                message: 'Error conectando con MDM',
                error: error.message
            });
        }
    });

    return router;
};

module.exports = initMdmRoutes;

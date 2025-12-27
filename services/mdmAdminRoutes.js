/**
 * Rutas Admin para gestionar cuentas MDM
 * Solo accesible por Super Admin
 */

const express = require('express');
const mdmService = require('./mdmService');

function initMdmAdminRoutes(models) {
    const router = express.Router();
    const { MdmAccount, Store, AuditLog } = models;

    // Middleware: Solo Super Admin
    const superAdminOnly = (req, res, next) => {
        const role = req.user?.role;
        if (role !== 'superadmin' && role !== 'super_admin') {
            return res.status(403).json({ success: false, message: 'Acceso denegado. Solo Super Admin.' });
        }
        next();
    };

    router.use(superAdminOnly);

    // =========================================================
    // GET /api/mdm-admin/accounts - Listar todas las cuentas
    // =========================================================
    router.get('/accounts', async (req, res) => {
        try {
            const accounts = await MdmAccount.findAll({
                include: [{ model: Store, as: 'store', attributes: ['id', 'nombre'] }],
                order: [['id', 'ASC']]
            });

            // No enviar credenciales completas
            const safeAccounts = accounts.map(acc => ({
                id: acc.id,
                nombre: acc.nombre,
                email: acc.email,
                clientId: acc.clientId ? `${acc.clientId.substring(0, 15)}...` : null,
                tiendaId: acc.tiendaId,
                tiendaNombre: acc.store?.nombre,
                activo: acc.activo,
                lastStatus: acc.lastStatus,
                lastCheckedAt: acc.lastCheckedAt,
                deviceCount: acc.deviceCount,
                notas: acc.notas,
                createdAt: acc.createdAt
            }));

            res.json({ success: true, accounts: safeAccounts });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // =========================================================
    // POST /api/mdm-admin/accounts - Crear nueva cuenta
    // =========================================================
    router.post('/accounts', async (req, res) => {
        try {
            const { nombre, email, clientId, clientSecret, refreshToken, tiendaId, notas } = req.body;

            if (!nombre || !clientId || !clientSecret || !refreshToken) {
                return res.status(400).json({
                    success: false,
                    message: 'Campos requeridos: nombre, clientId, clientSecret, refreshToken'
                });
            }

            // Crear cuenta
            const account = await MdmAccount.create({
                nombre,
                email,
                clientId,
                clientSecret,
                refreshToken,
                tiendaId: tiendaId || null,
                notas,
                activo: true
            });

            // Probar conexión
            const testResult = await mdmService.testAccountConnection(account);

            // Auditoría
            if (AuditLog) {
                await AuditLog.create({
                    tabla: 'mdm_accounts',
                    accion: 'CREAR CUENTA MDM',
                    descripcion: `Cuenta MDM "${nombre}" creada. Estado: ${testResult.success ? 'OK' : 'Error'}`,
                    usuarioId: req.user?.id
                });
            }

            res.json({
                success: true,
                message: 'Cuenta MDM creada',
                account: {
                    id: account.id,
                    nombre: account.nombre,
                    activo: account.activo
                },
                connectionTest: testResult
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // =========================================================
    // GET /api/mdm-admin/accounts/:id - Obtener cuenta
    // =========================================================
    router.get('/accounts/:id', async (req, res) => {
        try {
            const account = await MdmAccount.findByPk(req.params.id, {
                include: [{ model: Store, as: 'store', attributes: ['id', 'nombre'] }]
            });

            if (!account) {
                return res.status(404).json({ success: false, message: 'Cuenta no encontrada' });
            }

            res.json({
                success: true,
                account: {
                    id: account.id,
                    nombre: account.nombre,
                    email: account.email,
                    clientId: account.clientId ? `${account.clientId.substring(0, 15)}...` : null,
                    hasClientSecret: !!account.clientSecret,
                    hasRefreshToken: !!account.refreshToken,
                    tiendaId: account.tiendaId,
                    tiendaNombre: account.store?.nombre,
                    activo: account.activo,
                    lastStatus: account.lastStatus,
                    lastCheckedAt: account.lastCheckedAt,
                    deviceCount: account.deviceCount,
                    notas: account.notas,
                    createdAt: account.createdAt,
                    updatedAt: account.updatedAt
                }
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // =========================================================
    // PUT /api/mdm-admin/accounts/:id - Actualizar cuenta
    // =========================================================
    router.put('/accounts/:id', async (req, res) => {
        try {
            const account = await MdmAccount.findByPk(req.params.id);

            if (!account) {
                return res.status(404).json({ success: false, message: 'Cuenta no encontrada' });
            }

            const { nombre, email, clientId, clientSecret, refreshToken, tiendaId, activo, notas } = req.body;

            const updateData = {};
            if (nombre !== undefined) updateData.nombre = nombre;
            if (email !== undefined) updateData.email = email;
            if (clientId) updateData.clientId = clientId;
            if (clientSecret) updateData.clientSecret = clientSecret;
            if (refreshToken) updateData.refreshToken = refreshToken;
            if (tiendaId !== undefined) updateData.tiendaId = tiendaId;
            if (activo !== undefined) updateData.activo = activo;
            if (notas !== undefined) updateData.notas = notas;

            await account.update(updateData);

            // Si se actualizaron credenciales, probar conexión
            let testResult = null;
            if (clientId || clientSecret || refreshToken) {
                testResult = await mdmService.testAccountConnection(account);
            }

            // Auditoría
            if (AuditLog) {
                await AuditLog.create({
                    tabla: 'mdm_accounts',
                    accion: 'ACTUALIZAR CUENTA MDM',
                    descripcion: `Cuenta MDM "${account.nombre}" actualizada`,
                    usuarioId: req.user?.id
                });
            }

            res.json({
                success: true,
                message: 'Cuenta actualizada',
                connectionTest: testResult
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // =========================================================
    // DELETE /api/mdm-admin/accounts/:id - Eliminar cuenta
    // =========================================================
    router.delete('/accounts/:id', async (req, res) => {
        try {
            const account = await MdmAccount.findByPk(req.params.id);

            if (!account) {
                return res.status(404).json({ success: false, message: 'Cuenta no encontrada' });
            }

            const nombre = account.nombre;
            await account.destroy();

            // Auditoría
            if (AuditLog) {
                await AuditLog.create({
                    tabla: 'mdm_accounts',
                    accion: 'ELIMINAR CUENTA MDM',
                    descripcion: `Cuenta MDM "${nombre}" eliminada`,
                    usuarioId: req.user?.id
                });
            }

            res.json({ success: true, message: 'Cuenta eliminada' });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // =========================================================
    // POST /api/mdm-admin/accounts/:id/test - Probar conexión
    // =========================================================
    router.post('/accounts/:id/test', async (req, res) => {
        try {
            const account = await MdmAccount.findByPk(req.params.id);

            if (!account) {
                return res.status(404).json({ success: false, message: 'Cuenta no encontrada' });
            }

            const result = await mdmService.testAccountConnection(account);

            res.json({
                success: true,
                account: account.nombre,
                test: result
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // =========================================================
    // GET /api/mdm-admin/accounts/:id/devices - Dispositivos de una cuenta
    // =========================================================
    router.get('/accounts/:id/devices', async (req, res) => {
        try {
            const account = await MdmAccount.findByPk(req.params.id);

            if (!account) {
                return res.status(404).json({ success: false, message: 'Cuenta no encontrada' });
            }

            const devices = await mdmService.getDevicesFromAccount(account);
            const activeDevices = devices.filter(d => d.is_removed === 'false');

            res.json({
                success: true,
                account: account.nombre,
                total: activeDevices.length,
                devices: activeDevices.map(d => ({
                    deviceId: d.device_id,
                    deviceName: d.device_name,
                    model: d.model,
                    imei: d.imei,
                    platform: d.platform_type,
                    isLostMode: d.is_lost_mode_enabled,
                    lastContact: d.last_contact_time
                }))
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // =========================================================
    // GET /api/mdm-admin/status - Estado general de todas las cuentas
    // =========================================================
    router.get('/status', async (req, res) => {
        try {
            const results = await mdmService.checkAllAccounts(MdmAccount);

            const summary = {
                totalAccounts: results.length,
                activeAccounts: results.filter(r => r.activo).length,
                connectedAccounts: results.filter(r => r.success).length,
                totalDevices: results.reduce((sum, r) => sum + (r.deviceCount || 0), 0)
            };

            res.json({
                success: true,
                summary,
                accounts: results
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // =========================================================
    // GET /api/mdm-admin/stores - Listar tiendas para asignar
    // =========================================================
    router.get('/stores', async (req, res) => {
        try {
            const stores = await Store.findAll({
                attributes: ['id', 'nombre'],
                order: [['nombre', 'ASC']]
            });

            res.json({ success: true, stores });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    return router;
}

module.exports = initMdmAdminRoutes;

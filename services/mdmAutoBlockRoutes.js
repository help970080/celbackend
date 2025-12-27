/**
 * Rutas Auto-bloqueo MDM
 */

const express = require('express');
const autoBlockService = require('./autoBlockService');
const mdmService = require('./mdmService');

function initMdmAutoBlockRoutes(models) {
    const router = express.Router();
    const { MdmAccount } = models;

    // POST /api/mdm-auto/run-cycle - Ejecutar ciclo completo
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

    // GET /api/mdm-auto/stats - Estadísticas
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

    // GET /api/mdm-auto/config - Ver configuración
    router.get('/config', async (req, res) => {
        try {
            const accounts = await mdmService.getActiveAccounts(MdmAccount);
            
            res.json({
                success: true,
                config: {
                    daysToBlock: parseInt(process.env.MDM_DAYS_TO_BLOCK) || 2,
                    phone: process.env.CELEXPRESS_PHONE || 'No configurado',
                    accountsConfigured: accounts.length
                }
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // POST /api/mdm-auto/test-lock/:imei - Probar bloqueo
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

    // POST /api/mdm-auto/test-unlock/:imei - Probar desbloqueo
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

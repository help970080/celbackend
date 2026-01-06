// routes/backupRoutes.js - Rutas para gestionar backups
const express = require('express');
const { executeFullBackup, listBackups } = require('../services/backupService');

function initBackupRoutes() {
    const router = express.Router();

    // =========================================================
    // POST /ejecutar - Ejecutar backup manual
    // =========================================================
    router.post('/ejecutar', async (req, res) => {
        try {
            // Solo super_admin puede ejecutar backups
            if (req.user.role !== 'super_admin') {
                return res.status(403).json({ 
                    success: false, 
                    message: 'Solo el administrador puede ejecutar backups' 
                });
            }

            console.log(`🗄️  Backup manual iniciado por ${req.user.username}`);
            
            const resultado = await executeFullBackup();
            
            if (resultado.success) {
                res.json({
                    success: true,
                    message: 'Backup completado exitosamente',
                    fileName: resultado.fileName,
                    driveLink: resultado.driveLink,
                    timestamp: resultado.timestamp
                });
            } else {
                res.status(500).json({
                    success: false,
                    message: 'Error al crear backup',
                    error: resultado.error
                });
            }
        } catch (error) {
            console.error('Error en backup manual:', error);
            res.status(500).json({ 
                success: false, 
                error: error.message 
            });
        }
    });

    // =========================================================
    // GET /lista - Listar backups disponibles
    // =========================================================
    router.get('/lista', async (req, res) => {
        try {
            // Solo super_admin puede ver backups
            if (req.user.role !== 'super_admin') {
                return res.status(403).json({ 
                    success: false, 
                    message: 'Solo el administrador puede ver backups' 
                });
            }

            const resultado = await listBackups();
            
            res.json(resultado);
        } catch (error) {
            console.error('Error listando backups:', error);
            res.status(500).json({ 
                success: false, 
                error: error.message 
            });
        }
    });

    // =========================================================
    // GET /estado - Estado del sistema de backups
    // =========================================================
    router.get('/estado', async (req, res) => {
        try {
            const ahora = new Date();
            const mexico = new Date(ahora.toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
            
            let proximoBackup = new Date(mexico);
            proximoBackup.setHours(3, 0, 0, 0);
            if (mexico >= proximoBackup) {
                proximoBackup.setDate(proximoBackup.getDate() + 1);
            }

            res.json({
                success: true,
                sistemaActivo: true,
                horaActualMexico: mexico.toLocaleString('es-MX'),
                proximoBackup: proximoBackup.toLocaleString('es-MX'),
                frecuencia: 'Diario a las 3:00 AM (México)',
                destino: 'Google Drive - Backups-CelExpress'
            });
        } catch (error) {
            res.status(500).json({ 
                success: false, 
                error: error.message 
            });
        }
    });

    return router;
}

module.exports = initBackupRoutes;

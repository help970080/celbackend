// cron/backupCronJob.js - Ejecuta backups automáticos diariamente
const { executeFullBackup } = require('../services/backupService');

let backupInterval = null;

/**
 * Inicia el cron job de backups automáticos
 * Se ejecuta todos los días a las 3:00 AM (hora México)
 */
function startBackupCronJob() {
    console.log('🗄️  Iniciando cron job de backups automáticos...');

    // Calcular tiempo hasta las 3:00 AM
    const calcularTiempoHasta3AM = () => {
        const ahora = new Date();
        const mexico = new Date(ahora.toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
        
        let target = new Date(mexico);
        target.setHours(3, 0, 0, 0);
        
        // Si ya pasaron las 3 AM, programar para mañana
        if (mexico >= target) {
            target.setDate(target.getDate() + 1);
        }
        
        return target - mexico;
    };

    // Función para ejecutar backup y reprogramar
    const ejecutarYReprogramar = async () => {
        await executeFullBackup();
        
        // Programar siguiente backup en 24 horas
        backupInterval = setTimeout(ejecutarYReprogramar, 24 * 60 * 60 * 1000);
    };

    // Programar primer backup
    const tiempoHasta3AM = calcularTiempoHasta3AM();
    const horasRestantes = Math.round(tiempoHasta3AM / 1000 / 60 / 60 * 10) / 10;
    
    console.log(`   ⏰ Próximo backup en ${horasRestantes} horas (3:00 AM México)`);
    
    backupInterval = setTimeout(ejecutarYReprogramar, tiempoHasta3AM);

    console.log('✅ Cron job de backups programado (diario a las 3:00 AM)');
}

/**
 * Detiene el cron job de backups
 */
function stopBackupCronJob() {
    if (backupInterval) {
        clearTimeout(backupInterval);
        backupInterval = null;
        console.log('🛑 Cron job de backups detenido');
    }
}

module.exports = { startBackupCronJob, stopBackupCronJob };

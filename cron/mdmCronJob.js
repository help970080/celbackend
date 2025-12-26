// cron/mdmCronJob.js - Tarea programada para bloqueo automático
const autoBlockService = require('../services/autoBlockService');

/**
 * Ejecutar verificación de bloqueos automáticos
 * Se recomienda ejecutar cada hora o cada 30 minutos
 */
const runMdmCheck = async () => {
    console.log('⏰ [CRON] Iniciando verificación MDM programada...');
    console.log(`   Hora: ${new Date().toISOString()}`);
    
    try {
        // Ejecutar ciclo completo (bloqueos + desbloqueos)
        // Sin filtro de tienda = procesa todas las tiendas
        const results = await autoBlockService.runFullCycle();
        
        console.log('✅ [CRON] Verificación MDM completada');
        console.log(`   Bloqueados: ${results.blocks.blocked}`);
        console.log(`   Desbloqueados: ${results.unblocks.unblocked}`);
        console.log(`   Errores: ${results.blocks.errors.length + results.unblocks.errors.length}`);
        
        return results;
    } catch (error) {
        console.error('❌ [CRON] Error en verificación MDM:', error);
        throw error;
    }
};

/**
 * Configurar intervalo de ejecución
 * @param {number} intervalMs - Intervalo en milisegundos
 */
const startCronJob = (intervalMs = 3600000) => { // Default: 1 hora
    console.log(`🕐 [CRON] Iniciando job de verificación MDM cada ${intervalMs / 60000} minutos`);
    
    // Ejecutar inmediatamente al iniciar
    runMdmCheck().catch(err => console.error('Error en ejecución inicial:', err));
    
    // Configurar intervalo
    const intervalId = setInterval(() => {
        runMdmCheck().catch(err => console.error('Error en ejecución programada:', err));
    }, intervalMs);
    
    return intervalId;
};

/**
 * Configuración alternativa con horarios específicos
 * Ejemplo: Ejecutar a las 8am, 12pm, 4pm y 8pm
 */
const startScheduledJob = () => {
    const checkHours = [8, 12, 16, 20]; // Horas del día para verificar
    
    console.log(`🕐 [CRON] Job programado para las horas: ${checkHours.join(', ')}`);
    
    const checkAndRun = () => {
        const now = new Date();
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        
        // Ejecutar si estamos en una de las horas programadas (primeros 5 minutos)
        if (checkHours.includes(currentHour) && currentMinute < 5) {
            console.log(`⏰ [CRON] Hora programada: ${currentHour}:00`);
            runMdmCheck().catch(err => console.error('Error:', err));
        }
    };
    
    // Verificar cada minuto
    setInterval(checkAndRun, 60000);
    
    // Ejecutar verificación inicial
    runMdmCheck().catch(err => console.error('Error en ejecución inicial:', err));
};

module.exports = {
    runMdmCheck,
    startCronJob,
    startScheduledJob
};

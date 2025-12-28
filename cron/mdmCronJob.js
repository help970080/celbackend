// cron/mdmCronJob.js - Tarea programada para bloqueo automático
// CORREGIDO: Recibe models como parámetro

let autoBlockService;
let modelsRef;

/**
 * Inicializar el cron job con los modelos
 * @param {object} models - Modelos de Sequelize
 */
const initCronJob = (models) => {
    modelsRef = models;
    autoBlockService = require('../services/autoBlockService');
    console.log('✅ [CRON] Servicio de auto-bloqueo inicializado');
};

/**
 * Ejecutar verificación de bloqueos automáticos
 */
const runMdmCheck = async () => {
    if (!modelsRef) {
        console.error('❌ [CRON] Models no inicializados. Llama initCronJob primero.');
        return;
    }

    console.log('⏰ [CRON] Iniciando verificación MDM programada...');
    console.log(`   Hora: ${new Date().toISOString()}`);
    
    try {
        // Ejecutar ciclo completo (bloqueos + desbloqueos)
        const results = await autoBlockService.runFullCycle(modelsRef);
        
        console.log('✅ [CRON] Verificación MDM completada');
        console.log(`   Bloqueados: ${results.blocks.blocked}`);
        console.log(`   Desbloqueados: ${results.unblocks.unblocked}`);
        console.log(`   Errores: ${results.blocks.errors.length + results.unblocks.errors.length}`);
        
        return results;
    } catch (error) {
        console.error('❌ [CRON] Error en verificación MDM:', error.message);
        throw error;
    }
};

/**
 * Configurar intervalo de ejecución
 * @param {object} models - Modelos de Sequelize
 * @param {number} intervalMs - Intervalo en milisegundos (default: 1 hora)
 */
const startCronJob = (models, intervalMs = 3600000) => {
    // Inicializar con los modelos
    initCronJob(models);
    
    console.log(`🕐 [CRON] Iniciando job de verificación MDM cada ${intervalMs / 60000} minutos`);
    
    // Ejecutar inmediatamente al iniciar
    setTimeout(() => {
        runMdmCheck().catch(err => console.error('Error en ejecución inicial:', err.message));
    }, 5000); // Esperar 5 segundos para que todo esté listo
    
    // Configurar intervalo
    const intervalId = setInterval(() => {
        runMdmCheck().catch(err => console.error('Error en ejecución programada:', err.message));
    }, intervalMs);
    
    return intervalId;
};

/**
 * Configuración alternativa con horarios específicos
 * Ejemplo: Ejecutar a las 8am, 12pm, 4pm y 8pm
 */
const startScheduledJob = (models) => {
    initCronJob(models);
    
    const checkHours = [8, 12, 16, 20]; // Horas del día para verificar
    
    console.log(`🕐 [CRON] Job programado para las horas: ${checkHours.join(', ')}`);
    
    const checkAndRun = () => {
        const now = new Date();
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        
        // Ejecutar si estamos en una de las horas programadas (primeros 5 minutos)
        if (checkHours.includes(currentHour) && currentMinute < 5) {
            console.log(`⏰ [CRON] Hora programada: ${currentHour}:00`);
            runMdmCheck().catch(err => console.error('Error:', err.message));
        }
    };
    
    // Verificar cada minuto
    setInterval(checkAndRun, 60000);
    
    // Ejecutar verificación inicial después de 5 segundos
    setTimeout(() => {
        runMdmCheck().catch(err => console.error('Error en ejecución inicial:', err.message));
    }, 5000);
};

module.exports = {
    initCronJob,
    runMdmCheck,
    startCronJob,
    startScheduledJob
};

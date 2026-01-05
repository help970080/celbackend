// cron/llamadasCronJob.js - Ejecuta llamadas automáticas diariamente
const { realizarLlamada, dentroDeHorario } = require('../services/twilioCallService');

let cronInterval = null;

/**
 * Inicia el cron job de llamadas automáticas
 * Se ejecuta cada hora entre 9 AM y 6 PM
 */
function startLlamadasCronJob(models, sequelize) {
    console.log('🔔 Iniciando cron job de llamadas automáticas...');

    const INTERVALO = 60 * 60 * 1000; // 1 hora

    const ejecutarCiclo = async () => {
        const ahora = new Date();
        console.log(`\n⏰ [CRON LLAMADAS] Verificación: ${ahora.toISOString()}`);

        if (!dentroDeHorario()) {
            console.log('   ⏸️ Fuera de horario (9 AM - 6 PM). Saltando...');
            return;
        }

        try {
            const hoy = new Date();
            hoy.setHours(0, 0, 0, 0);
            
            const manana = new Date(hoy);
            manana.setDate(manana.getDate() + 1);

            // Verificar si nextPaymentDate existe
            const [columnCheck] = await sequelize.query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'sales' 
                AND column_name = 'nextPaymentDate'
            `);
            
            const tieneNextPaymentDate = columnCheck.length > 0;
            
            let query;
            let replacements = { hoy, manana };
            
            if (tieneNextPaymentDate) {
                query = `
                    SELECT 
                        s.id as sale_id,
                        s."clientId" as client_id,
                        c.name as client_name,
                        c.phone as telefono,
                        s."nextPaymentDate" as fecha_vencimiento,
                        s."weeklyPaymentAmount" as monto_pago,
                        s."tienda_id" as tienda_id,
                        CASE 
                            WHEN DATE(s."nextPaymentDate") = DATE(:manana) THEN 'preventivo'
                            WHEN DATE(s."nextPaymentDate") = DATE(:hoy) THEN 'vencimiento'
                        END as tipo_llamada
                    FROM sales s
                    JOIN clients c ON s."clientId" = c.id
                    WHERE s.status = 'active'
                    AND s."balanceDue" > 0
                    AND (
                        DATE(s."nextPaymentDate") = DATE(:manana)
                        OR DATE(s."nextPaymentDate") = DATE(:hoy)
                    )
                    AND c.phone IS NOT NULL
                    AND c.phone != ''
                `;
            } else {
                // Calcular dinámicamente basado en saleDate + 7 días
                query = `
                    SELECT 
                        s.id as sale_id,
                        s."clientId" as client_id,
                        c.name as client_name,
                        c.phone as telefono,
                        (s."saleDate" + INTERVAL '7 days' * 
                            (CEIL(EXTRACT(DAY FROM NOW() - s."saleDate") / 7) + 1)
                        )::DATE as fecha_vencimiento,
                        s."weeklyPaymentAmount" as monto_pago,
                        s."tienda_id" as tienda_id,
                        CASE 
                            WHEN (s."saleDate" + INTERVAL '7 days' * 
                                (CEIL(EXTRACT(DAY FROM NOW() - s."saleDate") / 7) + 1)
                            )::DATE = DATE(:manana) THEN 'preventivo'
                            WHEN (s."saleDate" + INTERVAL '7 days' * 
                                (CEIL(EXTRACT(DAY FROM NOW() - s."saleDate") / 7) + 1)
                            )::DATE = DATE(:hoy) THEN 'vencimiento'
                        END as tipo_llamada
                    FROM sales s
                    JOIN clients c ON s."clientId" = c.id
                    WHERE s.status = 'active'
                    AND s."balanceDue" > 0
                    AND s."weeklyPaymentAmount" > 0
                    AND c.phone IS NOT NULL
                    AND c.phone != ''
                    HAVING 
                        (s."saleDate" + INTERVAL '7 days' * 
                            (CEIL(EXTRACT(DAY FROM NOW() - s."saleDate") / 7) + 1)
                        )::DATE IN (DATE(:hoy), DATE(:manana))
                `;
            }

            const [ventasPendientes] = await sequelize.query(query, { replacements });

            console.log(`   📋 Ventas con pagos próximos: ${ventasPendientes.length}`);

            if (ventasPendientes.length === 0) {
                console.log('   ✅ No hay llamadas pendientes');
                return;
            }

            const [llamadasHoy] = await sequelize.query(`
                SELECT sale_id, tipo FROM llamadas_automaticas WHERE DATE(created_at) = DATE(:hoy)
            `, { replacements: { hoy } });

            const llamadasSet = new Set(llamadasHoy.map(l => `${l.sale_id}-${l.tipo}`));
            const pendientes = ventasPendientes.filter(v => !llamadasSet.has(`${v.sale_id}-${v.tipo_llamada}`));

            console.log(`   📞 Llamadas a ejecutar: ${pendientes.length}`);

            if (pendientes.length === 0) {
                console.log('   ✅ Todas las llamadas del día ya fueron realizadas');
                return;
            }

            let exitosas = 0;
            let fallidas = 0;

            for (const venta of pendientes) {
                try {
                    console.log(`   📞 Llamando a ${venta.client_name} (${venta.telefono})...`);
                    
                    const resultado = await realizarLlamada(
                        venta.telefono,
                        venta.client_name,
                        venta.monto_pago,
                        venta.tipo_llamada,
                        venta.sale_id,
                        venta.client_id
                    );

                    await sequelize.query(`
                        INSERT INTO llamadas_automaticas 
                        (sale_id, client_id, client_name, telefono, monto, tipo, call_sid, status, fecha_vencimiento, tienda_id)
                        VALUES (:saleId, :clientId, :clientName, :telefono, :monto, :tipo, :callSid, :status, :fechaVencimiento, :tiendaId)
                    `, {
                        replacements: {
                            saleId: venta.sale_id,
                            clientId: venta.client_id,
                            clientName: venta.client_name,
                            telefono: venta.telefono,
                            monto: venta.monto_pago,
                            tipo: venta.tipo_llamada,
                            callSid: resultado.callSid || null,
                            status: resultado.success ? 'initiated' : 'failed',
                            fechaVencimiento: venta.fecha_vencimiento,
                            tiendaId: venta.tienda_id
                        }
                    });

                    if (resultado.success) {
                        exitosas++;
                        console.log(`      ✅ Llamada iniciada: ${resultado.callSid}`);
                    } else {
                        fallidas++;
                        console.log(`      ❌ Error: ${resultado.error}`);
                    }

                    await new Promise(resolve => setTimeout(resolve, 3000));

                } catch (error) {
                    console.error(`      ❌ Error con ${venta.client_name}:`, error.message);
                    fallidas++;
                }
            }

            console.log(`\n   📊 Resumen: ${exitosas} exitosas, ${fallidas} fallidas`);

        } catch (error) {
            console.error('❌ [CRON LLAMADAS] Error:', error.message);
            // No propagar el error para que el cron continue
        }
    };

    // Ejecutar 10 segundos después del inicio
    setTimeout(ejecutarCiclo, 10000);

    // Programar ejecución cada hora
    cronInterval = setInterval(ejecutarCiclo, INTERVALO);

    console.log('✅ Cron job de llamadas programado (cada hora, 9 AM - 6 PM)');
}

function stopLlamadasCronJob() {
    if (cronInterval) {
        clearInterval(cronInterval);
        cronInterval = null;
        console.log('🛑 Cron job de llamadas detenido');
    }
}

module.exports = { startLlamadasCronJob, stopLlamadasCronJob };
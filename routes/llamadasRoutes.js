// routes/llamadasRoutes.js - Rutas para llamadas automáticas de cobranza preventiva
const express = require('express');
const { Op } = require('sequelize');
const { realizarLlamada, dentroDeHorario, proximaVentanaLlamadas } = require('../services/twilioCallService');

function initLlamadasRoutes(models, sequelize) {
    const router = express.Router();
    const { Sale, Client, Payment, Store, AuditLog } = models;

    // =========================================================
    // TABLA DE REGISTRO DE LLAMADAS (crear si no existe)
    // =========================================================
    
    const initLlamadasTable = async () => {
        try {
            await sequelize.query(`
                CREATE TABLE IF NOT EXISTS llamadas_automaticas (
                    id SERIAL PRIMARY KEY,
                    sale_id INTEGER NOT NULL,
                    client_id INTEGER NOT NULL,
                    client_name VARCHAR(200),
                    telefono VARCHAR(50),
                    monto DECIMAL(10,2),
                    tipo VARCHAR(20) NOT NULL,
                    call_sid VARCHAR(100),
                    status VARCHAR(50) DEFAULT 'initiated',
                    duration INTEGER DEFAULT 0,
                    answered_by VARCHAR(50),
                    error_message TEXT,
                    fecha_vencimiento DATE,
                    tienda_id INTEGER,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                
                CREATE INDEX IF NOT EXISTS idx_llamadas_sale ON llamadas_automaticas(sale_id);
                CREATE INDEX IF NOT EXISTS idx_llamadas_client ON llamadas_automaticas(client_id);
                CREATE INDEX IF NOT EXISTS idx_llamadas_status ON llamadas_automaticas(status);
                CREATE INDEX IF NOT EXISTS idx_llamadas_tipo ON llamadas_automaticas(tipo);
                CREATE INDEX IF NOT EXISTS idx_llamadas_fecha ON llamadas_automaticas(created_at);
            `);
            console.log('✅ Tabla llamadas_automaticas verificada');
        } catch (error) {
            console.error('Error creando tabla llamadas:', error);
        }
    };
    
    initLlamadasTable();

    // =========================================================
    // WEBHOOK DE TWILIO - Actualizar estado de llamada
    // =========================================================
    
    router.post('/webhook', async (req, res) => {
        try {
            const { CallSid, CallStatus, CallDuration, AnsweredBy } = req.body;
            
            console.log(`📞 Webhook Twilio: ${CallSid} -> ${CallStatus}`);
            
            if (CallSid) {
                await sequelize.query(`
                    UPDATE llamadas_automaticas 
                    SET status = :status,
                        duration = :duration,
                        answered_by = :answeredBy,
                        updated_at = NOW()
                    WHERE call_sid = :callSid
                `, {
                    replacements: {
                        status: CallStatus || 'unknown',
                        duration: CallDuration || 0,
                        answeredBy: AnsweredBy || null,
                        callSid: CallSid
                    }
                });
            }
            
            res.status(200).send('OK');
        } catch (error) {
            console.error('Error en webhook:', error);
            res.status(500).send('Error');
        }
    });

    // =========================================================
    // OBTENER PAGOS PRÓXIMOS A VENCER
    // =========================================================
    
    router.get('/pendientes', async (req, res) => {
        try {
            const hoy = new Date();
            hoy.setHours(0, 0, 0, 0);
            
            const manana = new Date(hoy);
            manana.setDate(manana.getDate() + 1);
            
            // Buscar ventas con próximo pago = mañana (preventivo) o hoy (día de vencimiento)
            const [ventasPendientes] = await sequelize.query(`
                SELECT 
                    s.id as sale_id,
                    s.client_id,
                    c.name as client_name,
                    c.phone as telefono,
                    s.next_payment_date as fecha_vencimiento,
                    s.weekly_payment as monto_pago,
                    s.remaining_debt as deuda_restante,
                    s.tienda_id,
                    CASE 
                        WHEN DATE(s.next_payment_date) = DATE(:manana) THEN 'preventivo'
                        WHEN DATE(s.next_payment_date) = DATE(:hoy) THEN 'vencimiento'
                    END as tipo_llamada
                FROM sales s
                JOIN clients c ON s.client_id = c.id
                WHERE s.status = 'active'
                AND s.remaining_debt > 0
                AND (
                    DATE(s.next_payment_date) = DATE(:manana)
                    OR DATE(s.next_payment_date) = DATE(:hoy)
                )
                AND c.phone IS NOT NULL
                AND c.phone != ''
                ORDER BY s.next_payment_date ASC
            `, {
                replacements: { hoy, manana }
            });

            // Filtrar los que ya recibieron llamada hoy del mismo tipo
            const [llamadasHoy] = await sequelize.query(`
                SELECT sale_id, tipo 
                FROM llamadas_automaticas 
                WHERE DATE(created_at) = DATE(:hoy)
            `, { replacements: { hoy } });

            const llamadasSet = new Set(llamadasHoy.map(l => `${l.sale_id}-${l.tipo}`));
            
            const pendientesFiltrados = ventasPendientes.filter(v => 
                !llamadasSet.has(`${v.sale_id}-${v.tipo_llamada}`)
            );

            res.json({
                success: true,
                total: pendientesFiltrados.length,
                dentroDeHorario: dentroDeHorario(),
                proximaVentana: proximaVentanaLlamadas(),
                pendientes: pendientesFiltrados
            });

        } catch (error) {
            console.error('Error obteniendo pendientes:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // =========================================================
    // EJECUTAR LLAMADAS AUTOMÁTICAS
    // =========================================================
    
    router.post('/ejecutar', async (req, res) => {
        try {
            // Verificar horario
            if (!dentroDeHorario()) {
                return res.status(400).json({
                    success: false,
                    message: `Fuera de horario permitido (9 AM - 6 PM). Próxima ventana: ${proximaVentanaLlamadas()}`
                });
            }

            const hoy = new Date();
            hoy.setHours(0, 0, 0, 0);
            
            const manana = new Date(hoy);
            manana.setDate(manana.getDate() + 1);

            // Obtener ventas pendientes de llamada
            const [ventasPendientes] = await sequelize.query(`
                SELECT 
                    s.id as sale_id,
                    s.client_id,
                    c.name as client_name,
                    c.phone as telefono,
                    s.next_payment_date as fecha_vencimiento,
                    s.weekly_payment as monto_pago,
                    s.tienda_id,
                    CASE 
                        WHEN DATE(s.next_payment_date) = DATE(:manana) THEN 'preventivo'
                        WHEN DATE(s.next_payment_date) = DATE(:hoy) THEN 'vencimiento'
                    END as tipo_llamada
                FROM sales s
                JOIN clients c ON s.client_id = c.id
                WHERE s.status = 'active'
                AND s.remaining_debt > 0
                AND (
                    DATE(s.next_payment_date) = DATE(:manana)
                    OR DATE(s.next_payment_date) = DATE(:hoy)
                )
                AND c.phone IS NOT NULL
                AND c.phone != ''
            `, { replacements: { hoy, manana } });

            // Filtrar ya llamados hoy
            const [llamadasHoy] = await sequelize.query(`
                SELECT sale_id, tipo FROM llamadas_automaticas WHERE DATE(created_at) = DATE(:hoy)
            `, { replacements: { hoy } });

            const llamadasSet = new Set(llamadasHoy.map(l => `${l.sale_id}-${l.tipo}`));
            const pendientes = ventasPendientes.filter(v => !llamadasSet.has(`${v.sale_id}-${v.tipo_llamada}`));

            if (pendientes.length === 0) {
                return res.json({
                    success: true,
                    message: 'No hay llamadas pendientes para ejecutar',
                    ejecutadas: 0
                });
            }

            const resultados = [];
            let exitosas = 0;
            let fallidas = 0;

            // Ejecutar llamadas con delay entre cada una
            for (const venta of pendientes) {
                try {
                    const resultado = await realizarLlamada(
                        venta.telefono,
                        venta.client_name,
                        venta.monto_pago,
                        venta.tipo_llamada,
                        venta.sale_id,
                        venta.client_id
                    );

                    // Registrar en base de datos
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
                    } else {
                        fallidas++;
                    }

                    resultados.push(resultado);

                    // Esperar 2 segundos entre llamadas para no saturar
                    await new Promise(resolve => setTimeout(resolve, 2000));

                } catch (error) {
                    console.error(`Error llamando a ${venta.client_name}:`, error);
                    fallidas++;
                    resultados.push({
                        success: false,
                        error: error.message,
                        clientName: venta.client_name
                    });
                }
            }

            // Auditoría
            if (AuditLog) {
                await AuditLog.create({
                    tabla: 'llamadas_automaticas',
                    accion: 'EJECUTAR LLAMADAS',
                    descripcion: `Llamadas ejecutadas: ${exitosas} exitosas, ${fallidas} fallidas`,
                    usuarioId: req.user?.id,
                    tienda_id: req.user?.tiendaId
                });
            }

            res.json({
                success: true,
                message: `Llamadas ejecutadas: ${exitosas} exitosas, ${fallidas} fallidas`,
                ejecutadas: exitosas,
                fallidas,
                resultados
            });

        } catch (error) {
            console.error('Error ejecutando llamadas:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // =========================================================
    // LLAMADA MANUAL A UN CLIENTE ESPECÍFICO
    // =========================================================
    
    router.post('/llamar/:saleId', async (req, res) => {
        try {
            const { saleId } = req.params;
            const { tipo } = req.body; // 'preventivo' o 'vencimiento'

            const [ventas] = await sequelize.query(`
                SELECT 
                    s.id as sale_id,
                    s.client_id,
                    c.name as client_name,
                    c.phone as telefono,
                    s.next_payment_date as fecha_vencimiento,
                    s.weekly_payment as monto_pago,
                    s.tienda_id
                FROM sales s
                JOIN clients c ON s.client_id = c.id
                WHERE s.id = :saleId
            `, { replacements: { saleId } });

            if (ventas.length === 0) {
                return res.status(404).json({ success: false, message: 'Venta no encontrada' });
            }

            const venta = ventas[0];

            if (!venta.telefono) {
                return res.status(400).json({ success: false, message: 'El cliente no tiene teléfono registrado' });
            }

            const resultado = await realizarLlamada(
                venta.telefono,
                venta.client_name,
                venta.monto_pago,
                tipo || 'preventivo',
                venta.sale_id,
                venta.client_id
            );

            // Registrar
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
                    tipo: tipo || 'preventivo',
                    callSid: resultado.callSid || null,
                    status: resultado.success ? 'initiated' : 'failed',
                    fechaVencimiento: venta.fecha_vencimiento,
                    tiendaId: venta.tienda_id
                }
            });

            res.json({
                success: resultado.success,
                message: resultado.success ? 'Llamada iniciada' : `Error: ${resultado.error}`,
                resultado
            });

        } catch (error) {
            console.error('Error en llamada manual:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // =========================================================
    // HISTORIAL DE LLAMADAS
    // =========================================================
    
    router.get('/historial', async (req, res) => {
        try {
            const { page = 1, limit = 50, status, tipo, fecha } = req.query;
            const offset = (parseInt(page) - 1) * parseInt(limit);

            let whereClause = '1=1';
            const replacements = { limit: parseInt(limit), offset };

            if (status) {
                whereClause += ' AND l.status = :status';
                replacements.status = status;
            }
            if (tipo) {
                whereClause += ' AND l.tipo = :tipo';
                replacements.tipo = tipo;
            }
            if (fecha) {
                whereClause += ' AND DATE(l.created_at) = DATE(:fecha)';
                replacements.fecha = fecha;
            }

            const [llamadas] = await sequelize.query(`
                SELECT 
                    l.*,
                    s.product_name
                FROM llamadas_automaticas l
                LEFT JOIN sales s ON l.sale_id = s.id
                WHERE ${whereClause}
                ORDER BY l.created_at DESC
                LIMIT :limit OFFSET :offset
            `, { replacements });

            const [[{ total }]] = await sequelize.query(`
                SELECT COUNT(*) as total FROM llamadas_automaticas l WHERE ${whereClause}
            `, { replacements });

            // Estadísticas del día
            const hoy = new Date();
            const [[statsHoy]] = await sequelize.query(`
                SELECT 
                    COUNT(*) as total,
                    COUNT(CASE WHEN status = 'completed' THEN 1 END) as completadas,
                    COUNT(CASE WHEN status = 'no-answer' THEN 1 END) as sin_respuesta,
                    COUNT(CASE WHEN status = 'busy' THEN 1 END) as ocupado,
                    COUNT(CASE WHEN status = 'failed' THEN 1 END) as fallidas,
                    COUNT(CASE WHEN answered_by = 'human' THEN 1 END) as contestadas_humano,
                    COUNT(CASE WHEN answered_by = 'machine' THEN 1 END) as contestadas_buzon
                FROM llamadas_automaticas
                WHERE DATE(created_at) = DATE(:hoy)
            `, { replacements: { hoy } });

            res.json({
                success: true,
                llamadas,
                total: parseInt(total),
                page: parseInt(page),
                totalPages: Math.ceil(total / parseInt(limit)),
                estadisticasHoy: statsHoy
            });

        } catch (error) {
            console.error('Error obteniendo historial:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // =========================================================
    // ESTADÍSTICAS GENERALES
    // =========================================================
    
    router.get('/estadisticas', async (req, res) => {
        try {
            const [[stats]] = await sequelize.query(`
                SELECT 
                    COUNT(*) as total_llamadas,
                    COUNT(CASE WHEN status = 'completed' THEN 1 END) as completadas,
                    COUNT(CASE WHEN status = 'no-answer' THEN 1 END) as sin_respuesta,
                    COUNT(CASE WHEN status = 'busy' THEN 1 END) as ocupado,
                    COUNT(CASE WHEN status = 'failed' THEN 1 END) as fallidas,
                    COUNT(CASE WHEN answered_by = 'human' THEN 1 END) as contestadas_humano,
                    COUNT(CASE WHEN answered_by = 'machine' THEN 1 END) as contestadas_buzon,
                    ROUND(AVG(duration), 0) as duracion_promedio,
                    COUNT(CASE WHEN tipo = 'preventivo' THEN 1 END) as llamadas_preventivas,
                    COUNT(CASE WHEN tipo = 'vencimiento' THEN 1 END) as llamadas_vencimiento
                FROM llamadas_automaticas
            `);

            // Por día últimos 7 días
            const [porDia] = await sequelize.query(`
                SELECT 
                    DATE(created_at) as fecha,
                    COUNT(*) as total,
                    COUNT(CASE WHEN status = 'completed' THEN 1 END) as completadas
                FROM llamadas_automaticas
                WHERE created_at >= NOW() - INTERVAL '7 days'
                GROUP BY DATE(created_at)
                ORDER BY fecha DESC
            `);

            res.json({
                success: true,
                estadisticas: stats,
                porDia,
                tasaContacto: stats.total_llamadas > 0 
                    ? Math.round((stats.contestadas_humano / stats.total_llamadas) * 100) 
                    : 0
            });

        } catch (error) {
            console.error('Error obteniendo estadísticas:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    return router;
}

module.exports = initLlamadasRoutes;

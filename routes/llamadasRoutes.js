// routes/llamadasRoutes.js - Rutas para llamadas automáticas de cobranza preventiva
const express = require('express');
const { realizarLlamada, dentroDeHorario, proximaVentanaLlamadas } = require('../services/twilioCallService');

function initLlamadasRoutes(models, sequelize) {
    const router = express.Router();
    const { Sale, Client, Payment, Store, AuditLog } = models;

    // =========================================================
    // WEBHOOK DE TWILIO - Actualizar estado de llamada (SIN AUTH)
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
    // OBTENER PAGOS PRÓXIMOS A VENCER (VERSIÓN CALCULADA)
    // =========================================================
    
    router.get('/pendientes', async (req, res) => {
        try {
            const hoy = new Date();
            hoy.setHours(0, 0, 0, 0);
            
            const manana = new Date(hoy);
            manana.setDate(manana.getDate() + 1);
            
            // PRIMERO: Verificar si la columna nextPaymentDate existe
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
                // Si la columna existe, usarla
                query = `
                    SELECT 
                        s.id as sale_id,
                        s."clientId" as client_id,
                        c.name as client_name,
                        c.phone as telefono,
                        s."nextPaymentDate" as fecha_vencimiento,
                        s."weeklyPaymentAmount" as monto_pago,
                        s."balanceDue" as deuda_restante,
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
                    ORDER BY s."nextPaymentDate" ASC
                `;
            } else {
                // Si NO existe, calcular basado en saleDate y weeklyPaymentAmount
                query = `
                    SELECT 
                        s.id as sale_id,
                        s."clientId" as client_id,
                        c.name as client_name,
                        c.phone as telefono,
                        -- Calcular próxima fecha de pago (cada 7 días desde saleDate)
                        (s."saleDate" + INTERVAL '7 days' * 
                            (CEIL(EXTRACT(DAY FROM NOW() - s."saleDate") / 7) + 1)
                        )::DATE as fecha_vencimiento,
                        s."weeklyPaymentAmount" as monto_pago,
                        s."balanceDue" as deuda_restante,
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
                    ORDER BY fecha_vencimiento ASC
                `;
            }
            
            const [ventasPendientes] = await sequelize.query(query, { replacements });
            console.log(`📋 Ventas pendientes encontradas: ${ventasPendientes.length}`);

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
                pendientes: pendientesFiltrados,
                calculadoDinamicamente: !tieneNextPaymentDate
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

            // Verificar si la columna existe
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

            if (AuditLog) {
                try {
                    await AuditLog.create({
                        tabla: 'llamadas_automaticas',
                        accion: 'EJECUTAR LLAMADAS',
                        descripcion: `Llamadas ejecutadas: ${exitosas} exitosas, ${fallidas} fallidas`,
                        usuarioId: req.user?.id,
                        tienda_id: req.user?.tiendaId
                    });
                } catch (e) {}
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
            const { tipo } = req.body;

            const [ventas] = await sequelize.query(`
                SELECT 
                    s.id as sale_id,
                    s."clientId" as client_id,
                    c.name as client_name,
                    c.phone as telefono,
                    s."weeklyPaymentAmount" as monto_pago,
                    s."tienda_id" as tienda_id
                FROM sales s
                JOIN clients c ON s."clientId" = c.id
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

            await sequelize.query(`
                INSERT INTO llamadas_automaticas 
                (sale_id, client_id, client_name, telefono, monto, tipo, call_sid, status, tienda_id)
                VALUES (:saleId, :clientId, :clientName, :telefono, :monto, :tipo, :callSid, :status, :tiendaId)
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
    // HISTORIAL DE LLAMADAS (sin cambios)
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
                SELECT l.*, s."weeklyPaymentAmount" as monto_pago
                FROM llamadas_automaticas l
                LEFT JOIN sales s ON l.sale_id = s.id
                WHERE ${whereClause}
                ORDER BY l.created_at DESC
                LIMIT :limit OFFSET :offset
            `, { replacements });

            const [[{ total }]] = await sequelize.query(`
                SELECT COUNT(*) as total FROM llamadas_automaticas l WHERE ${whereClause}
            `, { replacements });

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
    // ESTADÍSTICAS GENERALES (sin cambios)
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
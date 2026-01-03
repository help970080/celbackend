// routes/tandasRoutes.js - Rutas para gestión de tandas/caja de ahorro
// CORREGIDO: Autenticación por query param para PDFs + botón eliminar
const express = require('express');
const { Op } = require('sequelize');
const PDFDocument = require('pdfkit');
const jwt = require('jsonwebtoken');

function initTandasRoutes(models, sequelize) {
    const router = express.Router();
    const { Tanda, TandaParticipante, TandaAportacion, ConfigFinanciera, User, Store, AuditLog } = models;

    // Middleware para verificar token en query param (para PDFs)
    const verifyTokenFromQuery = (req, res, next) => {
        const token = req.query.token || req.headers.authorization?.split(' ')[1];
        
        if (!token) {
            return res.status(401).json({ message: 'Acceso denegado. No se proporcionó token.' });
        }

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            req.user = decoded;
            next();
        } catch (error) {
            return res.status(401).json({ message: 'Token inválido o expirado.' });
        }
    };

    // =========================================================
    // RECIBOS PDF - PRIMERO para que no conflictúen con /:id
    // =========================================================

    // GET /api/tandas/recibo/:aportacionId - Generar recibo PDF
    router.get('/recibo/:aportacionId', verifyTokenFromQuery, async (req, res) => {
        try {
            const aportacion = await TandaAportacion.findByPk(req.params.aportacionId, {
                include: [
                    { model: TandaParticipante, as: 'participante' },
                    { model: Tanda, as: 'tanda' }
                ]
            });

            if (!aportacion) {
                return res.status(404).json({ success: false, message: 'Aportación no encontrada' });
            }

            const doc = new PDFDocument({ size: 'A6', margin: 30 });
            
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `inline; filename=recibo-${aportacion.reciboFolio}.pdf`);
            
            doc.pipe(res);

            doc.fontSize(16).font('Helvetica-Bold').text('CELEXPRESS', { align: 'center' });
            doc.fontSize(12).font('Helvetica').text('RECIBO DE AHORRO', { align: 'center' });
            doc.moveDown(0.5);
            
            doc.moveTo(30, doc.y).lineTo(270, doc.y).stroke();
            doc.moveDown(0.5);

            doc.fontSize(10);
            doc.text(`Folio: ${aportacion.reciboFolio}`);
            doc.text(`Fecha: ${new Date(aportacion.fechaPago).toLocaleDateString('es-MX')}`);
            doc.moveDown(0.5);

            doc.text(`Participante: ${aportacion.participante.nombre}`);
            doc.text(`Tanda: ${aportacion.tanda.nombre}`);
            doc.text(`Turno asignado: #${aportacion.participante.numTurno}`);
            doc.moveDown(0.5);

            doc.font('Helvetica-Bold');
            doc.text(`Aportacion: $${parseFloat(aportacion.monto).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`);
            doc.font('Helvetica');
            doc.text(`Periodo: ${aportacion.numPeriodo} de ${aportacion.tanda.numParticipantes}`);
            doc.text(`Acumulado: $${parseFloat(aportacion.participante.totalAportado || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`);
            
            const restante = parseFloat(aportacion.tanda.montoTurno) - parseFloat(aportacion.participante.totalAportado || 0);
            doc.text(`Restante: $${Math.max(0, restante).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`);
            doc.moveDown(0.5);

            doc.text(`Metodo: ${aportacion.metodoPago}`);
            
            if (aportacion.participante.fechaEntregaEstimada) {
                doc.moveDown(0.5);
                doc.text(`Fecha estimada de entrega:`);
                doc.font('Helvetica-Bold');
                doc.text(new Date(aportacion.participante.fechaEntregaEstimada).toLocaleDateString('es-MX'));
            }

            doc.end();

        } catch (error) {
            console.error('Error al generar recibo:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // GET /api/tandas/comprobante/:participanteId - Generar comprobante de entrega PDF
    router.get('/comprobante/:participanteId', verifyTokenFromQuery, async (req, res) => {
        try {
            const participante = await TandaParticipante.findByPk(req.params.participanteId, {
                include: [{ model: Tanda, as: 'tanda' }]
            });

            if (!participante) {
                return res.status(404).json({ success: false, message: 'Participante no encontrado' });
            }

            if (!participante.entregaRealizada) {
                return res.status(400).json({ success: false, message: 'Aun no se ha realizado la entrega' });
            }

            const doc = new PDFDocument({ size: 'A5', margin: 40 });
            
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `inline; filename=comprobante-entrega-${participante.id}.pdf`);
            
            doc.pipe(res);

            doc.fontSize(18).font('Helvetica-Bold').text('CELEXPRESS', { align: 'center' });
            doc.fontSize(14).font('Helvetica').text('COMPROBANTE DE ENTREGA', { align: 'center' });
            doc.moveDown();
            
            doc.moveTo(40, doc.y).lineTo(360, doc.y).stroke();
            doc.moveDown();

            const folio = `ENT-${new Date().getFullYear()}-${String(participante.id).padStart(5, '0')}`;
            doc.fontSize(11);
            doc.text(`Folio: ${folio}`);
            doc.text(`Fecha: ${new Date(participante.fechaEntregaReal).toLocaleDateString('es-MX')}`);
            doc.moveDown();

            doc.font('Helvetica-Bold').text('Beneficiario:', { continued: true });
            doc.font('Helvetica').text(` ${participante.nombre}`);
            
            doc.font('Helvetica-Bold').text('Tanda:', { continued: true });
            doc.font('Helvetica').text(` ${participante.tanda.nombre}`);
            
            doc.font('Helvetica-Bold').text('Turno:', { continued: true });
            doc.font('Helvetica').text(` #${participante.numTurno}`);
            doc.moveDown();

            doc.fontSize(14).font('Helvetica-Bold');
            doc.text('MONTO ENTREGADO:', { align: 'center' });
            doc.fontSize(20);
            doc.text(`$${parseFloat(participante.montoEntregado || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`, { align: 'center' });
            doc.moveDown();

            doc.fontSize(11).font('Helvetica');
            doc.text(`Total aportado: $${parseFloat(participante.totalAportado || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`);
            
            const pendiente = parseFloat(participante.tanda.montoTurno) - parseFloat(participante.totalAportado || 0);
            if (pendiente > 0) {
                doc.text(`Pendiente por aportar: $${pendiente.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`);
            }
            doc.moveDown(2);

            doc.text('_______________________          _______________________');
            doc.text('    Firma participante                      Firma responsable');

            doc.end();

        } catch (error) {
            console.error('Error al generar comprobante:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // =========================================================
    // CONFIGURACIÓN FINANCIERA
    // =========================================================

    router.get('/config', async (req, res) => {
        try {
            let config = await ConfigFinanciera.findOne({
                where: { tiendaId: null }
            });

            if (!config) {
                config = await ConfigFinanciera.create({
                    tiendaId: null,
                    ingresoMensualPromedio: 0,
                    liquidezDisponible: 0,
                    porcentajeTecho: 70,
                    alertaAdvertencia: 70,
                    alertaCritica: 90
                });
            }

            res.json({ success: true, config });
        } catch (error) {
            console.error('Error al obtener config:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.put('/config', async (req, res) => {
        try {
            const { ingresoMensualPromedio, liquidezDisponible, porcentajeTecho, alertaAdvertencia, alertaCritica, notas } = req.body;

            let config = await ConfigFinanciera.findOne({ where: { tiendaId: null } });

            if (!config) {
                config = await ConfigFinanciera.create({
                    tiendaId: null,
                    ingresoMensualPromedio: ingresoMensualPromedio || 0,
                    liquidezDisponible: liquidezDisponible || 0,
                    porcentajeTecho: porcentajeTecho || 70,
                    alertaAdvertencia: alertaAdvertencia || 70,
                    alertaCritica: alertaCritica || 90,
                    actualizadoPor: req.user?.id,
                    ultimaActualizacion: new Date(),
                    notas
                });
            } else {
                await config.update({
                    ingresoMensualPromedio: ingresoMensualPromedio ?? config.ingresoMensualPromedio,
                    liquidezDisponible: liquidezDisponible ?? config.liquidezDisponible,
                    porcentajeTecho: porcentajeTecho ?? config.porcentajeTecho,
                    alertaAdvertencia: alertaAdvertencia ?? config.alertaAdvertencia,
                    alertaCritica: alertaCritica ?? config.alertaCritica,
                    actualizadoPor: req.user?.id,
                    ultimaActualizacion: new Date(),
                    notas: notas ?? config.notas
                });
            }

            res.json({ success: true, message: 'Configuración actualizada', config });
        } catch (error) {
            console.error('Error al actualizar config:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // =========================================================
    // DASHBOARD DE RIESGO FINANCIERO
    // =========================================================

    router.get('/dashboard', async (req, res) => {
        try {
            const config = await ConfigFinanciera.findOne({ where: { tiendaId: null } });

            const tandasActivas = await Tanda.findAll({
                where: { estado: 'activa' },
                include: [{
                    model: TandaParticipante,
                    as: 'participantes',
                    where: { entregaRealizada: false },
                    required: false
                }]
            });

            let compromisoTotal = 0;
            let proximasEntregas30Dias = 0;
            const hoy = new Date();
            const en30Dias = new Date(hoy.getTime() + 30 * 24 * 60 * 60 * 1000);

            tandasActivas.forEach(tanda => {
                const pendientes = tanda.participantes?.filter(p => !p.entregaRealizada) || [];
                pendientes.forEach(p => {
                    compromisoTotal += parseFloat(tanda.montoTurno);
                    if (p.fechaEntregaEstimada && new Date(p.fechaEntregaEstimada) <= en30Dias) {
                        proximasEntregas30Dias += parseFloat(tanda.montoTurno);
                    }
                });
            });

            const liquidez = parseFloat(config?.liquidezDisponible || 0);
            const porcentajeTecho = parseFloat(config?.porcentajeTecho || 70);
            const techoPermitido = liquidez * (porcentajeTecho / 100);
            const porcentajeUsado = techoPermitido > 0 ? (compromisoTotal / techoPermitido) * 100 : 0;

            let estado = 'saludable';
            let estadoColor = 'green';
            let mensaje = 'Puedes abrir más tandas';

            if (porcentajeUsado >= parseFloat(config?.alertaCritica || 90)) {
                estado = 'critico';
                estadoColor = 'red';
                mensaje = 'No abrir más tandas - Riesgo alto';
            } else if (porcentajeUsado >= parseFloat(config?.alertaAdvertencia || 70)) {
                estado = 'advertencia';
                estadoColor = 'orange';
                mensaje = 'Precaución - Cerca del límite';
            }

            const capacidadDisponible = Math.max(0, techoPermitido - compromisoTotal);

            res.json({
                success: true,
                dashboard: {
                    ingresoMensualPromedio: parseFloat(config?.ingresoMensualPromedio || 0),
                    liquidezDisponible: liquidez,
                    porcentajeTecho,
                    tandasActivas: tandasActivas.length,
                    compromisoTotal,
                    proximasEntregas30Dias,
                    techoPermitido,
                    porcentajeUsado: Math.round(porcentajeUsado * 10) / 10,
                    capacidadDisponible,
                    estado,
                    estadoColor,
                    mensaje,
                    ultimaActualizacion: config?.ultimaActualizacion
                }
            });
        } catch (error) {
            console.error('Error en dashboard:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // =========================================================
    // CRUD DE TANDAS
    // =========================================================

    router.get('/', async (req, res) => {
        try {
            const { estado, page = 1, limit = 20 } = req.query;
            const where = {};
            
            if (estado) where.estado = estado;

            const tandas = await Tanda.findAndCountAll({
                where,
                include: [{
                    model: TandaParticipante,
                    as: 'participantes',
                    attributes: ['id', 'nombre', 'numTurno', 'entregaRealizada', 'totalAportado']
                }],
                order: [['createdAt', 'DESC']],
                limit: parseInt(limit),
                offset: (parseInt(page) - 1) * parseInt(limit)
            });

            res.json({
                success: true,
                tandas: tandas.rows,
                total: tandas.count,
                page: parseInt(page),
                totalPages: Math.ceil(tandas.count / parseInt(limit))
            });
        } catch (error) {
            console.error('Error al listar tandas:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.get('/:id', async (req, res) => {
        try {
            const tanda = await Tanda.findByPk(req.params.id, {
                include: [{
                    model: TandaParticipante,
                    as: 'participantes',
                    include: [{
                        model: TandaAportacion,
                        as: 'aportaciones'
                    }]
                }]
            });

            if (!tanda) {
                return res.status(404).json({ success: false, message: 'Tanda no encontrada' });
            }

            res.json({ success: true, tanda });
        } catch (error) {
            console.error('Error al obtener tanda:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.post('/', async (req, res) => {
        let t;
        let committed = false;
        
        try {
            t = await sequelize.transaction();
            
            const { nombre, descripcion, montoTurno, aportacion, numParticipantes, frecuencia, fechaInicio, participantes, notas } = req.body;

            if (!nombre || !montoTurno || !aportacion || !numParticipantes || !fechaInicio) {
                await t.rollback();
                return res.status(400).json({
                    success: false,
                    message: 'Campos requeridos: nombre, montoTurno, aportacion, numParticipantes, fechaInicio'
                });
            }

            const montoEsperado = parseFloat(aportacion) * parseInt(numParticipantes);
            if (Math.abs(montoEsperado - parseFloat(montoTurno)) > 0.01) {
                await t.rollback();
                return res.status(400).json({
                    success: false,
                    message: `El monto del turno ($${montoTurno}) debe ser igual a aportación ($${aportacion}) × participantes (${numParticipantes}) = $${montoEsperado}`
                });
            }

            const diasPorPeriodo = frecuencia === 'semanal' ? 7 : frecuencia === 'quincenal' ? 15 : 30;
            const fechaFin = new Date(fechaInicio);
            fechaFin.setDate(fechaFin.getDate() + (diasPorPeriodo * numParticipantes));

            const tanda = await Tanda.create({
                nombre,
                descripcion,
                montoTurno,
                aportacion,
                numParticipantes,
                frecuencia: frecuencia || 'quincenal',
                fechaInicio,
                fechaFin,
                estado: 'activa',
                periodoActual: 1,
                tiendaId: req.user?.tiendaId || 1,
                creadoPor: req.user?.id,
                notas
            }, { transaction: t });

            if (participantes && Array.isArray(participantes)) {
                for (let i = 0; i < participantes.length; i++) {
                    const p = participantes[i];
                    const fechaEntrega = new Date(fechaInicio);
                    fechaEntrega.setDate(fechaEntrega.getDate() + (diasPorPeriodo * (p.numTurno || i + 1)));

                    await TandaParticipante.create({
                        tandaId: tanda.id,
                        nombre: p.nombre,
                        telefono: p.telefono,
                        email: p.email,
                        userId: p.userId,
                        numTurno: p.numTurno || i + 1,
                        fechaEntregaEstimada: fechaEntrega,
                        estado: 'activo'
                    }, { transaction: t });
                }
            }

            await t.commit();
            committed = true;

            if (AuditLog) {
                try {
                    await AuditLog.create({
                        tabla: 'tandas',
                        accion: 'CREAR TANDA',
                        descripcion: `Tanda "${nombre}" creada. Monto: $${montoTurno}, Participantes: ${numParticipantes}`,
                        usuarioId: req.user?.id,
                        tienda_id: req.user?.tiendaId
                    });
                } catch (auditError) {
                    console.error('Error en auditoría:', auditError);
                }
            }

            const tandaCompleta = await Tanda.findByPk(tanda.id, {
                include: [{ model: TandaParticipante, as: 'participantes' }]
            });

            res.status(201).json({
                success: true,
                message: 'Tanda creada exitosamente',
                tanda: tandaCompleta
            });

        } catch (error) {
            if (t && !committed) {
                try {
                    await t.rollback();
                } catch (rollbackError) {
                    console.error('Error en rollback:', rollbackError);
                }
            }
            console.error('Error al crear tanda:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.put('/:id', async (req, res) => {
        try {
            const tanda = await Tanda.findByPk(req.params.id);
            
            if (!tanda) {
                return res.status(404).json({ success: false, message: 'Tanda no encontrada' });
            }

            const { nombre, descripcion, estado, periodoActual, notas } = req.body;

            await tanda.update({
                nombre: nombre ?? tanda.nombre,
                descripcion: descripcion ?? tanda.descripcion,
                estado: estado ?? tanda.estado,
                periodoActual: periodoActual ?? tanda.periodoActual,
                notas: notas ?? tanda.notas
            });

            res.json({ success: true, message: 'Tanda actualizada', tanda });
        } catch (error) {
            console.error('Error al actualizar tanda:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // DELETE /api/tandas/:id - Eliminar tanda
    router.delete('/:id', async (req, res) => {
        try {
            const tanda = await Tanda.findByPk(req.params.id);

            if (!tanda) {
                return res.status(404).json({ success: false, message: 'Tanda no encontrada' });
            }

            const aportaciones = await TandaAportacion.count({ where: { tandaId: tanda.id } });
            
            if (aportaciones > 0) {
                return res.status(400).json({
                    success: false,
                    message: 'No se puede eliminar una tanda con aportaciones. Cámbiala a "cancelada" en su lugar.'
                });
            }

            await TandaParticipante.destroy({ where: { tandaId: tanda.id } });
            
            const nombreTanda = tanda.nombre;
            await tanda.destroy();

            if (AuditLog) {
                try {
                    await AuditLog.create({
                        tabla: 'tandas',
                        accion: 'ELIMINAR TANDA',
                        descripcion: `Tanda "${nombreTanda}" eliminada`,
                        usuarioId: req.user?.id,
                        tienda_id: req.user?.tiendaId
                    });
                } catch (auditError) {
                    console.error('Error en auditoría:', auditError);
                }
            }

            res.json({ success: true, message: 'Tanda eliminada exitosamente' });
        } catch (error) {
            console.error('Error al eliminar tanda:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // =========================================================
    // PARTICIPANTES
    // =========================================================

    router.post('/:id/participantes', async (req, res) => {
        try {
            const tanda = await Tanda.findByPk(req.params.id);
            
            if (!tanda) {
                return res.status(404).json({ success: false, message: 'Tanda no encontrada' });
            }

            const participantesActuales = await TandaParticipante.count({ where: { tandaId: tanda.id } });
            
            if (participantesActuales >= tanda.numParticipantes) {
                return res.status(400).json({
                    success: false,
                    message: `La tanda ya tiene el máximo de participantes (${tanda.numParticipantes})`
                });
            }

            const { nombre, telefono, email, userId, numTurno, notas } = req.body;

            if (numTurno) {
                const turnoOcupado = await TandaParticipante.findOne({
                    where: { tandaId: tanda.id, numTurno }
                });
                if (turnoOcupado) {
                    return res.status(400).json({
                        success: false,
                        message: `El turno #${numTurno} ya está ocupado`
                    });
                }
            }

            const diasPorPeriodo = tanda.frecuencia === 'semanal' ? 7 : tanda.frecuencia === 'quincenal' ? 15 : 30;
            const turnoAsignado = numTurno || participantesActuales + 1;
            const fechaEntrega = new Date(tanda.fechaInicio);
            fechaEntrega.setDate(fechaEntrega.getDate() + (diasPorPeriodo * turnoAsignado));

            const participante = await TandaParticipante.create({
                tandaId: tanda.id,
                nombre,
                telefono,
                email,
                userId,
                numTurno: turnoAsignado,
                fechaEntregaEstimada: fechaEntrega,
                estado: 'activo',
                notas
            });

            res.status(201).json({ success: true, message: 'Participante agregado', participante });
        } catch (error) {
            console.error('Error al agregar participante:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.put('/:id/participantes/:participanteId', async (req, res) => {
        try {
            const participante = await TandaParticipante.findOne({
                where: { id: req.params.participanteId, tandaId: req.params.id }
            });

            if (!participante) {
                return res.status(404).json({ success: false, message: 'Participante no encontrado' });
            }

            const { nombre, telefono, email, numTurno, estado, notas } = req.body;

            await participante.update({
                nombre: nombre ?? participante.nombre,
                telefono: telefono ?? participante.telefono,
                email: email ?? participante.email,
                numTurno: numTurno ?? participante.numTurno,
                estado: estado ?? participante.estado,
                notas: notas ?? participante.notas
            });

            res.json({ success: true, message: 'Participante actualizado', participante });
        } catch (error) {
            console.error('Error al actualizar participante:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // =========================================================
    // APORTACIONES
    // =========================================================

    router.post('/:id/aportaciones', async (req, res) => {
        let t;
        let committed = false;
        
        try {
            t = await sequelize.transaction();
            
            const tanda = await Tanda.findByPk(req.params.id);
            
            if (!tanda) {
                await t.rollback();
                return res.status(404).json({ success: false, message: 'Tanda no encontrada' });
            }

            const { participanteId, monto, numPeriodo, metodoPago, notas } = req.body;

            const participante = await TandaParticipante.findOne({
                where: { id: participanteId, tandaId: tanda.id }
            });

            if (!participante) {
                await t.rollback();
                return res.status(404).json({ success: false, message: 'Participante no encontrado' });
            }

            const aportacionExistente = await TandaAportacion.findOne({
                where: { tandaId: tanda.id, participanteId, numPeriodo }
            });

            if (aportacionExistente) {
                await t.rollback();
                return res.status(400).json({
                    success: false,
                    message: `Ya existe una aportación para el período #${numPeriodo}`
                });
            }

            const folio = `APT-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;

            const aportacion = await TandaAportacion.create({
                tandaId: tanda.id,
                participanteId,
                monto: monto || tanda.aportacion,
                numPeriodo: numPeriodo || tanda.periodoActual,
                metodoPago: metodoPago || 'efectivo',
                reciboFolio: folio,
                registradoPor: req.user?.id,
                notas
            }, { transaction: t });

            await participante.update({
                totalAportado: parseFloat(participante.totalAportado || 0) + parseFloat(monto || tanda.aportacion)
            }, { transaction: t });

            await t.commit();
            committed = true;

            res.status(201).json({
                success: true,
                message: 'Aportación registrada',
                aportacion,
                folio
            });

        } catch (error) {
            if (t && !committed) {
                try {
                    await t.rollback();
                } catch (rollbackError) {
                    console.error('Error en rollback:', rollbackError);
                }
            }
            console.error('Error al registrar aportación:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.get('/:id/aportaciones', async (req, res) => {
        try {
            const aportaciones = await TandaAportacion.findAll({
                where: { tandaId: req.params.id },
                include: [{
                    model: TandaParticipante,
                    as: 'participante',
                    attributes: ['id', 'nombre', 'numTurno']
                }],
                order: [['numPeriodo', 'ASC'], ['createdAt', 'ASC']]
            });

            res.json({ success: true, aportaciones });
        } catch (error) {
            console.error('Error al listar aportaciones:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // =========================================================
    // ENTREGAS
    // =========================================================

    router.post('/:id/entregas', async (req, res) => {
        let t;
        let committed = false;
        
        try {
            t = await sequelize.transaction();
            
            const tanda = await Tanda.findByPk(req.params.id);
            
            if (!tanda) {
                await t.rollback();
                return res.status(404).json({ success: false, message: 'Tanda no encontrada' });
            }

            const { participanteId, montoEntregado, notas } = req.body;

            const participante = await TandaParticipante.findOne({
                where: { id: participanteId, tandaId: tanda.id }
            });

            if (!participante) {
                await t.rollback();
                return res.status(404).json({ success: false, message: 'Participante no encontrado' });
            }

            if (participante.entregaRealizada) {
                await t.rollback();
                return res.status(400).json({
                    success: false,
                    message: 'Este participante ya recibió su entrega'
                });
            }

            await participante.update({
                entregaRealizada: true,
                fechaEntregaReal: new Date(),
                montoEntregado: montoEntregado || tanda.montoTurno,
                notas: notas ? `${participante.notas || ''}\nEntrega: ${notas}` : participante.notas
            }, { transaction: t });

            const entregasPendientes = await TandaParticipante.count({
                where: { tandaId: tanda.id, entregaRealizada: false }
            });

            if (entregasPendientes <= 1) {
                await tanda.update({ estado: 'completada' }, { transaction: t });
            }

            await t.commit();
            committed = true;

            if (AuditLog) {
                try {
                    await AuditLog.create({
                        tabla: 'tanda_participantes',
                        accion: 'ENTREGA TANDA',
                        descripcion: `Entrega de $${montoEntregado || tanda.montoTurno} a ${participante.nombre} en tanda "${tanda.nombre}"`,
                        usuarioId: req.user?.id,
                        tienda_id: req.user?.tiendaId
                    });
                } catch (auditError) {
                    console.error('Error en auditoría:', auditError);
                }
            }

            res.json({
                success: true,
                message: 'Entrega registrada exitosamente',
                participante: await TandaParticipante.findByPk(participante.id)
            });

        } catch (error) {
            if (t && !committed) {
                try {
                    await t.rollback();
                } catch (rollbackError) {
                    console.error('Error en rollback:', rollbackError);
                }
            }
            console.error('Error al registrar entrega:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // =========================================================
    // SORTEO DE TURNOS
    // =========================================================

    router.post('/:id/sorteo', async (req, res) => {
        let t;
        let committed = false;
        
        try {
            t = await sequelize.transaction();
            
            const tanda = await Tanda.findByPk(req.params.id, {
                include: [{ model: TandaParticipante, as: 'participantes' }]
            });

            if (!tanda) {
                await t.rollback();
                return res.status(404).json({ success: false, message: 'Tanda no encontrada' });
            }

            const aportaciones = await TandaAportacion.count({ where: { tandaId: tanda.id } });
            if (aportaciones > 0) {
                await t.rollback();
                return res.status(400).json({
                    success: false,
                    message: 'No se puede hacer sorteo después de iniciar aportaciones'
                });
            }

            const participantes = tanda.participantes;
            
            const shuffled = [...participantes];
            for (let i = shuffled.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }

            const diasPorPeriodo = tanda.frecuencia === 'semanal' ? 7 : tanda.frecuencia === 'quincenal' ? 15 : 30;
            
            for (let i = 0; i < shuffled.length; i++) {
                const fechaEntrega = new Date(tanda.fechaInicio);
                fechaEntrega.setDate(fechaEntrega.getDate() + (diasPorPeriodo * (i + 1)));

                await TandaParticipante.update({
                    numTurno: i + 1,
                    fechaEntregaEstimada: fechaEntrega
                }, {
                    where: { id: shuffled[i].id },
                    transaction: t
                });
            }

            await t.commit();
            committed = true;

            const tandaActualizada = await Tanda.findByPk(tanda.id, {
                include: [{
                    model: TandaParticipante,
                    as: 'participantes'
                }]
            });

            res.json({
                success: true,
                message: 'Sorteo realizado exitosamente',
                tanda: tandaActualizada
            });

        } catch (error) {
            if (t && !committed) {
                try {
                    await t.rollback();
                } catch (rollbackError) {
                    console.error('Error en rollback:', rollbackError);
                }
            }
            console.error('Error en sorteo:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    return router;
}

module.exports = initTandasRoutes;

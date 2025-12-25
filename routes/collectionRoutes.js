// routes/collectionRoutes.js - VERSIÓN CORREGIDA CON MULTI-TENANT

const express = require('express');
const router = express.Router();
const authorize = require('../middleware/authMiddleware'); 
const authorizeRoles = require('../middleware/roleMiddleware');
const applyStoreFilter = require('../middleware/storeFilterMiddleware'); // ⭐ NUEVO
const exceljs = require('exceljs'); 

// Referencias a Modelos
let CollectionLog, Sale, User, Client; 

// =========================================================
// FUNCIÓN DE INICIALIZACIÓN DE RUTAS
// =========================================================
const initCollectionRoutes = (models) => {
    CollectionLog = models.CollectionLog;
    Sale = models.Sale;
    User = models.User;
    Client = models.Client;

    /**
     * POST /api/collections/log - Registrar una gestión de cobranza
     * ✅ CORREGIDO: Usa req.user.userId del token
     * ⭐ NUEVO: Incluye tiendaId para multi-tenant
     */
    router.post(
        '/log',
        authorize, 
        authorizeRoles(['super_admin', 'regular_admin', 'collector_agent']), 
        async (req, res) => {
            const { saleId, result, notes, nextActionDate } = req.body; 
            
            // ✅ Obtener collectorId del token
            const collectorIdFromToken = req.user.userId; 
            const tiendaId = req.user.tiendaId; // ⭐ NUEVO

            // Validaciones
            if (!saleId || !result || !notes) {
                return res.status(400).json({ 
                    message: 'Campos saleId, result y notes son obligatorios.' 
                });
            }
            
            if (!collectorIdFromToken || collectorIdFromToken <= 0) {
                return res.status(401).json({ 
                    message: 'ID de gestor no encontrado en el token. Inicie sesión de nuevo.' 
                });
            }

            try {
                // Verificar que la venta existe y pertenece a la tienda del usuario
                const sale = await Sale.findOne({
                    where: {
                        id: saleId,
                        tiendaId: tiendaId // ⭐ VERIFICAR MULTI-TENANT
                    }
                });
                
                if (!sale) {
                    return res.status(404).json({ 
                        message: 'Venta no encontrada o no pertenece a su tienda.' 
                    });
                }
                
                // Crear el nuevo registro de gestión
                const newLog = await CollectionLog.create({
                    saleId: saleId,
                    collectorId: collectorIdFromToken,
                    result: result,
                    notes: notes,
                    date: new Date(), 
                    nextActionDate: nextActionDate || null,
                    tiendaId: tiendaId // ⭐ NUEVO
                });

                res.status(201).json({ 
                    success: true,
                    message: 'Gestión registrada con éxito.', 
                    log: newLog 
                });

            } catch (err) {
                console.error('Error al registrar gestión de cobranza:', err);
                res.status(500).json({ 
                    success: false,
                    message: 'Error interno del servidor al registrar la gestión.',
                    error: err.message
                });
            }
        }
    );

    /**
     * GET /api/collections/log - Obtener historial de gestiones
     * ⭐ NUEVO: Con filtro multi-tenant
     */
    router.get(
        '/log',
        authorize,
        authorizeRoles(['super_admin', 'regular_admin', 'collector_agent', 'viewer_reports']),
        applyStoreFilter, // ⭐ NUEVO
        async (req, res) => {
            try {
                const { saleId, collectorId, startDate, endDate, page = 1, limit = 50 } = req.query;
                
                const whereClause = { ...req.storeFilter }; // ⭐ FILTRO MULTI-TENANT
                
                if (saleId) {
                    whereClause.saleId = parseInt(saleId, 10);
                }
                
                if (collectorId) {
                    whereClause.collectorId = parseInt(collectorId, 10);
                }
                
                if (startDate && endDate) {
                    whereClause.date = {
                        [require('sequelize').Op.between]: [
                            new Date(startDate),
                            new Date(endDate)
                        ]
                    };
                }
                
                const pageNum = parseInt(page, 10);
                const limitNum = parseInt(limit, 10);
                const offset = (pageNum - 1) * limitNum;
                
                const { count, rows } = await CollectionLog.findAndCountAll({
                    where: whereClause,
                    include: [
                        { 
                            model: Sale, 
                            as: 'sale',
                            attributes: ['id', 'clientId', 'balanceDue'],
                            include: [{
                                model: Client,
                                as: 'client',
                                attributes: ['name', 'lastName', 'phone']
                            }]
                        },
                        { 
                            model: User, 
                            as: 'collector', 
                            attributes: ['id', 'username'] 
                        }
                    ],
                    order: [['date', 'DESC']],
                    limit: limitNum,
                    offset: offset
                });
                
                res.json({
                    success: true,
                    totalItems: count,
                    totalPages: Math.ceil(count / limitNum),
                    currentPage: pageNum,
                    logs: rows
                });
                
            } catch (err) {
                console.error('Error al obtener logs de cobranza:', err);
                res.status(500).json({ 
                    success: false,
                    message: 'Error al obtener historial de gestiones.',
                    error: err.message
                });
            }
        }
    );

    /**
     * GET /api/collections/export-log - Exportar registro a Excel
     * ⭐ NUEVO: Con filtro multi-tenant
     */
    router.get(
        '/export-log',
        authorize,
        authorizeRoles(['super_admin', 'regular_admin', 'viewer_reports']),
        applyStoreFilter, // ⭐ NUEVO
        async (req, res) => {
            try {
                const logs = await CollectionLog.findAll({
                    where: req.storeFilter, // ⭐ FILTRO MULTI-TENANT
                    order: [['date', 'DESC']],
                    include: [
                        { 
                            model: Sale, 
                            as: 'sale',
                            attributes: ['id', 'clientId', 'balanceDue'], 
                            include: [{ 
                                model: Client, 
                                as: 'client', 
                                attributes: ['name', 'lastName', 'phone'] 
                            }]
                        },
                        { 
                            model: User, 
                            as: 'collector', 
                            attributes: ['username'] 
                        }
                    ]
                });
                
                const workbook = new exceljs.Workbook();
                const worksheet = workbook.addWorksheet('Registro de Gestión de Cobranza');

                // Configurar columnas
                worksheet.columns = [
                    { header: 'ID Log', key: 'id', width: 10 },
                    { header: 'Fecha Gestión', key: 'date', width: 20 },
                    { header: 'Gestor', key: 'collector', width: 25 },
                    { header: 'Cliente', key: 'clientName', width: 30 },
                    { header: 'Teléfono', key: 'phone', width: 15 },
                    { header: 'ID Venta', key: 'saleId', width: 10 },
                    { header: 'Saldo Venta Actual', key: 'saleBalance', width: 18 },
                    { header: 'Resultado', key: 'result', width: 20 },
                    { header: 'Notas', key: 'notes', width: 50 },
                    { header: 'Próxima Acción', key: 'nextActionDate', width: 20 }
                ];

                // Agregar datos
                logs.forEach(log => {
                    const client = log.sale?.client;
                    worksheet.addRow({
                        id: log.id,
                        date: log.date,
                        collector: log.collector?.username || 'N/A',
                        clientName: client ? `${client.name} ${client.lastName}` : 'N/A',
                        phone: client?.phone || 'N/A',
                        saleId: log.saleId,
                        saleBalance: log.sale ? parseFloat(log.sale.balanceDue) : 0,
                        result: log.result,
                        notes: log.notes,
                        nextActionDate: log.nextActionDate || ''
                    });
                });
                
                // Configurar encabezados de respuesta
                const filename = `registro_gestiones_${new Date().toISOString().slice(0, 10)}.xlsx`;
                res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
                
                await workbook.xlsx.write(res);
                res.end();
                
            } catch (err) {
                console.error('Error al exportar logs de cobranza:', err);
                res.status(500).json({ 
                    success: false,
                    message: 'Error al procesar la exportación del registro de cobranza.',
                    error: err.message
                });
            }
        }
    );

    return router;
};

module.exports = initCollectionRoutes;
// routes/collectionRoutes.js

const express = require('express');
const router = express.Router();
const authorize = require('../middleware/authMiddleware'); 
const authorizeRoles = require('../middleware/roleMiddleware'); 
const exceljs = require('exceljs'); 
const { DataTypes } = require('sequelize'); 

// Referencias a Modelos (Se asume que se pasan a la función initCollectionRoutes)
let CollectionLog, Sale, User, Client; 

// =========================================================
// FUNCIÓN DE INICIALIZACIÓN DE RUTAS
// =========================================================
const initCollectionRoutes = (models) => {
    // Definición de modelos globales
    CollectionLog = models.CollectionLog;
    Sale = models.Sale;
    User = models.User;
    Client = models.Client;

    // =========================================================
    // POST /api/collections/log - Registrar una gestión de cobranza
    // CORRECCIÓN CRÍTICA: Obtenemos el ID del gestor del TOKEN (req.user.id)
    // =========================================================
    router.post(
        '/log',
        authorize, 
        authorizeRoles(['super_admin', 'regular_admin', 'collector_agent']), 
        async (req, res) => {
            // Ya NO requerimos collectorId en el body
            const { saleId, result, notes, nextActionDate } = req.body; 
            
            // OBTENEMOS EL ID DEL GESTOR DESDE EL TOKEN
            const collectorIdFromToken = req.user.id; 

            if (!saleId || !result || !notes) {
                return res.status(400).json({ message: 'Campos saleId, result y notes son obligatorios.' });
            }
            if (!collectorIdFromToken || collectorIdFromToken <= 0) {
                 return res.status(401).json({ message: 'ID de gestor no encontrado en el token. Inicie sesión de nuevo.' });
            }

            try {
                const sale = await Sale.findByPk(saleId);
                if (!sale) {
                    return res.status(404).json({ message: 'Venta no encontrada.' });
                }
                
                // Crear el nuevo registro de gestión
                const newLog = await CollectionLog.create({
                    saleId: saleId,
                    collectorId: collectorIdFromToken, // USAMOS EL ID SEGURO DEL TOKEN
                    result: result,
                    notes: notes,
                    date: new Date(), 
                    nextActionDate: nextActionDate || null 
                });

                res.status(201).json({ 
                    message: 'Gestión registrada con éxito.', 
                    log: newLog 
                });

            } catch (err) {
                console.error('Error al registrar gestión de cobranza:', err);
                res.status(500).json({ message: 'Error interno del servidor al registrar la gestión.' });
            }
        }
    );


    // =========================================================
    // GET /api/collections/export-log - Exportar registro a Excel (Sin cambios funcionales)
    // =========================================================
    router.get(
        '/export-log',
        authorize,
        authorizeRoles(['super_admin', 'regular_admin', 'viewer_reports']),
        async (req, res) => {
            try {
                const logs = await CollectionLog.findAll({
                    order: [['date', 'DESC']],
                    include: [
                        { 
                            model: Sale, 
                            as: 'sale',
                            attributes: ['id', 'clientId', 'balanceDue'], 
                            include: [{ model: Client, as: 'client', attributes: ['name', 'lastName'] }]
                        },
                        { model: User, as: 'collector', attributes: ['username'] }
                    ]
                });
                
                const workbook = new exceljs.Workbook();
                const worksheet = workbook.addWorksheet('Registro de Gestión de Cobranza');

                worksheet.columns = [
                    { header: 'ID Log', key: 'id', width: 10 },
                    { header: 'Fecha Gestión', key: 'date', width: 20, style: { numFmt: 'dd/mm/yyyy hh:mm' } },
                    { header: 'Gestor', key: 'collector', width: 25 },
                    { header: 'Cliente', key: 'clientName', width: 30 },
                    { header: 'ID Venta', key: 'saleId', width: 10 },
                    { header: 'Saldo Venta Actual', key: 'saleBalance', width: 15, style: { numFmt: '"$ "0.00' } },
                    { header: 'Resultado', key: 'result', width: 20 },
                    { header: 'Notas', key: 'notes', width: 50 },
                    { header: 'Próxima Acción', key: 'nextActionDate', width: 20, style: { numFmt: 'dd/mm/yyyy' } }
                ];

                logs.forEach(log => {
                    const client = log.sale?.client;
                    worksheet.addRow({
                        id: log.id,
                        date: log.date,
                        collector: log.collector?.username || 'N/A',
                        clientName: client ? `${client.name} ${client.lastName}` : 'N/A',
                        saleId: log.saleId,
                        saleBalance: log.sale ? parseFloat(log.sale.balanceDue) : 0,
                        result: log.result,
                        notes: log.notes,
                        nextActionDate: log.nextActionDate || ''
                    });
                });
                
                res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                res.setHeader('Content-Disposition', 'attachment; filename=' + `registro_gestiones_${new Date().toISOString().slice(0, 10)}.xlsx`);
                
                await workbook.xlsx.write(res);
                res.end();
                
            } catch (err) {
                console.error('Error al exportar logs de cobranza:', err);
                res.status(500).json({ message: 'Error al procesar la exportación del registro de cobranza.' });
            }
        }
    );

    return router;
};

module.exports = initCollectionRoutes;
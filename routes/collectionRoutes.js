// routes/collectionRoutes.js

const express = require('express');
const router = express.Router();
const authorize = require('../middleware/authMiddleware'); 
const authorizeRoles = require('../middleware/roleMiddleware'); 
const exceljs = require('exceljs'); 

// Model references (Se pasarán a la función initCollectionRoutes)
let CollectionLog, Sale, User, Client; 

// =========================================================
// FUNCIÓN DE INICIALIZACIÓN DE RUTAS
// =========================================================
const initCollectionRoutes = (models) => {
    // Definición de modelos globales
    CollectionLog = models.CollectionLog;
    Sale = models.Sale;
    User = models.User;
    Client = models.Client; // Necesario para obtener el nombre del cliente en el export

    // =========================================================
    // POST /api/collections/log - Registrar una gestión de cobranza
    // =========================================================
    router.post(
        '/log',
        authorize, 
        authorizeRoles(['super_admin', 'regular_admin', 'collector_agent']), 
        async (req, res) => {
            const { saleId, collectorId, result, notes, nextActionDate } = req.body;

            if (!saleId || !collectorId || !result || !notes) {
                return res.status(400).json({ message: 'Campos saleId, collectorId, result y notes son obligatorios.' });
            }

            try {
                // Verificar que la venta exista
                const sale = await Sale.findByPk(saleId);
                if (!sale) {
                    return res.status(404).json({ message: 'Venta no encontrada.' });
                }
                
                // Crear el nuevo registro de gestión
                const newLog = await CollectionLog.create({
                    saleId: saleId,
                    collectorId: collectorId,
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
    // GET /api/collections/export-log - Exportar registro a Excel
    // =========================================================
    router.get(
        '/export-log',
        authorize,
        authorizeRoles(['super_admin', 'regular_admin', 'viewer_reports']),
        async (req, res) => {
            try {
                const logs = await CollectionLog.findAll({
                    order: [['date', 'DESC']],
                    // Usamos las asociaciones definidas en index.js
                    include: [
                        { 
                            model: Sale, 
                            as: 'sale', // Usamos 'as'='sale' como se definió en index.js
                            attributes: ['id', 'clientId', 'balanceDue'], 
                            include: [{ model: Client, as: 'client', attributes: ['name', 'lastName'] }] // Incluimos Cliente a través de Venta
                        },
                        { model: User, as: 'collector', attributes: ['username'] } // Incluimos el Gestor
                    ]
                });
                
                const workbook = new exceljs.Workbook();
                const worksheet = workbook.addWorksheet('Registro de Gestión de Cobranza');

                // Definir las columnas
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

                // Llenar las filas
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
                
                // Devolver el archivo Excel
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
// routes/collectionRoutes.js - VERSIÓN COMPLETA CON EXPORTAR EXCEL

const express = require('express');
const router = express.Router();
const authorizeRoles = require('../middleware/roleMiddleware');
const applyStoreFilter = require('../middleware/storeFilterMiddleware');

module.exports = (models, sequelize) => {
    const { CollectionLog, Sale, User, Client } = models;

    // CREAR NUEVO LOG DE GESTIÓN
    router.post('/', 
        authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'collector_agent']),
        applyStoreFilter,
        async (req, res) => {
            try {
                const { saleId, contactType, contactResult, notes, nextContactDate } = req.body;

                // Verificar que la venta pertenece a la tienda del usuario
                const sale = await Sale.findOne({
                    where: {
                        id: saleId,
                        ...req.storeFilter
                    }
                });

                if (!sale) {
                    return res.status(404).json({ message: 'Venta no encontrada.' });
                }

                // Crear log
                const log = await CollectionLog.create({
                    saleId,
                    collectorId: req.user.userId,
                    contactType,
                    contactResult,
                    notes,
                    nextContactDate: nextContactDate || null
                });

                // Cargar con datos del usuario
                const logWithUser = await CollectionLog.findByPk(log.id, {
                    include: [{
                        model: User,
                        as: 'collector',
                        attributes: ['id', 'username']
                    }]
                });

                res.status(201).json(logWithUser);
            } catch (error) {
                console.error('Error al crear log de gestión:', error);
                res.status(500).json({ message: 'Error al crear log de gestión.' });
            }
        }
    );

    // OBTENER LOGS DE UNA VENTA
    router.get('/sale/:saleId',
        authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'collector_agent']),
        applyStoreFilter,
        async (req, res) => {
            try {
                const { saleId } = req.params;

                // Verificar que la venta pertenece a la tienda
                const sale = await Sale.findOne({
                    where: {
                        id: saleId,
                        ...req.storeFilter
                    }
                });

                if (!sale) {
                    return res.status(404).json({ message: 'Venta no encontrada.' });
                }

                // Obtener logs
                const logs = await CollectionLog.findAll({
                    where: { saleId },
                    include: [{
                        model: User,
                        as: 'collector',
                        attributes: ['id', 'username']
                    }],
                    order: [['createdAt', 'DESC']]
                });

                res.json(logs);
            } catch (error) {
                console.error('Error al obtener logs:', error);
                res.status(500).json({ message: 'Error al obtener logs.' });
            }
        }
    );

    // OBTENER LOGS DE UN CLIENTE (todas sus ventas)
    router.get('/client/:clientId',
        authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'collector_agent']),
        applyStoreFilter,
        async (req, res) => {
            try {
                const { clientId } = req.params;

                // Verificar que el cliente pertenece a la tienda
                const client = await Client.findOne({
                    where: {
                        id: clientId,
                        ...req.storeFilter
                    }
                });

                if (!client) {
                    return res.status(404).json({ message: 'Cliente no encontrado.' });
                }

                // Obtener todas las ventas del cliente
                const sales = await Sale.findAll({
                    where: {
                        clientId,
                        ...req.storeFilter
                    },
                    attributes: ['id']
                });

                const saleIds = sales.map(s => s.id);

                // Obtener logs de todas esas ventas
                const logs = await CollectionLog.findAll({
                    where: { saleId: saleIds },
                    include: [
                        {
                            model: User,
                            as: 'collector',
                            attributes: ['id', 'username']
                        },
                        {
                            model: Sale,
                            as: 'sale',
                            attributes: ['id', 'saleDate', 'totalAmount', 'balanceDue']
                        }
                    ],
                    order: [['createdAt', 'DESC']]
                });

                res.json(logs);
            } catch (error) {
                console.error('Error al obtener logs del cliente:', error);
                res.status(500).json({ message: 'Error al obtener logs.' });
            }
        }
    );

    // ⭐ NUEVO: EXPORTAR GESTIONES A EXCEL
    router.get('/export-excel',
        authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']),
        applyStoreFilter,
        async (req, res) => {
            try {
                const ExcelJS = require('exceljs');
                const { startDate, endDate } = req.query;

                // Construir filtro de fechas
                const whereClause = {};
                if (startDate && endDate) {
                    whereClause.createdAt = {
                        [sequelize.Op.between]: [new Date(startDate), new Date(endDate)]
                    };
                }

                // Obtener todas las gestiones
                const logs = await CollectionLog.findAll({
                    where: whereClause,
                    include: [
                        {
                            model: User,
                            as: 'collector',
                            attributes: ['id', 'username']
                        },
                        {
                            model: Sale,
                            as: 'sale',
                            attributes: ['id', 'clientId', 'totalAmount', 'balanceDue'],
                            where: req.storeFilter, // Filtro multi-tenant
                            include: [{
                                model: Client,
                                as: 'client',
                                attributes: ['id', 'name', 'lastName', 'phone']
                            }]
                        }
                    ],
                    order: [['createdAt', 'DESC']]
                });

                // Crear workbook
                const workbook = new ExcelJS.Workbook();
                const worksheet = workbook.addWorksheet('Gestiones de Cobranza');

                // Configurar columnas
                worksheet.columns = [
                    { header: 'ID', key: 'id', width: 8 },
                    { header: 'Fecha', key: 'fecha', width: 18 },
                    { header: 'Cliente', key: 'cliente', width: 30 },
                    { header: 'Teléfono', key: 'telefono', width: 15 },
                    { header: 'Tipo Contacto', key: 'tipoContacto', width: 18 },
                    { header: 'Resultado', key: 'resultado', width: 25 },
                    { header: 'Notas', key: 'notas', width: 40 },
                    { header: 'Próximo Contacto', key: 'proximoContacto', width: 18 },
                    { header: 'Gestor', key: 'gestor', width: 20 },
                    { header: 'Venta #', key: 'ventaId', width: 10 }
                ];

                // Estilo del encabezado
                worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
                worksheet.getRow(1).fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FF667EEA' }
                };
                worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
                worksheet.getRow(1).height = 25;

                // Mapeo de labels
                const contactTypeLabels = {
                    'phone_call': 'Llamada telefónica',
                    'whatsapp': 'WhatsApp',
                    'home_visit': 'Visita domiciliaria',
                    'sms': 'SMS',
                    'email': 'Email'
                };

                const resultLabels = {
                    'payment_promise': 'Promesa de pago',
                    'no_answer': 'No contesta',
                    'payment_made': 'Realizó pago',
                    'partial_payment': 'Pago parcial',
                    'refuses_to_pay': 'Se niega a pagar',
                    'wrong_number': 'Número equivocado',
                    'other': 'Otro'
                };

                // Agregar datos
                logs.forEach(log => {
                    const cliente = log.sale?.client 
                        ? `${log.sale.client.name} ${log.sale.client.lastName}`
                        : 'N/A';
                    
                    const telefono = log.sale?.client?.phone || 'N/A';

                    worksheet.addRow({
                        id: log.id,
                        fecha: log.createdAt ? new Date(log.createdAt).toLocaleString('es-MX') : '',
                        cliente: cliente,
                        telefono: telefono,
                        tipoContacto: contactTypeLabels[log.contactType] || log.contactType,
                        resultado: resultLabels[log.contactResult] || log.contactResult,
                        notas: log.notes || '',
                        proximoContacto: log.nextContactDate 
                            ? new Date(log.nextContactDate).toLocaleString('es-MX') 
                            : '',
                        gestor: log.collector?.username || 'N/A',
                        ventaId: log.saleId
                    });
                });

                // Aplicar bordes y colores alternados
                worksheet.eachRow((row, rowNumber) => {
                    row.eachCell((cell) => {
                        cell.border = {
                            top: { style: 'thin' },
                            left: { style: 'thin' },
                            bottom: { style: 'thin' },
                            right: { style: 'thin' }
                        };
                    });

                    // Alternar colores de filas
                    if (rowNumber > 1 && rowNumber % 2 === 0) {
                        row.eachCell((cell) => {
                            cell.fill = {
                                type: 'pattern',
                                pattern: 'solid',
                                fgColor: { argb: 'FFF8F9FA' }
                            };
                        });
                    }
                });

                // Generar buffer
                const buffer = await workbook.xlsx.writeBuffer();

                // Enviar archivo
                res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                res.setHeader('Content-Disposition', `attachment; filename=gestiones_cobranza_${new Date().toISOString().split('T')[0]}.xlsx`);
                res.send(buffer);

            } catch (error) {
                console.error('Error al exportar gestiones:', error);
                res.status(500).json({ message: 'Error al exportar gestiones a Excel' });
            }
        }
    );

    return router;
};
// Archivo: routes/salePaymentRoutes.js

const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const authMiddleware = require('../middleware/authMiddleware');
const authorizeRoles = require('../middleware/roleMiddleware');
const moment = require('moment-timezone');
const ExcelJS = require('exceljs'); // Importar exceljs

let Sale, Client, Product, Payment, SaleItem, User, AuditLog;
const TIMEZONE = "America/Mexico_City";

const initSalePaymentRoutes = (models, sequelize) => {
    Sale = models.Sale;
    Client = models.Client;
    Product = models.Product;
    Payment = models.Payment;
    SaleItem = models.SaleItem;
    User = models.User;
    AuditLog = models.AuditLog;
    
    // Las rutas existentes (GET, POST, PUT, DELETE) no cambian...
    // ... (todo el código de las rutas existentes va aquí) ...

    router.get('/', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']), async (req, res) => {
        // ...código existente
    });

    router.get('/my-assigned', authorizeRoles(['collector_agent']), async (req, res) => {
        // ...código existente
    });

    router.get('/:saleId', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'collector_agent']), async (req, res) => {
        // ...código existente
    });
    
    router.post('/', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
        // ...código existente
    });

    router.put('/:saleId/assign', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
       // ...código existente
    });

    router.post('/:saleId/payments', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'collector_agent']), async (req, res) => {
        // ...código existente
    });

    router.delete('/:saleId', authorizeRoles(['super_admin']), async (req, res) => {
        // ...código existente
    });


    // --- INICIO: NUEVA RUTA PARA EXPORTAR VENTAS A EXCEL ---
    router.get('/export-excel', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']), async (req, res) => {
        try {
            const sales = await Sale.findAll({
                include: [
                    { model: Client, as: 'client', attributes: ['name', 'lastName'] },
                    { model: SaleItem, as: 'saleItems', include: [{ model: Product, as: 'product', attributes: ['name'] }] },
                    { model: User, as: 'assignedCollector', attributes: ['username'] }
                ],
                order: [['saleDate', 'DESC']]
            });

            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Reporte de Ventas');

            worksheet.columns = [
                { header: 'ID Venta', key: 'id', width: 10 },
                { header: 'Fecha', key: 'saleDate', width: 20, style: { numFmt: 'dd/mm/yyyy hh:mm' } },
                { header: 'Cliente', key: 'clientName', width: 30 },
                { header: 'Productos', key: 'products', width: 50 },
                { header: 'Monto Total', key: 'totalAmount', width: 15, style: { numFmt: '"$"#,##0.00' } },
                { header: 'Tipo', key: 'type', width: 15 },
                { header: 'Enganche', key: 'downPayment', width: 15, style: { numFmt: '"$"#,##0.00' } },
                { header: 'Saldo Pendiente', key: 'balanceDue', width: 15, style: { numFmt: '"$"#,##0.00' } },
                { header: 'Estado', key: 'status', width: 20 },
                { header: 'Gestor Asignado', key: 'collector', width: 25 },
            ];

            sales.forEach(sale => {
                worksheet.addRow({
                    id: sale.id,
                    saleDate: moment(sale.saleDate).tz(TIMEZONE).toDate(),
                    clientName: sale.client ? `${sale.client.name} ${sale.client.lastName}` : 'N/A',
                    products: sale.saleItems.map(item => `${item.quantity}x ${item.product.name}`).join(', '),
                    totalAmount: sale.totalAmount,
                    type: sale.isCredit ? 'Crédito' : 'Contado',
                    downPayment: sale.downPayment,
                    balanceDue: sale.balanceDue,
                    status: sale.status.replace('_', ' '),
                    collector: sale.assignedCollector ? sale.assignedCollector.username : 'Sin Asignar',
                });
            });

            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', 'attachment; filename="Reporte_Ventas.xlsx"');
            await workbook.xlsx.write(res);
            res.end();

        } catch (error) {
            console.error('Error al exportar ventas a Excel:', error);
            res.status(500).json({ message: 'Error interno del servidor al generar el reporte.' });
        }
    });
    // --- FIN: NUEVA RUTA PARA EXPORTAR VENTAS A EXCEL ---


    return router;
};

module.exports = initSalePaymentRoutes;
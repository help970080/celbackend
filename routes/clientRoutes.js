const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const authorizeRoles = require('../middleware/roleMiddleware');
const { Op, Sequelize } = require('sequelize');
const ExcelJS = require('exceljs');
const moment = require('moment-timezone');

let Client, Sale, SaleItem, Product, Payment;

const TIMEZONE = "America/Mexico_City";

const initClientRoutes = (models) => {
    Client = models.Client;
    Sale = models.Sale;
    SaleItem = models.SaleItem;
    Product = models.Product;
    Payment = models.Payment;

    router.get('/', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
        try {
            const { search, page, limit } = req.query;
            const whereClause = {};

            if (search) {
                whereClause[Op.or] = [
                    { name: { [Op.like]: `%${search}%` } },
                    { lastName: { [Op.like]: `%${search}%` } },
                    { phone: { [Op.like]: `%${search}%` } },
                    { email: { [Op.like]: `%${search}%` } },
                    { address: { [Op.like]: `%${search}%` } },
                    { identificationId: { [Op.like]: `%${search}%` } }
                ];
            }

            const pageNum = parseInt(page, 10) || 1;
            const limitNum = parseInt(limit, 10) || 10;
            const offset = (pageNum - 1) * limitNum;

            const { count, rows } = await Client.findAndCountAll({
                where: whereClause,
                order: [['name', 'ASC']],
                limit: limitNum,
                offset: offset
            });

            res.json({
                totalItems: count,
                totalPages: Math.ceil(count / limitNum),
                currentPage: pageNum,
                clients: rows
            });
        } catch (error) {
            console.error('Error al obtener clientes con búsqueda/paginación:', error);
            res.status(500).json({ message: 'Error interno del servidor al obtener clientes.' });
        }
    });

    // RUTA MODIFICADA: Exportar clientes con detalles de cobranza y GRADO DE RIESGO
    router.get('/export-excel', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
        try {
            const clientsToExport = await Client.findAll({
                include: [
                    {
                        model: Sale,
                        as: 'sales',
                        where: { isCredit: true },
                        required: false,
                        include: [
                            { model: SaleItem, as: 'saleItems', include: [{ model: Product, as: 'product' }] },
                            { model: Payment, as: 'payments' }
                        ]
                    }
                ],
                order: [['name', 'ASC']]
            });

            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Clientes con Cobranza y Riesgo'); // Nombre de la hoja actualizado

            // Definir columnas y encabezados (Añadiendo Grado de Riesgo)
            worksheet.columns = [
                { header: 'ID Cliente', key: 'clientId', width: 10 },
                { header: 'Nombre', key: 'name', width: 20 },
                { header: 'Apellido', key: 'lastName', width: 20 },
                { header: 'Teléfono', key: 'phone', width: 18 },
                { header: 'Email', key: 'email', width: 25 },
                { header: 'Dirección Completa', key: 'fullAddress', width: 40 },
                { header: 'ID Identificación', key: 'identificationId', width: 20 },
                { header: 'Notas Cliente', key: 'clientNotes', width: 40 },
                { header: 'Total Ventas Crédito ($)', key: 'totalSalesAmountClient', width: 20, style: { numFmt: '#,##0.00' } },
                { header: 'Total Pagos Recibidos ($)', key: 'totalPaymentsReceivedClient', width: 20, style: { numFmt: '#,##0.00' } },
                { header: 'Saldo Total Pendiente ($)', key: 'totalBalanceDueClient', width: 20, style: { numFmt: '#,##0.00' } },
                { header: 'Estado General Cobranza', key: 'overallStatus', width: 25 },
                { header: 'Detalle Estado Cobranza', key: 'statusDetails', width: 40 },
                { header: 'Grado de Riesgo', key: 'riskCategory', width: 18 }, // NUEVA COLUMNA
                { header: 'Detalle del Riesgo', key: 'riskDetails', width: 40 }, // NUEVA COLUMNA
                { header: 'Última Fecha de Pago', key: 'lastPaymentDate', width: 20, style: { numFmt: 'dd/mm/yyyy hh:mm' } },
                { header: 'Notas de Último Pago', key: 'lastPaymentNotes', width: 30 },
                { header: 'Cantidad Ventas Crédito', key: 'creditSalesCount', width: 15 },
                { header: 'Ventas Vencidas', key: 'overdueSalesCount', width: 15 }
            ];

            // Añadir filas de datos
            clientsToExport.forEach(client => {
                let totalBalanceDueClient = 0;
                let hasOverdueSale = false;
                let hasDueSoonSale = false;
                let allCreditSalesPaidOff = true;
                let lastPaymentDate = null;
                let lastPaymentNotes = 'N/A';
                let totalSalesAmountClient = 0;
                let totalPaymentsReceivedClient = 0;
                let creditSalesCount = 0;
                let overdueSalesCount = 0;

                const today = moment().tz(TIMEZONE).startOf('day');
                const daysToDueSoon = 7;

                if (client.sales && client.sales.length > 0) {
                    creditSalesCount = client.sales.length;
                    
                    client.sales.forEach(sale => {
                        totalSalesAmountClient += sale.totalAmount;
                        totalBalanceDueClient += sale.balanceDue;

                        if (sale.balanceDue > 0) {
                            allCreditSalesPaidOff = false;

                            let nextPaymentDueDateForSale = null;
                            if (sale.payments && sale.payments.length > 0) {
                                const sortedPayments = sale.payments.sort((a, b) => new Date(b.paymentDate) - new Date(a.paymentDate));
                                const latestPayment = sortedPayments[0];
                                const lastPaymentMoment = moment(latestPayment.paymentDate).tz(TIMEZONE).startOf('day');
                                nextPaymentDueDateForSale = lastPaymentMoment.add(7, 'days').startOf('day');
                                
                                if (!lastPaymentDate || moment(latestPayment.paymentDate).isAfter(lastPaymentDate)) {
                                    lastPaymentDate = moment(latestPayment.paymentDate);
                                    lastPaymentNotes = latestPayment.notes || 'Sin notas';
                                }
                            } else {
                                nextPaymentDueDateForSale = moment(sale.saleDate).tz(TIMEZONE).add(7, 'days').startOf('day');
                            }

                            if (nextPaymentDueDateForSale.isBefore(today)) {
                                hasOverdueSale = true;
                                overdueSalesCount++;
                            } else if (nextPaymentDueDateForSale.diff(today, 'days') <= daysToDueSoon) {
                                hasDueSoonSale = true;
                            }
                        }

                        if (sale.payments) {
                            sale.payments.forEach(payment => {
                                totalPaymentsReceivedClient += payment.amount;
                            });
                        }
                    });
                }

                // Lógica para determinar el Grado de Riesgo (replicada de reportRoutes.js)
                let riskCategory = 'Sin Datos Crédito'; // Nuevo estado por defecto
                let riskDetails = 'Este cliente no tiene ventas a crédito registradas.';

                if (creditSalesCount > 0) {
                    if (hasOverdueSale) {
                        riskCategory = 'ALTO';
                        riskDetails = `Tiene ${overdueSalesCount} venta(s) a crédito vencida(s).`;
                    } else if (hasDueSoonSale) {
                        riskCategory = 'MEDIO';
                        riskDetails = `Tiene ventas a crédito por vencer en los próximos ${daysToDueSoon} días.`;
                    } else if (totalBalanceDueClient <= 0 && allCreditSalesPaidOff) { // Si el totalBalanceDueClient es 0 o menos y todas están marcadas como pagadas
                        riskCategory = 'BAJO';
                        riskDetails = 'Todas las ventas a crédito han sido saldadas.';
                    } else { // Si tiene ventas con saldo pero no vencidas ni por vencer (y no todas pagadas)
                        riskCategory = 'BAJO';
                        riskDetails = 'Sus ventas a crédito están al corriente.';
                    }
                }
                
                worksheet.addRow({
                    clientId: client.id,
                    name: client.name || '',
                    lastName: client.lastName || '',
                    phone: client.phone || '',
                    email: client.email || '',
                    fullAddress: `${client.address || ''}, ${client.city || ''}, ${client.state || ''}, ${client.zipCode || ''}`.replace(/,\s*,/g, ', ').replace(/^,\s*/, '').replace(/,\s*$/, '') || 'N/A',
                    identificationId: client.identificationId || '',
                    clientNotes: client.notes || '',
                    totalSalesAmountClient: totalSalesAmountClient,
                    totalPaymentsReceivedClient: totalPaymentsReceivedClient,
                    totalBalanceDueClient: totalBalanceDueClient,
                    overallStatus: riskCategory, // Usar la categoría de riesgo como estado general para simplicidad o puedes mantener otro estado
                    statusDetails: riskDetails, // Usar el detalle del riesgo aquí
                    riskCategory: riskCategory, // Grado de Riesgo
                    riskDetails: riskDetails,   // Detalle del Riesgo
                    lastPaymentDate: lastPaymentDate ? lastPaymentDate.toDate() : null,
                    lastPaymentNotes: lastPaymentNotes,
                    creditSalesCount: creditSalesCount,
                    overdueSalesCount: overdueSalesCount
                });
            });

            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', 'attachment; filename=clientes_cobranza_riesgo.xlsx'); // Nuevo nombre de archivo

            await workbook.xlsx.write(res);
            res.end();

        } catch (error) {
            console.error('CRITICAL ERROR al exportar clientes a Excel (Backend):', error);
            res.status(500).json({ message: 'Error interno del servidor al exportar clientes. Por favor, revisa los logs del servidor para más detalles.', error: error.message });
        }
    });


    router.get('/:id', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
        try {
            const client = await Client.findByPk(req.params.id);
            if (!client) {
                return res.status(404).json({ message: 'Cliente no encontrado.' });
            }
            res.json(client);
        } catch (error) {
            console.error('Error al obtener cliente por ID:', error);
            res.status(500).json({ message: 'Error interno del servidor al obtener cliente.' });
        }
    });

    router.post('/', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
        try {
            const { name, lastName, phone, email, address, city, state, zipCode, identificationId, notes } = req.body;
            const newClient = await Client.create({
                name,
                lastName,
                phone,
                email: email === '' ? null : email,
                address,
                city,
                state,
                zipCode,
                identificationId: identificationId === '' ? null : identificationId,
                notes: notes === '' ? null : notes,
            });
            res.status(201).json(newClient);
        } catch (error) {
            console.error('Error al crear cliente:', error);
            if (error.name === 'SequelizeUniqueConstraintError') {
                return res.status(400).json({ message: 'Ya existe un cliente con este email o teléfono.' });
            }
            res.status(500).json({ message: 'Error interno del servidor al crear cliente.' });
        }
    });

    router.put('/:id', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
        try {
            const { name, lastName, phone, email, address, city, state, zipCode, identificationId, notes } = req.body;
            const [updatedRows] = await Client.update({
                name,
                lastName,
                phone,
                email: email === '' ? null : email,
                address,
                city,
                state,
                zipCode,
                identificationId: identificationId === '' ? null : identificationId,
                notes: notes === '' ? null : notes,
            }, {
                where: { id: req.params.id }
            });
            if (updatedRows === 0) {
                return res.status(404).json({ message: 'Cliente no encontrado o no se realizaron cambios.' });
            }
            const updatedClient = await Client.findByPk(req.params.id);
            res.json(updatedClient);
        } catch (error) {
            console.error('Error al actualizar cliente:', error);
            if (error.name === 'SequelizeUniqueConstraintError') {
                return res.status(400).json({ message: 'Ya existe un cliente con este email o teléfono.' });
            }
            res.status(500).json({ message: 'Error interno del servidor al actualizar cliente.' });
        }
    });

    router.delete('/:id', authMiddleware, authorizeRoles(['super_admin']), async (req, res) => {
        try {
            const deletedRows = await Client.destroy({
                where: { id: req.params.id }
            });
            if (deletedRows === 0) {
                return res.status(404).json({ message: 'Cliente no encontrado.' });
            }
            res.status(204).send();
        } catch (error) {
            console.error('Error al eliminar cliente:', error);
            res.status(500).json({ message: 'Error interno del servidor al eliminar cliente.' });
        }
    });

    return router;
};

module.exports = initClientRoutes;
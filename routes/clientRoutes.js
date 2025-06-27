const express = require('express');
const router = express.Router();
const authorizeRoles = require('../middleware/roleMiddleware');
const { Op } = require('sequelize');
const ExcelJS = require('exceljs');
const moment = require('moment-timezone');

let Client, Sale, Payment, AuditLog;
const TIMEZONE = "America/Mexico_City";

const initClientRoutes = (models) => {
    Client = models.Client;
    Sale = models.Sale;
    Payment = models.Payment;
    AuditLog = models.AuditLog;

    // ... (La ruta GET / no cambia) ...
    router.get('/', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
        try {
            const { search, page, limit } = req.query;
            const whereClause = {};
            if (search) {
                whereClause[Op.or] = [
                    { name: { [Op.iLike]: `%${search}%` } },
                    { lastName: { [Op.iLike]: `%${search}%` } },
                    { phone: { [Op.iLike]: `%${search}%` } },
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
            res.json({ totalItems: count, totalPages: Math.ceil(count / limitNum), currentPage: pageNum, clients: rows });
        } catch (error) {
            console.error("Error en la ruta GET /api/clients:", error);
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    // ... (La ruta GET /export-excel no cambia) ...
    router.get('/export-excel', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
        try {
            const clients = await Client.findAll({
                include: [{
                    model: Sale,
                    as: 'sales',
                    where: { isCredit: true },
                    required: false,
                    include: [{ model: Payment, as: 'payments' }]
                }]
            });
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Clientes y Riesgo');
            worksheet.columns = [
                { header: 'ID Cliente', key: 'id', width: 10 },
                { header: 'Nombre Completo', key: 'name', width: 30 },
                { header: 'Teléfono', key: 'phone', width: 15 },
                { header: 'Email', key: 'email', width: 30 },
                { header: 'Total Adeudo', key: 'totalDebt', width: 15, style: { numFmt: '"$"#,##0.00' } },
                { header: 'Riesgo', key: 'risk', width: 15 },
                { header: 'Notas de Riesgo', key: 'riskDetails', width: 40 },
                { header: 'Fecha de Registro', key: 'createdAt', width: 20 },
            ];

            const today = moment().tz(TIMEZONE).startOf('day');
            for (const client of clients) {
                let totalDebt = 0;
                let riskCategory = 'BAJO';
                let riskDetails = 'Sin créditos activos.';
                let hasOverdueSale = false;

                if (client.sales && client.sales.length > 0) {
                    client.sales.forEach(sale => { totalDebt += sale.balanceDue; });
                    hasOverdueSale = client.sales.some(sale => {
                        if (sale.balanceDue > 0) {
                            const lastPaymentDate = sale.payments.length > 0 ? moment(sale.payments.sort((a,b) => new Date(b.paymentDate) - new Date(a.paymentDate))[0].paymentDate) : moment(sale.saleDate);
                            return moment(lastPaymentDate).tz(TIMEZONE).add(8, 'days').isBefore(today);
                        }
                        return false;
                    });
                    if(totalDebt > 0) {
                        riskCategory = hasOverdueSale ? 'ALTO' : 'BAJO';
                        riskDetails = hasOverdueSale ? 'Tiene pagos atrasados.' : 'Pagos al corriente.';
                    }
                }
                worksheet.addRow({ id: client.id, name: `${client.name} ${client.lastName}`, phone: client.phone, email: client.email, totalDebt, risk: riskCategory, riskDetails, createdAt: client.createdAt });
            }
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', 'attachment; filename="Reporte_Clientes_Riesgo.xlsx"');
            await workbook.xlsx.write(res);
            res.end();
        } catch (error) {
            res.status(500).json({ message: 'Error al generar el reporte de Excel.' });
        }
    });

    // ... (La ruta GET /:id no cambia) ...
    router.get('/:id', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'collector_agent']), async (req, res) => {
        const { id } = req.params;
        if (isNaN(parseInt(id, 10))) {
            return res.status(400).json({ message: 'El ID del cliente debe ser un número válido.' });
        }
        try {
            const client = await Client.findByPk(id);
            if (!client) return res.status(404).json({ message: 'Cliente no encontrado.' });
            res.json(client);
        } catch (error) {
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    // ... (La ruta POST / no cambia) ...
    router.post('/', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
        try {
            const newClient = await Client.create(req.body);

            try {
                await AuditLog.create({
                    userId: req.user.userId,
                    username: req.user.username,
                    action: 'CREÓ CLIENTE',
                    details: `Cliente: ${newClient.name} ${newClient.lastName} (ID: ${newClient.id})`
                });
            } catch (auditError) { console.error("Error al registrar en auditoría:", auditError); }

            res.status(201).json(newClient);
        } catch (error) {
            if (error.name === 'SequelizeUniqueConstraintError') return res.status(400).json({ message: 'Ya existe un cliente con este email o teléfono.' });
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    // --- INICIO DE LA CORRECCIÓN ---
    router.put('/:id', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
        const { id } = req.params;
        if (isNaN(parseInt(id, 10))) {
            return res.status(400).json({ message: 'El ID del cliente debe ser un número válido.' });
        }
        try {
            const client = await Client.findByPk(id);
            if (!client) return res.status(404).json({ message: 'Cliente no encontrado.' });
            
            await client.update(req.body);

            try {
                await AuditLog.create({
                    userId: req.user.userId,
                    username: req.user.username,
                    action: 'ACTUALIZÓ CLIENTE',
                    details: `Cliente: ${client.name} ${client.lastName} (ID: ${client.id})`
                });
            } catch (auditError) { console.error("Error al registrar en auditoría:", auditError); }

            res.json(client);
        } catch (error) {
            // Se añade el manejador de error para la restricción de unicidad
            if (error.name === 'SequelizeUniqueConstraintError') {
                return res.status(409).json({ message: 'El teléfono o email ya está en uso por otro cliente.' });
            }
            console.error("Error al actualizar cliente:", error);
            res.status(500).json({ message: 'Error interno del servidor al actualizar el cliente.' });
        }
    });
    // --- FIN DE LA CORRECCIÓN ---

    // ... (La ruta DELETE / no cambia) ...
    router.delete('/:id', authorizeRoles(['super_admin']), async (req, res) => {
        const { id } = req.params;
        if (isNaN(parseInt(id, 10))) {
            return res.status(400).json({ message: 'El ID del cliente debe ser un número válido.' });
        }
        try {
            const client = await Client.findByPk(id);
            if (!client) return res.status(404).json({ message: 'Cliente no encontrado.' });
            
            const clientNameForLog = `${client.name} ${client.lastName}`;
            await client.destroy();

            try {
                await AuditLog.create({
                    userId: req.user.userId,
                    username: req.user.username,
                    action: 'ELIMINÓ CLIENTE',
                    details: `Cliente: ${clientNameForLog} (ID: ${id})`
                });
            } catch (auditError) { console.error("Error al registrar en auditoría:", auditError); }

            res.status(204).send();
        } catch (error) {
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });


    return router;
};

module.exports = initClientRoutes;
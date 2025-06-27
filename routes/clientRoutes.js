const express = require('express');
const router = express.Router();
const authorizeRoles = require('../middleware/roleMiddleware');
const { Op } = require('sequelize'); // La importación clave
const ExcelJS = require('exceljs');
const moment = require('moment-timezone');

let Client, Sale, Payment, AuditLog;
const TIMEZONE = "America/Mexico_City";

const initClientRoutes = (models) => {
    Client = models.Client;
    Sale = models.Sale;
    Payment = models.Payment;
    AuditLog = models.AuditLog;

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
            const { count, rows } = await Client.findAndCountAll({ where: whereClause, order: [['name', 'ASC']], limit: limitNum, offset: offset });
            res.json({ totalItems: count, totalPages: Math.ceil(count / limitNum), currentPage: pageNum, clients: rows });
        } catch (error) {
            console.error("Error en la ruta GET /api/clients:", error);
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    // ... (el resto de las rutas del archivo no cambian)
    return router;
};

module.exports = initClientRoutes;
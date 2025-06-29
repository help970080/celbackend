// Archivo: routes/auditRoutes.js

const express = require('express');
const router = express.Router();
const authorizeRoles = require('../middleware/roleMiddleware');
const { Op } = require('sequelize');
const moment = require('moment-timezone'); // Necesitamos moment para las fechas

let AuditLog;

const initAuditRoutes = (models) => {
    AuditLog = models.AuditLog;

    router.get('/', authorizeRoles(['super_admin']), async (req, res) => {
        try {
            // --- INICIO DE LA MODIFICACIÓN ---
            const { page = 1, limit = 20, startDate, endDate, userId } = req.query;
            const pageNum = parseInt(page, 10);
            const limitNum = parseInt(limit, 10);
            const offset = (pageNum - 1) * limitNum;

            // Construcción dinámica de la cláusula WHERE para los filtros
            const whereClause = {};
            if (startDate && endDate) {
                whereClause.createdAt = {
                    [Op.between]: [
                        moment(startDate).startOf('day').toDate(),
                        moment(endDate).endOf('day').toDate()
                    ]
                };
            }
            if (userId && userId !== 'all') {
                whereClause.userId = parseInt(userId, 10);
            }
            // --- FIN DE LA MODIFICACIÓN ---

            const { count, rows } = await AuditLog.findAndCountAll({
                where: whereClause, // Se aplica el filtro
                order: [['createdAt', 'DESC']],
                limit: limitNum,
                offset: offset,
            });
            
            res.json({
                totalItems: count,
                totalPages: Math.ceil(count / limitNum),
                currentPage: pageNum,
                logs: rows
            });
        } catch (error) {
            console.error('Error al obtener logs de auditoría:', error);
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    return router;
};

module.exports = initAuditRoutes;
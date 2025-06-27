const express = require('express');
const router = express.Router();
const authorizeRoles = require('../middleware/roleMiddleware');
const { Op } = require('sequelize');

let AuditLog;

const initAuditRoutes = (models) => {
    AuditLog = models.AuditLog;

    router.get('/', authorizeRoles(['super_admin']), async (req, res) => {
        try {
            const { page = 1, limit = 20 } = req.query;
            const pageNum = parseInt(page, 10);
            const limitNum = parseInt(limit, 10);
            const offset = (pageNum - 1) * limitNum;

            const { count, rows } = await AuditLog.findAndCountAll({
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
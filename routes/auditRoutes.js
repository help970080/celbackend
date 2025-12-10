const express = require('express');
const router = express.Router();
const authorizeRoles = require('../middleware/roleMiddleware');
const applyStoreFilter = require('../middleware/storeFilterMiddleware'); // ⭐ NUEVO
const { Op } = require('sequelize');
const moment = require('moment-timezone');

let AuditLog;

const initAuditRoutes = (models) => {
    AuditLog = models.AuditLog;

    router.get('/', 
        authorizeRoles(['super_admin']),
        applyStoreFilter, // ⭐ NUEVO
        async (req, res) => {
            try {
                const { page = 1, limit = 20, startDate, endDate, userId } = req.query;
                const pageNum = parseInt(page, 10);
                const limitNum = parseInt(limit, 10);
                const offset = (pageNum - 1) * limitNum;

                // ⭐ NUEVO: Incluir filtro por tienda
                const whereClause = { ...req.storeFilter };
                
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

                const { count, rows } = await AuditLog.findAndCountAll({
                    where: whereClause,
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
        }
    );

    return router;
};

module.exports = initAuditRoutes;
const express = require('express');
const router = express.Router();
const { Op, Sequelize } = require('sequelize');
const authMiddleware = require('../middleware/authMiddleware');
const authorizeRoles = require('../middleware/roleMiddleware');

let Sale, Client, Product, SaleItem;

const initSalePaymentRoutes = (models) => {
    Sale = models.Sale;
    Client = models.Client;
    Product = models.Product;
    SaleItem = models.SaleItem;

    // --- RUTA DE PRUEBA DE VERSIÓN ---
    // Su único propósito es confirmar que este archivo se desplegó correctamente.
    router.get('/version', (req, res) => {
        res.status(200).json({ 
            file: 'salePaymentRoutes.js',
            version: '3.0.0-final-validation', 
            status: 'Deployment successful'
        });
    });
    // --- FIN DE LA RUTA DE PRUEBA ---

    // RUTA PRINCIPAL CORREGIDA para obtener la lista de ventas
    router.get('/', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
        try {
            const { search, page = 1, limit = 10 } = req.query;
            const whereClause = {};
            
            const includeClause = [
                { model: Client, as: 'client', attributes: ['name', 'lastName'] },
                { model: SaleItem, as: 'saleItems', include: [{ model: Product, as: 'product', attributes: ['name'] }] }
            ];

            if (search) {
                whereClause[Op.or] = [
                    Sequelize.where(Sequelize.cast(Sequelize.col('Sale.id'), 'varchar'), { [Op.iLike]: `%${search}%` }),
                    { '$client.name$': { [Op.iLike]: `%${search}%` } },
                    { '$client.lastName$': { [Op.iLike]: `%${search}%` } }
                ];
            }

            const pageNum = parseInt(page, 10);
            const limitNum = parseInt(limit, 10);

            const { count, rows } = await Sale.findAndCountAll({
                where: whereClause,
                include: includeClause,
                order: [['saleDate', 'DESC']],
                limit: limitNum,
                offset: (pageNum - 1) * limitNum,
                distinct: true,
                subQuery: false
            });

            res.json({
                totalItems: count,
                totalPages: Math.ceil(count / limitNum),
                currentPage: pageNum,
                sales: rows
            });
        } catch (error) {
            console.error('Error al obtener ventas:', error);
            res.status(500).json({ message: 'Error interno del servidor al obtener ventas.' });
        }
    });

    // ... (El resto de tus rutas POST, PUT, DELETE, etc., se mantienen intactas)

    return router;
};

module.exports = initSalePaymentRoutes;
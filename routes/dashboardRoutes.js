const express = require('express');
const router = express.Router();
const authorizeRoles = require('../middleware/roleMiddleware');
const applyStoreFilter = require('../middleware/storeFilterMiddleware'); // ⭐ NUEVO
const { Op } = require('sequelize');

let Sale, Product, SaleItem;

const initDashboardRoutes = (models) => {
    Sale = models.Sale;
    Product = models.Product;
    SaleItem = models.SaleItem;

    // Ruta para obtener datos de ventas a lo largo del tiempo (para gráfica de líneas)
    router.get('/sales-over-time', 
        authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']),
        applyStoreFilter, // ⭐ NUEVO
        async (req, res) => {
            try {
                // ⭐ NUEVO: Filtrar por tienda
                const salesData = await Sale.findAll({
                    attributes: [
                        [models.sequelize.fn('DATE', models.sequelize.col('saleDate')), 'date'],
                        [models.sequelize.fn('SUM', models.sequelize.col('totalAmount')), 'totalSales']
                    ],
                    where: req.storeFilter,
                    group: [models.sequelize.fn('DATE', models.sequelize.col('saleDate'))],
                    order: [[models.sequelize.fn('DATE', models.sequelize.col('saleDate')), 'ASC']],
                    raw: true
                });
                res.json(salesData);
            } catch (error) {
                console.error("Error al obtener datos para gráfica de ventas:", error);
                res.status(500).json({ message: 'Error al obtener datos de ventas.' });
            }
        }
    );

    // Ruta para obtener los productos más vendidos (para gráfica de pie/dona)
    router.get('/top-products', 
        authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']),
        applyStoreFilter, // ⭐ NUEVO
        async (req, res) => {
            try {
                // ⭐ NUEVO: Filtrar productos por tienda a través de las ventas
                const topProducts = await SaleItem.findAll({
                    attributes: [
                        [models.sequelize.col('product.name'), 'productName'],
                        [models.sequelize.fn('SUM', models.sequelize.col('quantity')), 'totalSold']
                    ],
                    include: [{
                        model: Product,
                        as: 'product',
                        attributes: [],
                        where: req.storeFilter // ⭐ NUEVO: Filtrar por tienda
                    }],
                    group: ['product.name'],
                    order: [[models.sequelize.fn('SUM', models.sequelize.col('quantity')), 'DESC']],
                    limit: 5,
                    raw: true
                });
                res.json(topProducts);
            } catch (error) {
                console.error("Error al obtener datos de top productos:", error);
                res.status(500).json({ message: 'Error al obtener top productos.' });
            }
        }
    );

    return router;
};

module.exports = initDashboardRoutes;
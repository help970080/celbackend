// routes/dashboardRoutes.js - VERSIÓN CORREGIDA CON FILTROS MULTI-TENANT

const express = require('express');
const router = express.Router();
const authorizeRoles = require('../middleware/roleMiddleware');
const applyStoreFilter = require('../middleware/storeFilterMiddleware');
const { Op } = require('sequelize');

let Sale, Product, SaleItem;

const initDashboardRoutes = (models) => {
    Sale = models.Sale;
    Product = models.Product;
    SaleItem = models.SaleItem;

    // Ruta para obtener datos de ventas a lo largo del tiempo (para gráfica de líneas)
    router.get('/sales-over-time', 
        authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']),
        applyStoreFilter,
        async (req, res) => {
            try {
                const salesData = await Sale.findAll({
                    attributes: [
                        [models.sequelize.fn('DATE', models.sequelize.col('saleDate')), 'date'],
                        [models.sequelize.fn('SUM', models.sequelize.col('totalAmount')), 'totalSales']
                    ],
                    where: { ...req.storeFilter }, // ⭐ CORRECCIÓN: Spread operator
                    group: [models.sequelize.fn('DATE', models.sequelize.col('saleDate'))],
                    order: [[models.sequelize.fn('DATE', models.sequelize.col('saleDate')), 'ASC']],
                    raw: true
                });
                res.json(salesData);
            } catch (error) {
                console.error("Error al obtener datos para gráfica de ventas:", error);
                console.error("Stack trace:", error.stack);
                res.status(500).json({ 
                    message: 'Error al obtener datos de ventas.',
                    error: error.message 
                });
            }
        }
    );

    // Ruta para obtener los productos más vendidos (para gráfica de pie/dona)
    router.get('/top-products', 
        authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']),
        applyStoreFilter,
        async (req, res) => {
            try {
                // ⭐ CORRECCIÓN: Filtrar por tienda a través de Sale, no Product
                const topProducts = await SaleItem.findAll({
                    attributes: [
                        [models.sequelize.col('product.name'), 'productName'],
                        [models.sequelize.fn('SUM', models.sequelize.col('quantity')), 'totalSold']
                    ],
                    include: [
                        {
                            model: Product,
                            as: 'product',
                            attributes: [],
                            required: true
                        },
                        {
                            model: Sale,
                            as: 'sale',
                            attributes: [],
                            where: { ...req.storeFilter }, // ⭐ Filtrar por tienda en Sale
                            required: true
                        }
                    ],
                    group: ['product.name'],
                    order: [[models.sequelize.fn('SUM', models.sequelize.col('quantity')), 'DESC']],
                    limit: 5,
                    raw: true
                });
                res.json(topProducts);
            } catch (error) {
                console.error("Error al obtener datos de top productos:", error);
                console.error("Stack trace:", error.stack);
                res.status(500).json({ 
                    message: 'Error al obtener top productos.',
                    error: error.message 
                });
            }
        }
    );

    return router;
};

module.exports = initDashboardRoutes;
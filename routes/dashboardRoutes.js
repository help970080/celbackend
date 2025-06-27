const express = require('express');
const router = express.Router();
const authorizeRoles = require('../middleware/roleMiddleware');
const { Sequelize } = require('sequelize');

let Sale, Product, SaleItem;

const initDashboardRoutes = (models) => {
    Sale = models.Sale;
    Product = models.Product;
    SaleItem = models.SaleItem;

    // Ruta para obtener datos de ventas a lo largo del tiempo (para gráfica de líneas)
    router.get('/sales-over-time', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']), async (req, res) => {
        try {
            const salesData = await Sale.findAll({
                attributes: [
                    [Sequelize.fn('date_trunc', 'month', Sequelize.col('saleDate')), 'month'],
                    [Sequelize.fn('sum', Sequelize.col('totalAmount')), 'totalSales']
                ],
                group: [Sequelize.fn('date_trunc', 'month', Sequelize.col('saleDate'))],
                order: [[Sequelize.fn('date_trunc', 'month', Sequelize.col('saleDate')), 'ASC']]
            });
            res.json(salesData);
        } catch (error) {
            console.error("Error al obtener datos para gráfica de ventas:", error);
            res.status(500).json({ message: 'Error al obtener datos de ventas.' });
        }
    });

    // Ruta para obtener los productos más vendidos (para gráfica de pie/dona)
    router.get('/top-products', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']), async (req, res) => {
        try {
            const topProducts = await SaleItem.findAll({
                attributes: [
                    [Sequelize.col('product.name'), 'productName'],
                    [Sequelize.fn('sum', Sequelize.col('quantity')), 'totalSold']
                ],
                include: [{
                    model: Product,
                    as: 'product',
                    attributes: [] // No necesitamos columnas de la tabla de producto en sí
                }],
                group: ['product.name'],
                order: [[Sequelize.fn('sum', Sequelize.col('quantity')), 'DESC']],
                limit: 5 // Top 5
            });
            res.json(topProducts);
        } catch (error) {
            console.error("Error al obtener datos de top productos:", error);
            res.status(500).json({ message: 'Error al obtener top productos.' });
        }
    });

    return router;
};

module.exports = initDashboardRoutes;
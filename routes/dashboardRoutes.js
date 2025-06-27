const express = require('express');
const router = express.Router();
const authorizeRoles = require('../middleware/roleMiddleware');
const { Op, Sequelize } = require('sequelize');

let Sale, Product, SaleItem, Payment, User;

const initDashboardRoutes = (models) => {
    Sale = models.Sale;
    Product = models.Product;
    SaleItem = models.SaleItem;

    // Datos para la gráfica de ventas mensuales
    router.get('/sales-over-time', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']), async (req, res) => {
        try {
            const salesData = await Sale.findAll({
                attributes: [
                    [Sequelize.fn('date_trunc', 'month', Sequelize.col('saleDate')), 'month'],
                    [Sequelize.fn('sum', Sequelize.col('totalAmount')), 'totalSales']
                ],
                group: ['month'],
                order: [[Sequelize.fn('date_trunc', 'month', Sequelize.col('saleDate')), 'ASC']]
            });
            res.json(salesData);
        } catch (error) {
            res.status(500).json({ message: 'Error al obtener datos de ventas.' });
        }
    });

    // Datos para la gráfica de top productos
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
                    attributes: []
                }],
                group: ['product.name'],
                order: [[Sequelize.fn('sum', Sequelize.col('quantity')), 'DESC']],
                limit: 5
            });
            res.json(topProducts);
        } catch (error) {
            res.status(500).json({ message: 'Error al obtener top productos.' });
        }
    });

    return router;
};
module.exports = initDashboardRoutes;
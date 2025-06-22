const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const authorizeRoles = require('../middleware/roleMiddleware');
const { Op } = require('sequelize');
const ExcelJS = require('exceljs');

let Product;

const initProductRoutes = (models) => {
    Product = models.Product;

    // Ruta para listar productos (catálogo y búsquedas)
    router.get('/', async (req, res) => {
        try {
            const { sortBy, order, category, search, page, limit } = req.query;
            const options = {};
            const whereClause = {};

            if (category) {
                whereClause.category = category;
            }

            if (search) {
                whereClause[Op.or] = [
                    { name: { [Op.like]: `%${search}%` } },
                    { description: { [Op.like]: `%${search}%` } },
                    { category: { [Op.like]: `%${search}%` } },
                    { brand: { [Op.like]: `%${search}%` } }
                ];
            }

            if (sortBy) {
                const validSortBy = ['name', 'price', 'createdAt'];
                const sortOrder = (order && (order.toLowerCase() === 'asc' || order.toLowerCase() === 'desc')) ? order.toLowerCase() : 'asc';
                if (validSortBy.includes(sortBy)) {
                    options.order = [[sortBy, sortOrder.toUpperCase()]];
                }
            } else {
                options.order = [['createdAt', 'DESC']];
            }

            const pageNum = parseInt(page, 10) || 1;
            const limitNum = parseInt(limit, 10) || 10;
            const offset = (pageNum - 1) * limitNum;

            options.where = whereClause;
            options.limit = limitNum;
            options.offset = offset;

            const { count, rows } = await Product.findAndCountAll(options);

            res.json({
                totalItems: count,
                totalPages: Math.ceil(count / limitNum),
                currentPage: pageNum,
                products: rows
            });
        } catch (error) {
            console.error('Error al obtener productos con paginación:', error);
            res.status(500).json({ message: 'Error interno del servidor al obtener productos.' });
        }
    });

    // Ruta para obtener producto por ID
    router.get('/:id', async (req, res) => {
        try {
            const product = await Product.findByPk(req.params.id);
            if (!product) {
                return res.status(404).json({ message: 'Producto no encontrado.' });
            }
            res.json(product);
        } catch (error) {
            console.error('Error al obtener producto por ID:', error);
            res.status(500).json({ message: 'Error interno del servidor al obtener producto.' });
        }
    });

    // PRUEBA FINAL DE DIAGNÓSTICO: Para confirmar que los logs de Render funcionan.
    router.get('/export-excel', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'inventory_admin']), async (req, res) => {
    
        console.log('--- INICIANDO PRUEBA FINAL: Forzando un error deliberado. ---');
        
        try {
            // Forzamos un error con un mensaje único y fácil de buscar.
            // Este error no usa la base de datos ni ExcelJS. Es un error puro.
            throw new Error('ESTE_ES_UN_ERROR_DE_PRUEBA_DELIBERADO_12345');
        
        } catch (error) {
            // Este bloque DEBE ejecutarse y registrar el error en Render.
            console.error('--- PRUEBA FINAL CAPTURADA EN EL BACKEND ---:', error);
            
            res.status(500).json({ 
                message: 'Prueba de error deliberado del servidor.', 
                error: error.message 
            });
        }
    });


    // Rutas para crear, actualizar y eliminar
    router.post('/', authMiddleware, authorizeRoles(['super_admin', 'regular_admin']), async (req, res) => {
        try {
            const { name, description, price, stock, imageUrls, category, brand } = req.body;
            const finalImageUrls = Array.isArray(imageUrls) ? imageUrls : [];
            const newProduct = await Product.create({ name, description, price, stock, imageUrls: finalImageUrls, category, brand });
            res.status(201).json(newProduct);
        } catch (error) {
            console.error('Error al crear producto:', error);
            res.status(500).json({ message: 'Error interno del servidor al crear producto.' });
        }
    });

    router.put('/:id', authMiddleware, authorizeRoles(['super_admin', 'regular_admin']), async (req, res) => {
        try {
            const { name, description, price, stock, imageUrls, category, brand } = req.body;
            const finalImageUrls = Array.isArray(imageUrls) ? imageUrls : [];
            const [updatedRows] = await Product.update({ name, description, price, stock, imageUrls: finalImageUrls, category, brand }, { where: { id: req.params.id } });
            if (updatedRows === 0) return res.status(404).json({ message: 'Producto no encontrado.' });
            const updatedProduct = await Product.findByPk(req.params.id);
            res.json(updatedProduct);
        } catch (error) {
            console.error('Error al actualizar producto:', error);
            res.status(500).json({ message: 'Error interno del servidor al actualizar producto.' });
        }
    });

    router.delete('/:id', authMiddleware, authorizeRoles(['super_admin']), async (req, res) => {
        try {
            const deletedRows = await Product.destroy({ where: { id: req.params.id } });
            if (deletedRows === 0) return res.status(404).json({ message: 'Producto no encontrado.' });
            res.status(204).send();
        } catch (error) {
            console.error('Error al eliminar producto:', error);
            res.status(500).json({ message: 'Error interno del servidor al eliminar producto.' });
        }
    });

    return router;
};

module.exports = initProductRoutes;
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const authorizeRoles = require('../middleware/roleMiddleware'); // <-- Importar el nuevo middleware
const { Op } = require('sequelize');

let Product;

const initProductRoutes = (models) => {
    Product = models.Product;

    // Rutas públicas (no requieren autenticación)
    router.get('/', async (req, res) => { // Listar productos (catálogo y búsquedas)
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
                } else {
                    console.warn(`Intento de ordenar por columna inválida: ${sortBy}`);
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

    router.get('/:id', async (req, res) => { // Obtener producto por ID
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

    // Rutas protegidas (requieren autenticación Y rol específico)
    // Solo super_admin y regular_admin pueden crear/actualizar/eliminar productos inicialmente
    // Podemos ajustar los roles según tus necesidades exactas
    router.post('/', authMiddleware, authorizeRoles(['super_admin', 'regular_admin']), async (req, res) => {
        try {
            const { name, description, price, stock, imageUrls, category, brand } = req.body;
            
            if (!Array.isArray(imageUrls) || !imageUrls.every(url => typeof url === 'string')) {
                return res.status(400).json({ message: 'imageUrls debe ser un arreglo de URLs (strings).' });
            }

            const newProduct = await Product.create({
                name, description, price, stock,
                imageUrls: imageUrls || [],
                category, brand
            });
            res.status(201).json(newProduct);
        } catch (error) {
            console.error('Error al crear producto:', error);
            if (error.name === 'SequelizeUniqueConstraintError') {
                return res.status(400).json({ message: 'Ya existe un producto con este nombre.' });
            }
            res.status(500).json({ message: 'Error interno del servidor al crear producto.' });
        }
    });

    router.put('/:id', authMiddleware, authorizeRoles(['super_admin', 'regular_admin']), async (req, res) => {
        try {
            const { name, description, price, stock, imageUrls, category, brand } = req.body;
            
            if (!Array.isArray(imageUrls) || !imageUrls.every(url => typeof url === 'string')) {
                return res.status(400).json({ message: 'imageUrls debe ser un arreglo de URLs (strings).' });
            }

            const [updatedRows] = await Product.update({
                name, description, price, stock,
                imageUrls: imageUrls || [],
                category, brand
            }, {
                where: { id: req.params.id }
            });
            if (updatedRows === 0) {
                return res.status(404).json({ message: 'Producto no encontrado o no se realizaron cambios.' });
            }
            const updatedProduct = await Product.findByPk(req.params.id);
            res.json(updatedProduct);
        } catch (error) {
            console.error('Error al actualizar producto:', error);
            if (error.name === 'SequelizeUniqueConstraintError') {
                return res.status(400).json({ message: 'Ya existe un producto con este nombre.' });
            }
            res.status(500).json({ message: 'Error interno del servidor al actualizar producto.' });
        }
    });

    router.delete('/:id', authMiddleware, authorizeRoles(['super_admin']), async (req, res) => { // Solo super_admin puede eliminar
        try {
            const deletedRows = await Product.destroy({
                where: { id: req.params.id }
            });
            if (deletedRows === 0) {
                return res.status(404).json({ message: 'Producto no encontrado.' });
            }
            res.status(204).send();
        } catch (error) {
            console.error('Error al eliminar producto:', error);
            res.status(500).json({ message: 'Error interno del servidor al eliminar producto.' });
        }
    });

    return router;
};

module.exports = initProductRoutes;
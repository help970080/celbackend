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

    // RUTA MEJORADA Y MÁS ROBUSTA PARA EXPORTAR
    router.get('/export-excel', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'inventory_admin']), async (req, res) => {
        try {
            const productsToExport = await Product.findAll({
                order: [['name', 'ASC']]
            });

            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Reporte de Inventario');

            worksheet.columns = [
                { header: 'ID Producto', key: 'productId', width: 15 },
                { header: 'Nombre', key: 'name', width: 30 },
                { header: 'Descripción', key: 'description', width: 40 },
                { header: 'Precio ($)', key: 'price', width: 15, style: { numFmt: '#,##0.00' } },
                { header: 'Stock Actual', key: 'stock', width: 15 },
                { header: 'Categoría', key: 'category', width: 20 },
                { header: 'Marca', key: 'brand', width: 20 },
                { header: 'Fecha Creación', key: 'createdAt', width: 20, style: { numFmt: 'dd/mm/yyyy hh:mm' } },
                { header: 'Última Actualización', key: 'updatedAt', width: 20, style: { numFmt: 'dd/mm/yyyy hh:mm' } }
            ];

            // Validación de datos para evitar "crash" del servidor
            productsToExport.forEach(product => {
                worksheet.addRow({
                    productId: product.id,
                    name: product.name,
                    description: product.description,
                    price: typeof product.price === 'number' ? product.price : 0.00,
                    stock: typeof product.stock === 'number' ? product.stock : 0,
                    category: product.category,
                    brand: product.brand,
                    createdAt: product.createdAt instanceof Date ? product.createdAt : null,
                    updatedAt: product.updatedAt instanceof Date ? product.updatedAt : null
                });
            });

            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', 'attachment; filename=inventario_productos.xlsx');

            await workbook.xlsx.write(res);
            res.end();

        } catch (error) {
            console.error('CRITICAL ERROR al exportar inventario a Excel (Backend):', error);
            res.status(500).json({ message: 'Error interno del servidor al exportar inventario.', error: error.message });
        }
    });

    // Rutas protegidas
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

    router.delete('/:id', authMiddleware, authorizeRoles(['super_admin']), async (req, res) => {
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
// VERSIÓN FINAL Y ROBUSTA: Previene errores por datos nulos o inesperados.
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const authorizeRoles = require('../middleware/roleMiddleware');
const { Op } = require('sequelize');
const ExcelJS = require('exceljs');

let Product;

const initProductRoutes = (models) => {
    Product = models.Product;

    // Ruta para listar productos con paginación y búsqueda
    router.get('/', async (req, res) => {
        try {
            const { sortBy = 'createdAt', order = 'DESC', category, search, page = 1, limit = 10 } = req.query;
            const options = { where: {}, order: [] };

            if (category) options.where.category = category;
            if (search) {
                options.where[Op.or] = [
                    { name: { [Op.iLike]: `%${search}%` } },
                    { description: { [Op.iLike]: `%${search}%` } },
                    { category: { [Op.iLike]: `%${search}%` } },
                    { brand: { [Op.iLike]: `%${search}%` } }
                ];
            }

            const validSortBy = ['name', 'price', 'createdAt'];
            if (validSortBy.includes(sortBy)) {
                options.order.push([sortBy, order.toUpperCase() === 'DESC' ? 'DESC' : 'ASC']);
            }

            const pageNum = parseInt(page, 10);
            const limitNum = parseInt(limit, 10);
            options.limit = limitNum;
            options.offset = (pageNum - 1) * limitNum;

            const { count, rows } = await Product.findAndCountAll(options);

            res.json({
                totalItems: count,
                totalPages: Math.ceil(count / limitNum),
                currentPage: pageNum,
                products: rows
            });
        } catch (error) {
            console.error('Error al obtener productos:', error);
            res.status(500).json({ message: 'Error interno del servidor al obtener productos.' });
        }
    });

    // Ruta para obtener un producto por su ID
    router.get('/:id', async (req, res) => {
        try {
            const product = await Product.findByPk(req.params.id);
            if (!product) return res.status(404).json({ message: 'Producto no encontrado.' });
            res.json(product);
        } catch (error) {
            console.error('Error al obtener producto por ID:', error);
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    // RUTA PARA EXPORTAR A EXCEL - VERSIÓN FINAL "A PRUEBA DE BALAS"
    router.get('/export-excel', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'inventory_admin']), async (req, res) => {
        try {
            const productsToExport = await Product.findAll({ order: [['name', 'ASC']] });
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Reporte de Inventario');

            worksheet.columns = [
                { header: 'ID Producto', key: 'productId', width: 15 },
                { header: 'Nombre', key: 'name', width: 35 },
                { header: 'Descripción', key: 'description', width: 50 },
                { header: 'Precio ($)', key: 'price', width: 15, style: { numFmt: '"$"#,##0.00' } },
                { header: 'Stock', key: 'stock', width: 15, style: { numFmt: '0' } },
                { header: 'Categoría', key: 'category', width: 25 },
                { header: 'Marca', key: 'brand', width: 25 },
                { header: 'Fecha Creación', key: 'createdAt', width: 22, style: { numFmt: 'dd/mm/yyyy hh:mm AM/PM' } },
                { header: 'Última Actualización', key: 'updatedAt', width: 22, style: { numFmt: 'dd/mm/yyyy hh:mm AM/PM' } }
            ];

            // Bucle de validación para asegurar que datos nulos o incorrectos no rompan la exportación
            productsToExport.forEach(product => {
                worksheet.addRow({
                    productId: product.id,
                    name: product.name || 'Sin Nombre',
                    description: product.description || '',
                    price: typeof product.price === 'number' ? product.price : 0.00,
                    stock: typeof product.stock === 'number' ? product.stock : 0,
                    category: product.category || 'Sin Categoría',
                    brand: product.brand || 'Sin Marca',
                    createdAt: product.createdAt instanceof Date ? product.createdAt : null,
                    updatedAt: product.updatedAt instanceof Date ? product.updatedAt : null
                });
            });

            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', 'attachment; filename=Reporte_Inventario.xlsx');

            await workbook.xlsx.write(res);
            res.end();

        } catch (error) {
            // Este log es la única forma de ver el error real si todo lo demás falla
            console.error('CRITICAL ERROR al exportar inventario a Excel (Backend):', error);
            res.status(500).json({ message: 'Error interno del servidor al generar el reporte Excel.', error: error.message });
        }
    });

    // Rutas para crear, actualizar y eliminar productos
    router.post('/', authMiddleware, authorizeRoles(['super_admin', 'regular_admin']), async (req, res) => {
        try {
            const newProduct = await Product.create(req.body);
            res.status(201).json(newProduct);
        } catch (error) {
            console.error('Error al crear producto:', error);
            res.status(500).json({ message: 'Error al crear producto.' });
        }
    });

    router.put('/:id', authMiddleware, authorizeRoles(['super_admin', 'regular_admin']), async (req, res) => {
        try {
            const [updatedRows] = await Product.update(req.body, { where: { id: req.params.id } });
            if (updatedRows === 0) return res.status(404).json({ message: 'Producto no encontrado.' });
            const updatedProduct = await Product.findByPk(req.params.id);
            res.json(updatedProduct);
        } catch (error) {
            console.error('Error al actualizar producto:', error);
            res.status(500).json({ message: 'Error al actualizar producto.' });
        }
    });

    router.delete('/:id', authMiddleware, authorizeRoles(['super_admin']), async (req, res) => {
        try {
            const deletedRows = await Product.destroy({ where: { id: req.params.id } });
            if (deletedRows === 0) return res.status(404).json({ message: 'Producto no encontrado.' });
            res.status(204).send();
        } catch (error) {
            console.error('Error al eliminar producto:', error);
            res.status(500).json({ message: 'Error al eliminar producto.' });
        }
    });

    return router;
};

module.exports = initProductRoutes;
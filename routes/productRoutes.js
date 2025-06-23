// VERSIÓN COMPLETA Y CORREGIDA
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const authorizeRoles = require('../middleware/roleMiddleware');
const { Op } = require('sequelize');
const ExcelJS = require('exceljs');

let Product;

const initProductRoutes = (models) => {
    Product = models.Product;

    // --- RUTA DE PRUEBA DE VERSIÓN ---
    // Su único propósito es confirmar que el despliegue fue exitoso.
    router.get('/version', (req, res) => {
        res.status(200).json({ 
            version: '2.0.0-final-deployment-test', 
            deployment_date: '2025-06-22' 
        });
    });
    // --- FIN DE LA RUTA DE PRUEBA ---

    // Ruta para listar productos con paginación y búsqueda (PÚBLICA)
    router.get('/', async (req, res) => {
        try {
            const { sortBy = 'createdAt', order = 'DESC', category, search, page = 1, limit = 10 } = req.query;
            const options = { where: {}, order: [] };
            if (category) options.where.category = category;
            if (search) {
                options.where[Op.or] = [
                    { name: { [Op.iLike]: `%${search}%` } },
                    { description: { [Op.iLike]: `%${search}%` } }
                ];
            }
            if (['name', 'price', 'createdAt'].includes(sortBy)) {
                options.order.push([sortBy, order.toUpperCase() === 'DESC' ? 'DESC' : 'ASC']);
            }
            options.limit = parseInt(limit, 10);
            options.offset = (parseInt(page, 10) - 1) * options.limit;
            const { count, rows } = await Product.findAndCountAll(options);
            res.json({
                totalItems: count,
                totalPages: Math.ceil(count / options.limit),
                currentPage: parseInt(page, 10),
                products: rows
            });
        } catch (error) {
            console.error('Error al obtener productos:', error);
            res.status(500).json({ message: 'Error interno del servidor al obtener productos.' });
        }
    });

    // RUTA PARA EXPORTAR A EXCEL - VERSIÓN FINAL ROBUSTA
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
            console.error('CRITICAL ERROR al exportar inventario a Excel (Backend):', error);
            res.status(500).json({ message: 'Error interno del servidor al generar el reporte Excel.', error: error.message });
        }
    });
    
    // --- INICIO DE LAS RUTAS CORREGIDAS Y AGREGADAS ---

    // RUTA PARA CREAR UN NUEVO PRODUCTO (POST)
    router.post('/', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'inventory_admin']), async (req, res) => {
        try {
            const { name, description, price, stock, imageUrls, category, brand } = req.body;
            // Validación básica
            if (!name || !price || !stock) {
                return res.status(400).json({ message: 'Nombre, precio y stock son campos obligatorios.' });
            }
            const newProduct = await Product.create({
                name,
                description,
                price,
                stock,
                imageUrls,
                category,
                brand
            });
            res.status(201).json(newProduct);
        } catch (error) {
            console.error('Error al crear producto:', error);
            res.status(500).json({ message: 'Error interno del servidor al crear el producto.' });
        }
    });

    // RUTA PARA ACTUALIZAR UN PRODUCTO (PUT)
    router.put('/:id', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'inventory_admin']), async (req, res) => {
        try {
            const { id } = req.params;
            const { name, description, price, stock, imageUrls, category, brand } = req.body;
            
            const [updatedRows] = await Product.update({
                name,
                description,
                price,
                stock,
                imageUrls,
                category,
                brand
            }, {
                where: { id: id }
            });

            if (updatedRows === 0) {
                return res.status(404).json({ message: 'Producto no encontrado o no se realizaron cambios.' });
            }
            const updatedProduct = await Product.findByPk(id);
            res.json(updatedProduct);
        } catch (error) {
            console.error('Error al actualizar producto:', error);
            res.status(500).json({ message: 'Error interno del servidor al actualizar el producto.' });
        }
    });

    // RUTA PARA ELIMINAR UN PRODUCTO (DELETE)
    router.delete('/:id', authMiddleware, authorizeRoles(['super_admin']), async (req, res) => {
        try {
            const { id } = req.params;
            const deletedRows = await Product.destroy({
                where: { id: id }
            });
            if (deletedRows === 0) {
                return res.status(404).json({ message: 'Producto no encontrado.' });
            }
            res.status(204).send(); // 204 No Content es la respuesta estándar para un DELETE exitoso
        } catch (error) {
            console.error('Error al eliminar producto:', error);
            res.status(500).json({ message: 'Error interno del servidor al eliminar el producto.' });
        }
    });

    // --- FIN DE LAS RUTAS CORREGIDAS Y AGREGADAS ---

    return router;
};

module.exports = initProductRoutes;
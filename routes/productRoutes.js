const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const authorizeRoles = require('../middleware/roleMiddleware');
const applyStoreFilter = require('../middleware/storeFilterMiddleware');
const { Op } = require('sequelize');
const ExcelJS = require('exceljs');

let Product, AuditLog;

const initProductRoutes = (models) => {
    Product = models.Product;
    AuditLog = models.AuditLog;

    // RUTA DE PRUEBA DE VERSIÓN (PÚBLICA)
    router.get('/version', (req, res) => {
        res.status(200).json({ 
            version: '3.0.0-multitenant', 
            deployment_date: '2025-12-10' 
        });
    });

    // ⭐ RUTA PARA LISTAR PRODUCTOS (PÚBLICA CON FILTRO DE TIENDA)
    router.get('/', async (req, res) => {
        try {
            const { sortBy = 'createdAt', order = 'DESC', category, search, page = 1, limit = 10, tiendaId } = req.query;
            const options = { where: {}, order: [] };
            
            // ⭐ CAMBIO CRÍTICO: Si no se especifica tiendaId, usar tienda 1 por defecto
            const storeFiltro = tiendaId ? parseInt(tiendaId, 10) : 1;
            options.where.tiendaId = storeFiltro;
            
            if (category) options.where.category = category;
            if (search) {
                options.where[Op.or] = [
                    { name: { [Op.like]: `%${search}%` } },
                    { description: { [Op.like]: `%${search}%` } }
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
                products: rows,
                currentStore: storeFiltro // ⭐ NUEVO: Indica qué tienda se está mostrando
            });
        } catch (error) {
            console.error('Error al obtener productos:', error);
            res.status(500).json({ message: 'Error interno del servidor al obtener productos.' });
        }
    });

    // RUTA PARA EXPORTAR A EXCEL (PROTEGIDA)
    router.get('/export-excel', 
        authMiddleware, 
        authorizeRoles(['super_admin', 'regular_admin', 'inventory_admin']),
        applyStoreFilter,
        async (req, res) => {
            try {
                const productsToExport = await Product.findAll({ 
                    where: req.storeFilter,
                    order: [['name', 'ASC']] 
                });
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
                    { header: 'Fecha Creación', key: 'createdAt', width: 22 },
                    { header: 'Última Actualización', key: 'updatedAt', width: 22 }
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
                        createdAt: product.createdAt,
                        updatedAt: product.updatedAt
                    });
                });

                res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                res.setHeader('Content-Disposition', 'attachment; filename=Reporte_Inventario.xlsx');
                await workbook.xlsx.write(res);
                res.end();
            } catch (error) {
                console.error('ERROR al exportar inventario a Excel:', error);
                res.status(500).json({ message: 'Error interno del servidor al generar el reporte Excel.' });
            }
        }
    );
    
    // RUTA PARA CREAR UN NUEVO PRODUCTO (PROTEGIDA)
    router.post('/', 
        authMiddleware, 
        authorizeRoles(['super_admin', 'regular_admin', 'inventory_admin']), 
        async (req, res) => {
            try {
                const { name, description, price, stock, imageUrls, category, brand } = req.body;
                if (!name || !price || stock === undefined) {
                    return res.status(400).json({ message: 'Nombre, precio y stock son campos obligatorios.' });
                }
                
                const productData = {
                    name, 
                    description, 
                    price, 
                    stock, 
                    imageUrls, 
                    category, 
                    brand,
                    tiendaId: req.user.tiendaId
                };
                
                const newProduct = await Product.create(productData);

                try {
                    await AuditLog.create({
                        userId: req.user.userId,
                        username: req.user.username,
                        action: 'CREÓ PRODUCTO',
                        details: `Producto: ${newProduct.name} (ID: ${newProduct.id}), Precio: $${newProduct.price}, Stock: ${newProduct.stock}`,
                        tiendaId: req.user.tiendaId
                    });
                } catch (auditError) { console.error("Error al registrar en auditoría:", auditError); }

                res.status(201).json(newProduct);
            } catch (error) {
                console.error('Error al crear producto:', error);
                res.status(500).json({ message: 'Error interno del servidor al crear el producto.' });
            }
        }
    );

    // RUTA PARA ACTUALIZAR UN PRODUCTO (PROTEGIDA)
    router.put('/:id', 
        authMiddleware, 
        authorizeRoles(['super_admin', 'regular_admin', 'inventory_admin']),
        applyStoreFilter,
        async (req, res) => {
            try {
                const { id } = req.params;
                const { name, description, price, stock, imageUrls, category, brand } = req.body;
                
                const product = await Product.findOne({
                    where: {
                        id: id,
                        ...req.storeFilter
                    }
                });

                if (!product) {
                    return res.status(404).json({ message: 'Producto no encontrado.' });
                }
                
                delete req.body.tiendaId;
                
                await product.update({ name, description, price, stock, imageUrls, category, brand });

                try {
                    await AuditLog.create({
                        userId: req.user.userId,
                        username: req.user.username,
                        action: 'ACTUALIZÓ PRODUCTO',
                        details: `Producto: ${product.name} (ID: ${id})`,
                        tiendaId: req.user.tiendaId
                    });
                } catch (auditError) { console.error("Error al registrar en auditoría:", auditError); }

                res.json(product);
            } catch (error) {
                console.error('Error al actualizar producto:', error);
                res.status(500).json({ message: 'Error interno del servidor al actualizar el producto.' });
            }
        }
    );

    // RUTA PARA ELIMINAR UN PRODUCTO (PROTEGIDA)
    router.delete('/:id', 
        authMiddleware, 
        authorizeRoles(['super_admin']),
        applyStoreFilter,
        async (req, res) => {
            try {
                const { id } = req.params;
                
                const productToDelete = await Product.findOne({
                    where: {
                        id: id,
                        ...req.storeFilter
                    }
                });
                
                if (!productToDelete) {
                    return res.status(404).json({ message: 'Producto no encontrado.' });
                }
                
                const productNameForLog = productToDelete.name;
                await productToDelete.destroy();

                try {
                    await AuditLog.create({
                        userId: req.user.userId,
                        username: req.user.username,
                        action: 'ELIMINÓ PRODUCTO',
                        details: `Producto: ${productNameForLog} (ID: ${id})`,
                        tiendaId: req.user.tiendaId
                    });
                } catch (auditError) { console.error("Error al registrar en auditoría:", auditError); }

                res.status(204).send();
            } catch (error) {
                console.error('Error al eliminar producto:', error);
                res.status(500).json({ message: 'Error interno del servidor al eliminar el producto.' });
            }
        }
    );

    return router;
};

module.exports = initProductRoutes;
const express = require('express');
const router = express.Router();
const { Op, Sequelize } = require('sequelize');
const moment = require('moment-timezone');
const authMiddleware = require('../middleware/authMiddleware');
const authorizeRoles = require('../middleware/roleMiddleware');

let Sale, Client, Product, Payment, SaleItem, User; // Añadir User para validación opcional

const initSalePaymentRoutes = (models) => {
    Sale = models.Sale;
    Client = models.Client;
    Product = models.Product;
    Payment = models.Payment;
    SaleItem = models.SaleItem;
    User = models.User; // Inicializar User

    // Ruta para obtener ventas con paginación y búsqueda
    router.get('/', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
        try {
            const { search, page, limit } = req.query;
            const whereClause = {};
            // Incluimos el modelo User para poder mostrar el gestor asignado
            const includeClause = [
                { model: Client, as: 'client' },
                { model: SaleItem, as: 'saleItems', include: [{ model: Product, as: 'product' }] },
                { model: User, as: 'assignedCollector', attributes: ['id', 'username'] } // <-- Se añade esto
            ];

            if (search) {
                whereClause[Op.or] = [
                    Sequelize.where(Sequelize.cast(Sequelize.col('Sale.id'), 'varchar'), { [Op.like]: `%${search}%` }),
                    { '$client.name$': { [Op.iLike]: `%${search}%` } },
                    { '$client.lastName$': { [Op.iLike]: `%${search}%` } },
                    { '$saleItems.product.name$': { [Op.iLike]: `%${search}%` } }
                ];
            }

            const pageNum = parseInt(page, 10) || 1;
            const limitNum = parseInt(limit, 10) || 10;
            const offset = (pageNum - 1) * limitNum;

            const { count, rows } = await Sale.findAndCountAll({
                where: whereClause,
                include: includeClause,
                order: [['saleDate', 'DESC']],
                limit: limitNum,
                offset: offset,
                distinct: true // Previene duplicados por los joins
            });

            res.json({
                totalItems: count,
                totalPages: Math.ceil(count / limitNum),
                currentPage: pageNum,
                sales: rows
            });
        } catch (error) {
                console.error('Error al obtener ventas con búsqueda/paginación:', error);
                res.status(500).json({ message: 'Error interno del servidor al obtener ventas.' });
        }
    });

    // ... (El resto de tus rutas GET, POST, DELETE, etc. permanecen igual) ...
    router.get('/:id', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => { /* ... tu código ... */ });
    router.post('/', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => { /* ... tu código ... */ });
    router.put('/:id', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => { /* ... tu código ... */ });
    router.delete('/:id', authMiddleware, authorizeRoles(['super_admin']), async (req, res) => { /* ... tu código ... */ });
    router.post('/:saleId/payments', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => { /* ... tu código ... */ });
    router.get('/:saleId/payments', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => { /* ... tu código ... */ });


    // --- INICIO DEL CÓDIGO AÑADIDO ---
    
    // RUTA PARA ASIGNAR UNA VENTA A UN GESTOR DE COBRANZA
    router.put('/:saleId/assign', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
        const { saleId } = req.params;
        const { collectorId } = req.body;

        if (collectorId === undefined) {
            return res.status(400).json({ message: 'Se requiere el ID del gestor de cobranza.' });
        }

        try {
            const sale = await Sale.findByPk(saleId);
            if (!sale) {
                return res.status(404).json({ message: 'Venta no encontrada.' });
            }
            if (!sale.isCredit) {
                return res.status(400).json({ message: 'Solo se pueden asignar ventas que son a crédito.' });
            }
            
            // Opcional pero recomendado: Verificar que el collectorId corresponde a un usuario con el rol correcto
            if (collectorId !== null) {
                const collector = await User.findOne({ where: { id: collectorId, role: 'collector_agent' } });
                if (!collector) {
                    return res.status(404).json({ message: 'Gestor de cobranza no encontrado o con rol incorrecto.' });
                }
            }

            sale.assignedCollectorId = collectorId === null ? null : parseInt(collectorId, 10);
            await sale.save();

            // Devolvemos la venta actualizada incluyendo los datos del gestor asignado
            const updatedSale = await Sale.findByPk(saleId, {
                include: [
                    { model: Client, as: 'client' },
                    { model: SaleItem, as: 'saleItems', include: [{ model: Product, as: 'product' }] },
                    { model: User, as: 'assignedCollector', attributes: ['id', 'username'] }
                ]
            });

            res.json({ message: 'Gestor asignado a la venta con éxito.', sale: updatedSale });

        } catch (error) {
            console.error('Error al asignar gestor a la venta:', error);
            res.status(500).json({ message: 'Error interno del servidor al asignar el gestor.' });
        }
    });

    // --- FIN DEL CÓDIGO AÑADIDO ---


    return router;
};

module.exports = initSalePaymentRoutes;
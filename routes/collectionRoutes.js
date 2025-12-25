// routes/collectionRoutes.js - Rutas de gestión de cobranza

const express = require('express');
const router = express.Router();
const authorizeRoles = require('../middleware/roleMiddleware');
const applyStoreFilter = require('../middleware/storeFilterMiddleware');

module.exports = (models, sequelize) => {
    const { CollectionLog, Sale, User, Client } = models;

    // CREAR NUEVO LOG DE GESTIÓN
    router.post('/', 
        authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'collector_agent']),
        applyStoreFilter,
        async (req, res) => {
            try {
                const { saleId, contactType, contactResult, notes, nextContactDate } = req.body;

                // Verificar que la venta pertenece a la tienda del usuario
                const sale = await Sale.findOne({
                    where: {
                        id: saleId,
                        ...req.storeFilter
                    }
                });

                if (!sale) {
                    return res.status(404).json({ message: 'Venta no encontrada.' });
                }

                // Crear log
                const log = await CollectionLog.create({
                    saleId,
                    collectorId: req.user.userId,
                    contactType,
                    contactResult,
                    notes,
                    nextContactDate: nextContactDate || null
                });

                // Cargar con datos del usuario
                const logWithUser = await CollectionLog.findByPk(log.id, {
                    include: [{
                        model: User,
                        as: 'collector',
                        attributes: ['id', 'username', 'name']
                    }]
                });

                res.status(201).json(logWithUser);
            } catch (error) {
                console.error('Error al crear log de gestión:', error);
                res.status(500).json({ message: 'Error al crear log de gestión.' });
            }
        }
    );

    // OBTENER LOGS DE UNA VENTA
    router.get('/sale/:saleId',
        authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'collector_agent']),
        applyStoreFilter,
        async (req, res) => {
            try {
                const { saleId } = req.params;

                // Verificar que la venta pertenece a la tienda
                const sale = await Sale.findOne({
                    where: {
                        id: saleId,
                        ...req.storeFilter
                    }
                });

                if (!sale) {
                    return res.status(404).json({ message: 'Venta no encontrada.' });
                }

                // Obtener logs
                const logs = await CollectionLog.findAll({
                    where: { saleId },
                    include: [{
                        model: User,
                        as: 'collector',
                        attributes: ['id', 'username', 'name']
                    }],
                    order: [['createdAt', 'DESC']]
                });

                res.json(logs);
            } catch (error) {
                console.error('Error al obtener logs:', error);
                res.status(500).json({ message: 'Error al obtener logs.' });
            }
        }
    );

    // OBTENER LOGS DE UN CLIENTE (todas sus ventas)
    router.get('/client/:clientId',
        authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'collector_agent']),
        applyStoreFilter,
        async (req, res) => {
            try {
                const { clientId } = req.params;

                // Verificar que el cliente pertenece a la tienda
                const client = await Client.findOne({
                    where: {
                        id: clientId,
                        ...req.storeFilter
                    }
                });

                if (!client) {
                    return res.status(404).json({ message: 'Cliente no encontrado.' });
                }

                // Obtener todas las ventas del cliente
                const sales = await Sale.findAll({
                    where: {
                        clientId,
                        ...req.storeFilter
                    },
                    attributes: ['id']
                });

                const saleIds = sales.map(s => s.id);

                // Obtener logs de todas esas ventas
                const logs = await CollectionLog.findAll({
                    where: { saleId: saleIds },
                    include: [
                        {
                            model: User,
                            as: 'collector',
                            attributes: ['id', 'username', 'name']
                        },
                        {
                            model: Sale,
                            as: 'sale',
                            attributes: ['id', 'saleDate', 'totalAmount', 'balanceDue']
                        }
                    ],
                    order: [['createdAt', 'DESC']]
                });

                res.json(logs);
            } catch (error) {
                console.error('Error al obtener logs del cliente:', error);
                res.status(500).json({ message: 'Error al obtener logs.' });
            }
        }
    );

    return router;
};
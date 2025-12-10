const express = require('express');
const router = express.Router();
const authorizeRoles = require('../middleware/roleMiddleware');
const applyStoreFilter = require('../middleware/storeFilterMiddleware'); // NUEVO
const { Op } = require('sequelize');

let Client, Sale, Payment, AuditLog;

const initClientRoutes = (models) => {
    Client = models.Client;
    Sale = models.Sale;
    Payment = models.Payment;
    AuditLog = models.AuditLog;

    // LISTAR CLIENTES - Ahora con filtro automático por tienda
    router.get('/', 
        authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']),
        applyStoreFilter, // NUEVO: Aplica filtro por tienda
        async (req, res) => {
            try {
                const { search, page, limit } = req.query;
                
                // Combinar filtro de tienda con otros filtros
                const whereClause = { ...req.storeFilter }; // NUEVO: Incluye tiendaId
                
                if (search) {
                    whereClause[Op.or] = [
                        { name: { [Op.iLike]: `%${search}%` } },
                        { lastName: { [Op.iLike]: `%${search}%` } },
                        { phone: { [Op.iLike]: `%${search}%` } },
                    ];
                }
                
                const pageNum = parseInt(page, 10) || 1;
                const limitNum = parseInt(limit, 10) || 10;
                const offset = (pageNum - 1) * limitNum;
                
                const { count, rows } = await Client.findAndCountAll({
                    where: whereClause,
                    order: [['name', 'ASC']],
                    limit: limitNum,
                    offset: offset
                });
                
                res.json({ 
                    totalItems: count, 
                    totalPages: Math.ceil(count / limitNum), 
                    currentPage: pageNum, 
                    clients: rows 
                });
            } catch (error) {
                console.error("Error en GET /api/clients:", error);
                res.status(500).json({ message: 'Error interno del servidor.' });
            }
        }
    );

    // OBTENER UN CLIENTE - Con validación de tienda
    router.get('/:id', 
        authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'collector_agent']),
        applyStoreFilter,
        async (req, res) => {
            const { id } = req.params;
            if (isNaN(parseInt(id, 10))) {
                return res.status(400).json({ message: 'El ID del cliente debe ser un número válido.' });
            }
            
            try {
                const client = await Client.findOne({
                    where: {
                        id: id,
                        ...req.storeFilter // NUEVO: Solo encuentra si es de la tienda correcta
                    }
                });
                
                if (!client) {
                    return res.status(404).json({ message: 'Cliente no encontrado.' });
                }
                
                res.json(client);
            } catch (error) {
                console.error("Error al obtener cliente:", error);
                res.status(500).json({ message: 'Error interno del servidor.' });
            }
        }
    );

    // CREAR CLIENTE - Con tiendaId automático
    router.post('/', 
        authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']),
        async (req, res) => {
            try {
                // Agregar automáticamente el tiendaId del usuario
                const clientData = {
                    ...req.body,
                    tiendaId: req.user.tiendaId // NUEVO: Asigna la tienda del usuario
                };
                
                const newClient = await Client.create(clientData);

                try {
                    await AuditLog.create({
                        userId: req.user.userId,
                        username: req.user.username,
                        action: 'CREÓ CLIENTE',
                        details: `Cliente: ${newClient.name} ${newClient.lastName} (ID: ${newClient.id})`,
                        tiendaId: req.user.tiendaId // NUEVO
                    });
                } catch (auditError) {
                    console.error("Error al registrar en auditoría:", auditError);
                }

                res.status(201).json(newClient);
            } catch (error) {
                if (error.name === 'SequelizeUniqueConstraintError') {
                    return res.status(400).json({ 
                        message: 'Ya existe un cliente con este teléfono en esta tienda.' 
                    });
                }
                console.error("Error al crear cliente:", error);
                res.status(500).json({ message: 'Error interno del servidor.' });
            }
        }
    );

    // ACTUALIZAR CLIENTE - Con validación de tienda
    router.put('/:id', 
        authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']),
        applyStoreFilter,
        async (req, res) => {
            const { id } = req.params;
            if (isNaN(parseInt(id, 10))) {
                return res.status(400).json({ message: 'El ID del cliente debe ser un número válido.' });
            }
            
            try {
                const client = await Client.findOne({
                    where: {
                        id: id,
                        ...req.storeFilter // NUEVO: Solo actualiza si es de la tienda correcta
                    }
                });
                
                if (!client) {
                    return res.status(404).json({ message: 'Cliente no encontrado.' });
                }
                
                // NO permitir cambiar tiendaId
                delete req.body.tiendaId;
                
                await client.update(req.body);

                try {
                    await AuditLog.create({
                        userId: req.user.userId,
                        username: req.user.username,
                        action: 'ACTUALIZÓ CLIENTE',
                        details: `Cliente: ${client.name} ${client.lastName} (ID: ${client.id})`,
                        tiendaId: req.user.tiendaId
                    });
                } catch (auditError) {
                    console.error("Error al registrar en auditoría:", auditError);
                }

                res.json(client);
            } catch (error) {
                if (error.name === 'SequelizeUniqueConstraintError') {
                    return res.status(409).json({ 
                        message: 'El teléfono o email ya está en uso por otro cliente en esta tienda.' 
                    });
                }
                console.error("Error al actualizar cliente:", error);
                res.status(500).json({ message: 'Error interno del servidor.' });
            }
        }
    );

    // ELIMINAR CLIENTE - Con validación de tienda
    router.delete('/:id', 
        authorizeRoles(['super_admin']),
        applyStoreFilter,
        async (req, res) => {
            const { id } = req.params;
            if (isNaN(parseInt(id, 10))) {
                return res.status(400).json({ message: 'El ID del cliente debe ser un número válido.' });
            }
            
            try {
                const client = await Client.findOne({
                    where: {
                        id: id,
                        ...req.storeFilter
                    }
                });
                
                if (!client) {
                    return res.status(404).json({ message: 'Cliente no encontrado.' });
                }
                
                const clientNameForLog = `${client.name} ${client.lastName}`;
                await client.destroy();

                try {
                    await AuditLog.create({
                        userId: req.user.userId,
                        username: req.user.username,
                        action: 'ELIMINÓ CLIENTE',
                        details: `Cliente: ${clientNameForLog} (ID: ${id})`,
                        tiendaId: req.user.tiendaId
                    });
                } catch (auditError) {
                    console.error("Error al registrar en auditoría:", auditError);
                }

                res.status(204).send();
            } catch (error) {
                console.error("Error al eliminar cliente:", error);
                res.status(500).json({ message: 'Error interno del servidor.' });
            }
        }
    );

    return router;
};

module.exports = initClientRoutes;
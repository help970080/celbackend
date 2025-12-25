// routes/clientRoutes.js - VERSIÓN CON GESTIÓN DE RIESGO

const express = require('express');
const router = express.Router();
const authorizeRoles = require('../middleware/roleMiddleware');
const applyStoreFilter = require('../middleware/storeFilterMiddleware');
const { Op } = require('sequelize');

let Client, Sale, Payment, AuditLog, sequelize;

const initClientRoutes = (models) => {
    Client = models.Client;
    Sale = models.Sale;
    Payment = models.Payment;
    AuditLog = models.AuditLog;
    sequelize = models.sequelize;

    // ⭐ NUEVA FUNCIÓN: Calcular riesgo de un cliente
    const calculateClientRisk = async (clientId) => {
        try {
            const activeSales = await Sale.findAll({
                where: {
                    clientId: clientId,
                    isCredit: true,
                    balanceDue: { [Op.gt]: 0 }
                },
                include: [{
                    model: Payment,
                    as: 'payments',
                    required: false
                }]
            });

            if (!activeSales || activeSales.length === 0) {
                return null; // Sin deuda
            }

            let totalBalance = 0;
            let maxDaysOverdue = 0;

            activeSales.forEach(sale => {
                totalBalance += parseFloat(sale.balanceDue) || 0;

                // Calcular días de atraso
                const paymentsMade = sale.payments?.length || 0;
                const totalPayments = sale.numberOfPayments || 0;
                const expectedPayments = Math.floor(
                    (new Date() - new Date(sale.saleDate)) / (7 * 24 * 60 * 60 * 1000)
                );

                const paymentsMissed = Math.max(0, expectedPayments - paymentsMade);
                const daysOverdue = paymentsMissed * 7;

                if (daysOverdue > maxDaysOverdue) {
                    maxDaysOverdue = daysOverdue;
                }
            });

            // Determinar categoría de riesgo
            let riskCategory = 'LOW';
            if (maxDaysOverdue > 14 || totalBalance > 2000) {
                riskCategory = 'HIGH';
            } else if (maxDaysOverdue > 7 || totalBalance > 1000) {
                riskCategory = 'MEDIUM';
            }

            return {
                riskCategory,
                totalBalance: parseFloat(totalBalance.toFixed(2)),
                daysOverdue: maxDaysOverdue,
                activeSalesCount: activeSales.length
            };
        } catch (error) {
            console.error(`Error calculando riesgo del cliente ${clientId}:`, error);
            return null;
        }
    };

    // LISTAR CLIENTES - CON DATOS DE RIESGO
    router.get('/', 
        authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']),
        applyStoreFilter,
        async (req, res) => {
            try {
                const { search, page, limit, sortBy, sortOrder, riskLevel } = req.query;
                
                const whereClause = { ...req.storeFilter };
                
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
                
                // ⭐ NUEVO: Obtener clientes con sus ventas a crédito
                const { count, rows: clients } = await Client.findAndCountAll({
                    where: whereClause,
                    include: [{
                        model: Sale,
                        as: 'sales',
                        where: {
                            isCredit: true,
                            balanceDue: { [Op.gt]: 0 }
                        },
                        required: false, // LEFT JOIN para incluir clientes sin deuda
                        include: [{
                            model: Payment,
                            as: 'payments',
                            required: false
                        }]
                    }],
                    limit: limitNum,
                    offset: offset,
                    distinct: true // Importante para count correcto con includes
                });

                // ⭐ NUEVO: Calcular riesgo para cada cliente
                const clientsWithRisk = await Promise.all(
                    clients.map(async (client) => {
                        const riskData = await calculateClientRisk(client.id);
                        return {
                            ...client.toJSON(),
                            riskData
                        };
                    })
                );

                // ⭐ NUEVO: Filtrar por nivel de riesgo si se especificó
                let filteredClients = clientsWithRisk;
                if (riskLevel && riskLevel !== 'all') {
                    const riskMap = {
                        'high': 'HIGH',
                        'medium': 'MEDIUM',
                        'low': 'LOW'
                    };
                    const targetRisk = riskMap[riskLevel.toLowerCase()];
                    
                    filteredClients = clientsWithRisk.filter(client => {
                        if (!client.riskData) return riskLevel === 'low'; // Sin deuda = bajo riesgo
                        return client.riskData.riskCategory === targetRisk;
                    });
                }

                // ⭐ NUEVO: Ordenar según sortBy
                if (sortBy) {
                    filteredClients.sort((a, b) => {
                        let compareValue = 0;
                        
                        switch (sortBy) {
                            case 'risk':
                                const riskOrder = { 'HIGH': 3, 'MEDIUM': 2, 'LOW': 1, null: 0 };
                                const aRisk = riskOrder[a.riskData?.riskCategory || null];
                                const bRisk = riskOrder[b.riskData?.riskCategory || null];
                                compareValue = bRisk - aRisk; // DESC por defecto para riesgo
                                break;
                            
                            case 'balance':
                                const aBalance = a.riskData?.totalBalance || 0;
                                const bBalance = b.riskData?.totalBalance || 0;
                                compareValue = bBalance - aBalance; // DESC por defecto para balance
                                break;
                            
                            case 'name':
                            default:
                                const aName = `${a.name} ${a.lastName}`.toLowerCase();
                                const bName = `${b.name} ${b.lastName}`.toLowerCase();
                                compareValue = aName.localeCompare(bName);
                                break;
                        }
                        
                        return sortOrder === 'asc' ? compareValue : -compareValue;
                    });
                }
                
                // Recalcular paginación después del filtrado
                const totalFiltered = filteredClients.length;
                const totalPagesFiltered = Math.ceil(totalFiltered / limitNum);
                
                res.json({ 
                    totalItems: totalFiltered, 
                    totalPages: totalPagesFiltered, 
                    currentPage: pageNum, 
                    clients: filteredClients
                });
            } catch (error) {
                console.error("Error en GET /api/clients:", error);
                console.error("Stack trace:", error.stack);
                res.status(500).json({ 
                    message: 'Error interno del servidor.',
                    error: error.message 
                });
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
                        ...req.storeFilter
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
                const clientData = {
                    ...req.body,
                    tiendaId: req.user.tiendaId
                };
                
                const newClient = await Client.create(clientData);

                try {
                    await AuditLog.create({
                        userId: req.user.userId,
                        username: req.user.username,
                        action: 'CREÓ CLIENTE',
                        details: `Cliente: ${newClient.name} ${newClient.lastName} (ID: ${newClient.id})`,
                        tiendaId: req.user.tiendaId
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
                        ...req.storeFilter
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
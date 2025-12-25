// routes/userRoutes.js - VERSIÓN CORREGIDA CON MULTI-TENANT Y PERMISOS AMPLIADOS

const express = require('express');
const router = express.Router();
const authorizeRoles = require('../middleware/roleMiddleware');
const applyStoreFilter = require('../middleware/storeFilterMiddleware');

let User, AuditLog, Store;

const initUserRoutes = (models) => {
    User = models.User;
    AuditLog = models.AuditLog;
    Store = models.Store;

    // ⭐ RUTA GET /: Obtiene usuarios (PERMISOS AMPLIADOS)
    router.get('/', 
        authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), // ⭐ CAMBIO CRÍTICO
        applyStoreFilter,
        async (req, res) => {
            try {
                const whereClause = { ...req.storeFilter };
                
                // ⭐ NUEVO: Si se solicita filtrar por rol (ej: solo collectors)
                if (req.query.role) {
                    whereClause.role = req.query.role;
                }

                const users = await User.findAll({ 
                    where: whereClause,
                    attributes: { exclude: ['password'] },
                    include: [{
                        model: Store,
                        as: 'store',
                        attributes: ['id', 'name']
                    }],
                    order: [['username', 'ASC']]
                });
                
                res.json(users);
            } catch (error) {
                console.error('Error al obtener usuarios:', error);
                res.status(500).json({ message: 'Error interno del servidor.' });
            }
        }
    );

    // RUTA POST /: Crea un nuevo usuario (SOLO SUPER_ADMIN)
    router.post('/', 
        authorizeRoles(['super_admin']), 
        async (req, res) => {
            const { username, password, role, tiendaId } = req.body;
            
            if (!username || !password || !role) {
                return res.status(400).json({ message: 'Username, password y role son obligatorios.' });
            }

            // ⭐ VALIDAR ROLES PERMITIDOS
            const allowedRoles = [
                'super_admin', 
                'regular_admin', 
                'sales_admin', 
                'inventory_admin', 
                'viewer_reports', 
                'collector_agent'
            ];

            if (!allowedRoles.includes(role)) {
                return res.status(400).json({ 
                    message: `Rol inválido. Roles permitidos: ${allowedRoles.join(', ')}` 
                });
            }

            try {
                const userData = {
                    username,
                    password,
                    role,
                    tiendaId: tiendaId || req.user.tiendaId
                };

                // Verificar que la tienda existe
                if (userData.tiendaId) {
                    const storeExists = await Store.findByPk(userData.tiendaId);
                    if (!storeExists) {
                        return res.status(400).json({ message: 'La tienda especificada no existe.' });
                    }
                }
                
                const newUser = await User.create(userData);
                
                try {
                    await AuditLog.create({
                        userId: req.user.userId,
                        username: req.user.username,
                        action: 'CREÓ USUARIO',
                        details: `Nuevo usuario: '${newUser.username}' (ID: ${newUser.id}) con rol: '${newUser.role}' en tienda: ${newUser.tiendaId}`,
                        tiendaId: req.user.tiendaId
                    });
                } catch (auditError) { 
                    console.error("Error al registrar en auditoría:", auditError); 
                }

                const userResponse = { 
                    id: newUser.id, 
                    username: newUser.username, 
                    role: newUser.role,
                    tiendaId: newUser.tiendaId
                };
                
                res.status(201).json(userResponse);
            } catch (error) {
                if (error.name === 'SequelizeUniqueConstraintError') {
                    return res.status(409).json({ message: 'El nombre de usuario ya existe.' });
                }
                console.error('Error al crear usuario:', error);
                res.status(500).json({ message: 'Error interno del servidor.' });
            }
        }
    );

    // RUTA PUT /:id: Actualiza un usuario (SOLO SUPER_ADMIN)
    router.put('/:id', 
        authorizeRoles(['super_admin']),
        applyStoreFilter,
        async (req, res) => {
            const { username, password, role, tiendaId } = req.body;
            
            try {
                const userToUpdate = await User.findOne({
                    where: {
                        id: req.params.id,
                        ...req.storeFilter
                    }
                });
                
                if (!userToUpdate) {
                    return res.status(404).json({ message: 'Usuario no encontrado o no pertenece a tu tienda.' });
                }

                const oldRole = userToUpdate.role;
                const oldTiendaId = userToUpdate.tiendaId;
                const changes = [];

                if (username && username !== userToUpdate.username) {
                    userToUpdate.username = username;
                    changes.push(`Username cambiado a '${username}'`);
                }
                
                if (role && role !== oldRole) {
                    userToUpdate.role = role;
                    changes.push(`Rol cambiado de '${oldRole}' a '${role}'`);
                }
                
                if (tiendaId && tiendaId !== oldTiendaId) {
                    // Verificar que la tienda existe
                    const storeExists = await Store.findByPk(tiendaId);
                    if (!storeExists) {
                        return res.status(400).json({ message: 'La tienda especificada no existe.' });
                    }
                    userToUpdate.tiendaId = tiendaId;
                    changes.push(`Tienda cambiada de ${oldTiendaId} a ${tiendaId}`);
                }
                
                if (password) {
                    userToUpdate.password = password;
                    changes.push('Contraseña actualizada');
                }

                if (changes.length > 0) {
                    await userToUpdate.save();
                    
                    try {
                        await AuditLog.create({
                            userId: req.user.userId,
                            username: req.user.username,
                            action: 'ACTUALIZÓ USUARIO',
                            details: `Usuario: '${userToUpdate.username}' (ID: ${userToUpdate.id}). Cambios: ${changes.join(', ')}.`,
                            tiendaId: req.user.tiendaId
                        });
                    } catch (auditError) { 
                        console.error("Error al registrar en auditoría:", auditError); 
                    }
                }

                const userResponse = { 
                    id: userToUpdate.id, 
                    username: userToUpdate.username, 
                    role: userToUpdate.role,
                    tiendaId: userToUpdate.tiendaId
                };
                
                res.json(userResponse);
            } catch (error) {
                console.error("Error al actualizar usuario:", error);
                res.status(500).json({ message: 'Error interno del servidor.' });
            }
        }
    );

    // RUTA DELETE /:id: Elimina un usuario (SOLO SUPER_ADMIN)
    router.delete('/:id', 
        authorizeRoles(['super_admin']),
        applyStoreFilter,
        async (req, res) => {
            try {
                const userToDelete = await User.findOne({
                    where: {
                        id: req.params.id,
                        ...req.storeFilter
                    }
                });
                
                if (!userToDelete) {
                    return res.status(404).json({ message: 'Usuario no encontrado o no pertenece a tu tienda.' });
                }
                
                // Prevenir auto-eliminación
                if (req.user.userId === parseInt(req.params.id, 10)) {
                    return res.status(403).json({ message: 'No puedes eliminar tu propia cuenta.' });
                }

                const deletedUsername = userToDelete.username;
                const deletedUserId = userToDelete.id;
                
                await userToDelete.destroy();

                try {
                    await AuditLog.create({
                        userId: req.user.userId,
                        username: req.user.username,
                        action: 'ELIMINÓ USUARIO',
                        details: `Usuario: '${deletedUsername}' (ID: ${deletedUserId})`,
                        tiendaId: req.user.tiendaId
                    });
                } catch (auditError) { 
                    console.error("Error al registrar en auditoría:", auditError); 
                }

                res.status(204).send();
            } catch (error) {
                console.error('Error al eliminar usuario:', error);
                res.status(500).json({ message: 'Error interno del servidor.' });
            }
        }
    );

    return router;
};

module.exports = initUserRoutes;
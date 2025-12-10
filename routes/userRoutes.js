const express = require('express');
const router = express.Router();
const authorizeRoles = require('../middleware/roleMiddleware');
const applyStoreFilter = require('../middleware/storeFilterMiddleware'); // ⭐ NUEVO

let User, AuditLog;

const initUserRoutes = (models) => {
    User = models.User;
    AuditLog = models.AuditLog;

    // RUTA GET /: Obtiene todos los usuarios
    router.get('/', 
        authorizeRoles(['super_admin']),
        applyStoreFilter, // ⭐ NUEVO
        async (req, res) => {
            try {
                const users = await User.findAll({ 
                    where: req.storeFilter, // ⭐ NUEVO: Filtrar por tienda
                    attributes: { exclude: ['password'] },
                    include: [{
                        model: models.Store,
                        as: 'store',
                        attributes: ['id', 'name']
                    }]
                });
                res.json(users);
            } catch (error) {
                console.error('Error al obtener usuarios:', error);
                res.status(500).json({ message: 'Error interno del servidor.' });
            }
        }
    );

    // RUTA POST /: Crea un nuevo usuario
    router.post('/', 
        authorizeRoles(['super_admin']), 
        async (req, res) => {
            const { username, password, role, tiendaId } = req.body;
            if (!username || !password || !role) {
                return res.status(400).json({ message: 'Todos los campos son obligatorios.' });
            }
            try {
                // ⭐ NUEVO: Si no se especifica tiendaId, usar la del usuario actual
                const userData = {
                    username,
                    password,
                    role,
                    tiendaId: tiendaId || req.user.tiendaId
                };
                
                const newUser = await User.create(userData);
                
                try {
                    await AuditLog.create({
                        userId: req.user.userId,
                        username: req.user.username,
                        action: 'CREÓ USUARIO',
                        details: `Nuevo usuario: '${newUser.username}' (ID: ${newUser.id}) con rol: '${newUser.role}' en tienda: ${newUser.tiendaId}`,
                        tiendaId: req.user.tiendaId // ⭐ NUEVO
                    });
                } catch (auditError) { console.error("Error al registrar en auditoría:", auditError); }

                const userResponse = { 
                    id: newUser.id, 
                    username: newUser.username, 
                    role: newUser.role,
                    tiendaId: newUser.tiendaId // ⭐ NUEVO
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

    // RUTA PUT /:id : Actualiza un usuario
    router.put('/:id', 
        authorizeRoles(['super_admin']),
        applyStoreFilter, // ⭐ NUEVO
        async (req, res) => {
            const { username, password, role, tiendaId } = req.body;
            try {
                // ⭐ NUEVO: Buscar usuario solo en tiendas permitidas
                const userToUpdate = await User.findOne({
                    where: {
                        id: req.params.id,
                        ...req.storeFilter
                    }
                });
                
                if (!userToUpdate) {
                    return res.status(404).json({ message: 'Usuario no encontrado.' });
                }

                const oldRole = userToUpdate.role;
                const oldTiendaId = userToUpdate.tiendaId;
                const changes = [];

                userToUpdate.username = username || userToUpdate.username;
                
                if (role && role !== oldRole) {
                    userToUpdate.role = role;
                    changes.push(`Rol cambiado de '${oldRole}' a '${role}'`);
                }
                
                // ⭐ NUEVO: Permitir cambiar tienda (solo super_admin)
                if (tiendaId && tiendaId !== oldTiendaId) {
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
                            tiendaId: req.user.tiendaId // ⭐ NUEVO
                        });
                    } catch (auditError) { console.error("Error al registrar en auditoría:", auditError); }
                }

                const userResponse = { 
                    id: userToUpdate.id, 
                    username: userToUpdate.username, 
                    role: userToUpdate.role,
                    tiendaId: userToUpdate.tiendaId // ⭐ NUEVO
                };
                res.json(userResponse);
            } catch (error) {
                console.error("Error al actualizar usuario:", error);
                res.status(500).json({ message: 'Error interno del servidor.' });
            }
        }
    );

    // RUTA DELETE /:id : Elimina un usuario
    router.delete('/:id', 
        authorizeRoles(['super_admin']),
        applyStoreFilter, // ⭐ NUEVO
        async (req, res) => {
            try {
                // ⭐ NUEVO: Buscar usuario solo en tiendas permitidas
                const userToDelete = await User.findOne({
                    where: {
                        id: req.params.id,
                        ...req.storeFilter
                    }
                });
                
                if (!userToDelete) {
                    return res.status(404).json({ message: 'Usuario no encontrado.' });
                }
                
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
                        tiendaId: req.user.tiendaId // ⭐ NUEVO
                    });
                } catch (auditError) { console.error("Error al registrar en auditoría:", auditError); }

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
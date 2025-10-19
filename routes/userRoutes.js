const express = require('express');
const router = express.Router();
const authorizeRoles = require('../middleware/roleMiddleware');
const bcrypt = require('bcryptjs');

let User, AuditLog;

const initUserRoutes = (models) => {
    User = models.User;
    AuditLog = models.AuditLog;

    // 🔧 CORRECCIÓN: Permitimos que regular_admin y sales_admin también puedan ver usuarios
    // Esto es necesario para que puedan ver la lista de gestores al crear ventas
    router.get('/', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
        try {
            const users = await User.findAll({ attributes: { exclude: ['password'] } });
            res.json(users);
        } catch (error) {
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    // RUTA POST /: Crea un nuevo usuario (SOLO super_admin puede crear usuarios)
    router.post('/', authorizeRoles(['super_admin']), async (req, res) => {
        const { username, password, role } = req.body;
        if (!username || !password || !role) {
            return res.status(400).json({ message: 'Todos los campos son obligatorios.' });
        }
        try {
            const newUser = await User.create({ username, password, role });
            
            try {
                await AuditLog.create({
                    userId: req.user.userId,
                    username: req.user.username,
                    action: 'CREÓ USUARIO',
                    details: `Nuevo usuario: '${newUser.username}' (ID: ${newUser.id}) con rol: '${newUser.role}'`
                });
            } catch (auditError) { console.error("Error al registrar en auditoría:", auditError); }

            const userResponse = { id: newUser.id, username: newUser.username, role: newUser.role };
            res.status(201).json(userResponse);
        } catch (error) {
            if (error.name === 'SequelizeUniqueConstraintError') {
                return res.status(409).json({ message: 'El nombre de usuario ya existe.' });
            }
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    // RUTA PUT /:id : Actualiza un usuario (SOLO super_admin)
    router.put('/:id', authorizeRoles(['super_admin']), async (req, res) => {
        const { username, password, role } = req.body;
        try {
            const userToUpdate = await User.findByPk(req.params.id);
            if (!userToUpdate) {
                return res.status(404).json({ message: 'Usuario no encontrado.' });
            }

            const oldRole = userToUpdate.role;
            const changes = [];

            userToUpdate.username = username || userToUpdate.username;
            if(role && role !== oldRole) {
                userToUpdate.role = role;
                changes.push(`Rol cambiado de '${oldRole}' a '${role}'`);
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
                        details: `Usuario: '${userToUpdate.username}' (ID: ${userToUpdate.id}). Cambios: ${changes.join(', ')}.`
                    });
                } catch (auditError) { console.error("Error al registrar en auditoría:", auditError); }
            }

            const userResponse = { id: userToUpdate.id, username: userToUpdate.username, role: userToUpdate.role };
            res.json(userResponse);
        } catch (error) {
            console.error("Error al actualizar usuario:", error)
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    // RUTA DELETE /:id : Elimina un usuario (SOLO super_admin)
    router.delete('/:id', authorizeRoles(['super_admin']), async (req, res) => {
        try {
            const userToDelete = await User.findByPk(req.params.id);
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
                    details: `Usuario: '${deletedUsername}' (ID: ${deletedUserId})`
                });
            } catch (auditError) { console.error("Error al registrar en auditoría:", auditError); }

            res.status(204).send();
        } catch (error) {
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    return router;
};

module.exports = initUserRoutes;
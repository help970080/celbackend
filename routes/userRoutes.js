const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const authorizeRoles = require('../middleware/roleMiddleware'); // <-- Importar el middleware de roles
const bcrypt = require('bcryptjs'); // Necesario para hashear contraseñas si se actualizan

let User;

const initUserRoutes = (models) => {
    User = models.User;

    // Ruta para obtener todos los usuarios (Solo Super Admin)
    router.get('/', authMiddleware, authorizeRoles(['super_admin']), async (req, res) => {
        try {
            // No incluir la contraseña en la respuesta por seguridad
            const users = await User.findAll({ attributes: ['id', 'username', 'role', 'createdAt', 'updatedAt'] });
            res.json(users);
        } catch (error) {
            console.error('Error al obtener usuarios:', error);
            res.status(500).json({ message: 'Error interno del servidor al obtener usuarios.' });
        }
    });

    // Ruta para crear un nuevo usuario (Solo Super Admin)
    router.post('/', authMiddleware, authorizeRoles(['super_admin']), async (req, res) => {
        const { username, password, role } = req.body;
        try {
            if (!username || !password || !role) {
                return res.status(400).json({ message: 'Nombre de usuario, contraseña y rol son obligatorios.' });
            }
            // Validar que el rol sea uno permitido si tienes una lista fija de roles
            // if (!['super_admin', 'regular_admin', 'sales_admin', 'inventory_admin'].includes(role)) {
            //     return res.status(400).json({ message: 'Rol no válido.' });
            // }

            // La contraseña se hashea automáticamente por el hook beforeCreate en el modelo User
            const newUser = await User.create({ username, password, role });
            // Devolver el usuario sin la contraseña
            res.status(201).json({ id: newUser.id, username: newUser.username, role: newUser.role, createdAt: newUser.createdAt });
        } catch (error) {
            console.error('Error al crear usuario:', error);
            if (error.name === 'SequelizeUniqueConstraintError') {
                return res.status(409).json({ message: 'El nombre de usuario ya existe.' });
            }
            res.status(500).json({ message: 'Error interno del servidor al crear usuario.' });
        }
    });

    // Ruta para actualizar un usuario (Solo Super Admin)
    router.put('/:id', authMiddleware, authorizeRoles(['super_admin']), async (req, res) => {
        const { username, password, role } = req.body;
        const { id } = req.params;
        try {
            const user = await User.findByPk(id);
            if (!user) {
                return res.status(404).json({ message: 'Usuario no encontrado.' });
            }

            user.username = username || user.username;
            user.role = role || user.role;

            // Si se proporciona una nueva contraseña, hashearla
            if (password) {
                const salt = await bcrypt.genSalt(10);
                user.password = await bcrypt.hash(password, salt); // La contraseña ya se hashea en el hook beforeUpdate del modelo, pero lo dejamos explícito aquí para claridad si no se usa ese hook.
            }

            // Validar que el rol sea uno permitido si tienes una lista fija
            // if (role && !['super_admin', 'regular_admin', 'sales_admin', 'inventory_admin'].includes(role)) {
            //     return res.status(400).json({ message: 'Rol no válido.' });
            // }

            await user.save();
            // Devolver el usuario actualizado sin la contraseña
            res.json({ id: user.id, username: user.username, role: user.role, updatedAt: user.updatedAt });
        } catch (error) {
            console.error('Error al actualizar usuario:', error);
            if (error.name === 'SequelizeUniqueConstraintError') {
                return res.status(409).json({ message: 'El nombre de usuario ya existe.' });
            }
            res.status(500).json({ message: 'Error interno del servidor al actualizar usuario.' });
        }
    });

    // Ruta para eliminar un usuario (Solo Super Admin)
    router.delete('/:id', authMiddleware, authorizeRoles(['super_admin']), async (req, res) => {
        const { id } = req.params;
        try {
            // No permitir que un super_admin se elimine a sí mismo si es el único super_admin
            // Esto es una medida de seguridad importante
            const userToDelete = await User.findByPk(id);
            if (!userToDelete) {
                return res.status(404).json({ message: 'Usuario no encontrado.' });
            }

            // Si el usuario intentando eliminar es un super_admin y es el único super_admin
            // o si el usuario que intenta eliminar es el mismo que está siendo eliminado,
            // se debe manejar con precaución.
            // Por simplicidad, no permitir que un super_admin se auto-elimine si es el último.
            if (userToDelete.role === 'super_admin') {
                const superAdminsCount = await User.count({ where: { role: 'super_admin' } });
                if (superAdminsCount === 1 && req.user.userId === parseInt(id)) {
                    return res.status(403).json({ message: 'No puedes eliminar el único super administrador.' });
                }
            }
             if (req.user.userId === parseInt(id)) {
                 return res.status(403).json({ message: 'No puedes eliminar tu propia cuenta a través de esta interfaz.' });
             }


            const deletedRows = await User.destroy({
                where: { id: id }
            });
            if (deletedRows === 0) {
                return res.status(404).json({ message: 'Usuario no encontrado.' });
            }
            res.status(204).send();
        } catch (error) {
            console.error('Error al eliminar usuario:', error);
            res.status(500).json({ message: 'Error interno del servidor al eliminar usuario.' });
        }
    });

    return router;
};

module.exports = initUserRoutes;
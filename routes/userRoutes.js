const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const authorizeRoles = require('../middleware/roleMiddleware');
const bcrypt = require('bcryptjs');

let User;

const initUserRoutes = (models) => {
    User = models.User;

    // Ruta para obtener todos los usuarios (Solo Super Admin)
    router.get('/', authorizeRoles(['super_admin']), async (req, res) => {
        try {
            const users = await User.findAll({ attributes: { exclude: ['password'] } });
            res.json(users);
        } catch (error) {
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    // --- RUTA AÑADIDA GRACIAS A TU ANÁLISIS ---
    // Ruta para obtener un solo usuario por ID (Solo Super Admin)
    router.get('/:id', authorizeRoles(['super_admin']), async (req, res) => {
        try {
            const user = await User.findByPk(req.params.id, {
                attributes: { exclude: ['password'] }
            });
            if (!user) {
                return res.status(404).json({ message: 'Usuario no encontrado.' });
            }
            res.json(user);
        } catch (error) {
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });
    // --- FIN DE LA RUTA AÑADIDA ---

    // Ruta para crear un nuevo usuario (Solo Super Admin)
    router.post('/', authorizeRoles(['super_admin']), async (req, res) => {
        const { username, password, role } = req.body;
        if (!username || !password || !role) {
            return res.status(400).json({ message: 'Nombre de usuario, contraseña y rol son obligatorios.' });
        }
        try {
            const hashedPassword = await bcrypt.hash(password, 10);
            const newUser = await User.create({ username, password: hashedPassword, role });
            const userResponse = { id: newUser.id, username: newUser.username, role: newUser.role };
            res.status(201).json(userResponse);
        } catch (error) {
            if (error.name === 'SequelizeUniqueConstraintError') {
                return res.status(409).json({ message: 'El nombre de usuario ya existe.' });
            }
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    // Ruta para actualizar un usuario (Solo Super Admin)
    router.put('/:id', authorizeRoles(['super_admin']), async (req, res) => {
        const { username, password, role } = req.body;
        try {
            const user = await User.findByPk(req.params.id);
            if (!user) {
                return res.status(404).json({ message: 'Usuario no encontrado.' });
            }
            if (user.role === 'super_admin' && req.user.userId !== user.id) {
                 // Opcional: Prevenir que un super_admin edite a otro
                 // return res.status(403).json({ message: 'No se puede editar a otro super administrador.' });
            }
            user.username = username || user.username;
            user.role = role || user.role;
            if (password) {
                user.password = password; // El hook se encargará de hashear
            }
            await user.save();
            const userResponse = { id: user.id, username: user.username, role: user.role };
            res.json(userResponse);
        } catch (error) {
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    // Ruta para eliminar un usuario (Solo Super Admin)
    router.delete('/:id', authorizeRoles(['super_admin']), async (req, res) => {
        try {
            const userToDelete = await User.findByPk(req.params.id);
            if (!userToDelete) return res.status(404).json({ message: 'Usuario no encontrado.' });
            if (req.user.userId === parseInt(req.params.id)) return res.status(403).json({ message: 'No puedes eliminar tu propia cuenta.' });
            
            await userToDelete.destroy();
            res.status(204).send();
        } catch (error) {
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    return router;
};

module.exports = initUserRoutes;
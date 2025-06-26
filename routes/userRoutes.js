const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const authorizeRoles = require('../middleware/roleMiddleware');
const bcrypt = require('bcryptjs'); // Se importa bcrypt para usarlo explícitamente

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

    // RUTA PARA CREAR UN NUEVO USUARIO (VERSIÓN FINAL Y CORREGIDA)
    router.post('/', authorizeRoles(['super_admin']), async (req, res) => {
        const { username, password, role } = req.body;
        if (!username || !password || !role) {
            return res.status(400).json({ message: 'Nombre de usuario, contraseña y rol son obligatorios.' });
        }

        try {
            // Se encripta la contraseña manualmente ANTES de crear el usuario.
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(password, salt);

            const newUser = await User.create({
                username,
                password: hashedPassword, // Se guarda la contraseña ya encriptada
                role
            });

            // No se devuelve la contraseña en la respuesta.
            const userResponse = { id: newUser.id, username: newUser.username, role: newUser.role };
            res.status(201).json(userResponse);
        } catch (error) {
            if (error.name === 'SequelizeUniqueConstraintError') {
                return res.status(409).json({ message: 'El nombre de usuario ya existe.' });
            }
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    // Ruta para actualizar un usuario
    router.put('/:id', authorizeRoles(['super_admin']), async (req, res) => {
        const { username, password, role } = req.body;
        try {
            const user = await User.findByPk(req.params.id);
            if (!user) {
                return res.status(404).json({ message: 'Usuario no encontrado.' });
            }
            user.username = username || user.username;
            user.role = role || user.role;
            if (password) {
                user.password = password; // El hook del modelo se encarga de hashear en la actualización
            }
            await user.save();
            const userResponse = { id: user.id, username: user.username, role: user.role };
            res.json(userResponse);
        } catch (error) {
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    // Ruta para eliminar un usuario
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
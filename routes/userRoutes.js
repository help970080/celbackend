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
            console.error("Error al obtener usuarios:", error);
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
            // --- INICIO DE LA CORRECCIÓN DE SEGURIDAD ---
            // Encriptamos la contraseña manualmente ANTES de crear el usuario.
            // Esta es la lógica que faltaba y que ahora es explícita.
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(password, salt);
            // --- FIN DE LA CORRECCIÓN DE SEGURIDAD ---

            const newUser = await User.create({
                username,
                password: hashedPassword, // Se guarda la contraseña ya encriptada
                role
            });

            // No devolvemos la contraseña en la respuesta
            const userResponse = { id: newUser.id, username: newUser.username, role: newUser.role };
            res.status(201).json(userResponse);
        } catch (error) {
            if (error.name === 'SequelizeUniqueConstraintError') {
                return res.status(409).json({ message: 'El nombre de usuario ya existe.' });
            }
            console.error("Error al crear usuario:", error);
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    // Ruta para eliminar un usuario (sin cambios)
    router.delete('/:id', authorizeRoles(['super_admin']), async (req, res) => {
        try {
            const userToDelete = await User.findByPk(req.params.id);
            if (!userToDelete) {
                return res.status(404).json({ message: 'Usuario no encontrado.' });
            }
            if (req.user.userId === parseInt(req.params.id)) {
                return res.status(403).json({ message: 'No puedes eliminar tu propia cuenta.' });
            }
            await userToDelete.destroy();
            res.status(200).json({ message: 'Usuario eliminado con éxito.' });
        } catch (error) {
            console.error("Error al eliminar usuario:", error);
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });
    
    // Aquí puedes añadir tu ruta PUT para actualizar, si la tienes.

    return router;
};

module.exports = initUserRoutes;
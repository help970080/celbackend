const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs'); // Importamos bcrypt aquí
const authorizeRoles = require('../middleware/roleMiddleware');

let User;

const initUserRoutes = (models) => {
    User = models.User;

    // RUTA GET /: Obtiene la lista de usuarios
    router.get('/', authorizeRoles(['super_admin', 'regular_admin']), async (req, res) => {
        try {
            const users = await User.findAll({ attributes: ['id', 'username', 'role', 'createdAt'] });
            res.json(users);
        } catch (error) {
            console.error("Error al obtener usuarios:", error);
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    // RUTA POST /: Crea un nuevo usuario (VERSIÓN FINAL Y CORREGIDA)
    router.post('/', authorizeRoles('super_admin'), async (req, res) => {
        const { username, password, role } = req.body;
        if (!username || !password || !role) {
            return res.status(400).json({ message: 'Nombre de usuario, contraseña y rol son obligatorios.' });
        }

        try {
            // --- INICIO DE LA CORRECCIÓN DE SEGURIDAD ---
            // Encriptamos la contraseña manualmente antes de crear el usuario
            // para garantizar que siempre se guarde de forma segura.
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(password, salt);
            // --- FIN DE LA CORRECCIÓN DE SEGURIDAD ---

            const newUser = await User.create({
                username,
                password: hashedPassword, // Guardamos la contraseña ya encriptada
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

    // RUTA DELETE /:id : Elimina un usuario
    router.delete('/:id', authorizeRoles('super_admin'), async (req, res) => {
        try {
            const user = await User.findByPk(req.params.id);
            if (!user) {
                return res.status(404).json({ message: 'Usuario no encontrado.' });
            }
            // Evitar que un super_admin se elimine a sí mismo
            if (user.id === req.user.userId) {
                return res.status(403).json({ message: 'No puedes eliminar tu propia cuenta de super administrador.' });
            }
            await user.destroy();
            res.status(200).json({ message: 'Usuario eliminado con éxito.' });
        } catch (error) {
            console.error("Error al eliminar usuario:", error);
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    return router;
};

module.exports = initUserRoutes;
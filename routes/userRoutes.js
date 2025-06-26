const express = require('express');
const router = express.Router();
const authorizeRoles = require('../middleware/roleMiddleware');
const bcrypt = require('bcryptjs');

let User;

const initUserRoutes = (models) => {
    User = models.User;

    // RUTA GET /: Obtiene todos los usuarios
    router.get('/', authorizeRoles(['super_admin']), async (req, res) => {
        try {
            const users = await User.findAll({ attributes: { exclude: ['password'] } });
            res.json(users);
        } catch (error) {
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    // RUTA POST /: Crea un nuevo usuario (CON ENCRIPTACIÓN CORREGIDA)
    router.post('/', authorizeRoles(['super_admin']), async (req, res) => {
        const { username, password, role } = req.body;
        if (!username || !password || !role) {
            return res.status(400).json({ message: 'Todos los campos son obligatorios.' });
        }
        try {
            const hashedPassword = await bcrypt.hash(password, 10);
            const newUser = await User.create({
                username,
                password: hashedPassword,
                role
            });
            const userResponse = { id: newUser.id, username: newUser.username, role: newUser.role };
            res.status(201).json(userResponse);
        } catch (error) {
            if (error.name === 'SequelizeUniqueConstraintError') {
                return res.status(409).json({ message: 'El nombre de usuario ya existe.' });
            }
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    // RUTA PUT /:id : Actualiza un usuario (CON LÓGICA DE ACTUALIZACIÓN CORREGIDA)
    router.put('/:id', authorizeRoles(['super_admin']), async (req, res) => {
        const { username, password, role } = req.body;
        try {
            const userToUpdate = await User.findByPk(req.params.id);
            if (!userToUpdate) {
                return res.status(404).json({ message: 'Usuario no encontrado.' });
            }

            userToUpdate.username = username || userToUpdate.username;
            userToUpdate.role = role || userToUpdate.role;
            
            // Solo actualiza la contraseña si se proporciona una nueva
            if (password) {
                userToUpdate.password = password; // El hook del modelo se encargará de encriptarla
            }

            await userToUpdate.save();
            const userResponse = { id: userToUpdate.id, username: userToUpdate.username, role: userToUpdate.role };
            res.json(userResponse);
        } catch (error) {
            console.error("Error al actualizar usuario:", error)
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    // RUTA DELETE /:id : Elimina un usuario
    router.delete('/:id', authorizeRoles(['super_admin']), async (req, res) => {
        try {
            const userToDelete = await User.findByPk(req.params.id);
            if (!userToDelete) {
                return res.status(404).json({ message: 'Usuario no encontrado.' });
            }
            if (req.user.userId === parseInt(req.params.id, 10)) {
                 return res.status(403).json({ message: 'No puedes eliminar tu propia cuenta.' });
            }
            await userToDelete.destroy();
            res.status(204).send(); // 204 No Content es la respuesta estándar para un DELETE exitoso
        } catch (error) {
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    return router;
};

module.exports = initUserRoutes;
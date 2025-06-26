const express = require('express');
const router = express.Router();
const authorizeRoles = require('../middleware/roleMiddleware');
const bcrypt = require('bcryptjs');

let User;

const initUserRoutes = (models) => {
    User = models.User;

    router.get('/', authorizeRoles(['super_admin']), async (req, res) => {
        try {
            const users = await User.findAll({ attributes: { exclude: ['password'] } });
            res.json(users);
        } catch (error) {
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

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
    
    // El resto de las rutas (DELETE, PUT) no necesitan cambios.
    
    return router;
};

module.exports = initUserRoutes;
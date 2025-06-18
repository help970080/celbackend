const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

let User;

const JWT_SECRET = process.env.JWT_SECRET;

const initAuthRoutes = (models, isRegistrationAllowedExternally) => { 
    User = models.User;

    router.post('/register', async (req, res) => {
        // Si el registro no está permitido (porque ya hay administradores), denegar
        if (!isRegistrationAllowedExternally) {
            console.warn('Intento de registro de administrador cuando ya hay uno existente.');
            return res.status(403).json({ message: 'El registro de nuevos administradores está deshabilitado.' });
        }

        console.log('DEBUG (Register): req.body recibido:', req.body);
        const { username, password } = req.body;
        try {
            if (!username || !password) {
                return res.status(400).json({ message: 'Nombre de usuario y contraseña son obligatorios.' });
            }

            // Antes de crear el usuario, verificar si es el primer usuario que se registra
            const existingUserCount = await User.count();
            const roleToAssign = (existingUserCount === 0) ? 'super_admin' : 'regular_admin'; // Asignar 'super_admin' al primero

            const newUser = await User.create({ username, password, role: roleToAssign });
            res.status(201).json({ message: 'Usuario registrado exitosamente.', userId: newUser.id, username: newUser.username, role: newUser.role });
        } catch (error) {
            console.error('ERROR (Register): Error al registrar usuario:', error);
            if (error.name === 'SequelizeUniqueConstraintError') {
                return res.status(409).json({ message: 'El nombre de usuario ya existe.' });
            }
            if (error.name === 'SequelizeValidationError') {
                return res.status(400).json({ message: error.errors[0].message });
            }
            res.status(500).json({ message: 'Error interno del servidor al registrar usuario.' });
        }
    });

    router.post('/login', async (req, res) => {
        console.log('DEBUG (Login): req.body recibido:', req.body);
        const { username, password } = req.body;
        try {
            if (!username || !password) {
                return res.status(400).json({ message: 'Nombre de usuario y contraseña son obligatorios.' });
            }
            const user = await User.findOne({ where: { username } });
            if (!user) {
                return res.status(401).json({ message: 'Credenciales inválidas.' });
            }
            const isMatch = await user.comparePassword(password);
            if (!isMatch) {
                return res.status(401).json({ message: 'Credenciales inválidas.' });
            }
            const token = jwt.sign(
                { userId: user.id, username: user.username, role: user.role }, // <-- ¡Añadir el rol al token!
                JWT_SECRET,
                { expiresIn: '1h' }
            );
            res.json({ message: 'Login exitoso.', token, username: user.username, role: user.role }); // <-- ¡Devolver el rol en el login!
        } catch (error) {
            console.error('ERROR (Login): Error al iniciar sesión:', error);
            res.status(500).json({ message: 'Error interno del servidor al iniciar sesión.' });
        }
    });

    return router;
};

module.exports = initAuthRoutes;
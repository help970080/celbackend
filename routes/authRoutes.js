// routes/authRoutes.js (Versión Final)
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

let User;
const JWT_SECRET = process.env.JWT_SECRET;

const initAuthRoutes = (models, isRegistrationAllowed) => { 
    User = models.User;

    router.get('/is-registration-allowed', (req, res) => {
        res.json({ isRegistrationAllowed: isRegistrationAllowed });
    });

    router.post('/register', async (req, res) => {
        if (!isRegistrationAllowed) {
            return res.status(403).json({ message: 'El registro de nuevos administradores está deshabilitado.' });
        }
        const { username, password } = req.body;
        try {
            const existingUserCount = await User.count();
            const roleToAssign = (existingUserCount === 0) ? 'super_admin' : 'regular_admin';
            const newUser = await User.create({ username, password, role: roleToAssign });
            res.status(201).json({ message: 'Usuario registrado.', userId: newUser.id });
        } catch (error) {
            res.status(500).json({ message: 'Error al registrar usuario.' });
        }
    });

    router.post('/login', async (req, res) => {
        const { username, password } = req.body;
        try {
            const user = await User.findOne({ where: { username } });
            if (!user) return res.status(401).json({ message: 'Credenciales inválidas.' });
            
            const isMatch = await user.comparePassword(password);
            if (!isMatch) return res.status(401).json({ message: 'Credenciales inválidas.' });
            
            const token = jwt.sign({ userId: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '1h' });
            res.json({ message: 'Login exitoso.', token, username: user.username, role: user.role });
        } catch (error) {
            res.status(500).json({ message: 'Error al iniciar sesión.' });
        }
    });

    return router;
};

module.exports = initAuthRoutes;
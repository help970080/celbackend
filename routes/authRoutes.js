// routes/authRoutes.js (Versión Multi-Tenant - Compatible con frontend existente)
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

let User, Store;
const JWT_SECRET = process.env.JWT_SECRET;

const initAuthRoutes = (models, isRegistrationAllowed) => { 
    User = models.User;
    Store = models.Store;

    router.get('/is-registration-allowed', (req, res) => {
        res.json({ isRegistrationAllowed: isRegistrationAllowed });
    });

    router.post('/register', async (req, res) => {
        if (!isRegistrationAllowed) {
            return res.status(403).json({ message: 'El registro de nuevos administradores está deshabilitado.' });
        }
        
        const { username, password } = req.body;
        
        // ⭐ CAMBIO: Si no se envía tiendaId, usar tienda 1 por defecto (compatibilidad con frontend)
        const tiendaId = req.body.tiendaId || 1;
        
        try {
            const existingUserCount = await User.count();
            const roleToAssign = (existingUserCount === 0) ? 'super_admin' : 'regular_admin';
            
            const newUser = await User.create({ 
                username, 
                password, 
                role: roleToAssign,
                tiendaId: parseInt(tiendaId, 10)
            });
            
            res.status(201).json({ 
                message: 'Usuario registrado.', 
                userId: newUser.id 
            });
        } catch (error) {
            console.error('Error al registrar usuario:', error);
            res.status(500).json({ message: 'Error al registrar usuario.' });
        }
    });

    router.post('/login', async (req, res) => {
        const { username, password } = req.body;
        try {
            const user = await User.findOne({ 
                where: { username },
                include: [{ 
                    model: Store, 
                    as: 'store',
                    attributes: ['id', 'name', 'isActive']
                }]
            });
            
            if (!user) {
                return res.status(401).json({ message: 'Credenciales inválidas.' });
            }
            
            // Verificar que la tienda esté activa
            if (!user.store || !user.store.isActive) {
                return res.status(403).json({ message: 'La tienda asociada no está activa.' });
            }
            
            const isMatch = await user.comparePassword(password);
            if (!isMatch) {
                return res.status(401).json({ message: 'Credenciales inválidas.' });
            }
            
            // ⭐ NUEVO: Incluir tiendaId en el token JWT
            const token = jwt.sign(
                { 
                    userId: user.id, 
                    username: user.username, 
                    role: user.role,
                    tiendaId: user.tiendaId
                }, 
                JWT_SECRET, 
                { expiresIn: '1h' }
            );
            
            res.json({ 
                message: 'Login exitoso.', 
                token, 
                username: user.username, 
                role: user.role,
                tiendaId: user.tiendaId,
                storeName: user.store.name
            });
        } catch (error) {
            console.error('Error al iniciar sesión:', error);
            res.status(500).json({ message: 'Error al iniciar sesión.' });
        }
    });

    return router;
};

module.exports = initAuthRoutes;
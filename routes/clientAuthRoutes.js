const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');

let Client;
const JWT_SECRET = process.env.JWT_SECRET;

const initClientAuthRoutes = (models) => { 
    Client = models.Client;

    router.post('/login', async (req, res) => {
        const { phone, password } = req.body;
        if (!phone || !password) {
            return res.status(400).json({ message: 'Teléfono y contraseña son obligatorios.' });
        }
        try {
            const client = await Client.findOne({ where: { phone } });
            if (!client || !client.password) {
                return res.status(401).json({ message: 'Credenciales inválidas o portal no activado.' });
            }
            
            const isMatch = await client.comparePassword(password);
            if (!isMatch) {
                return res.status(401).json({ message: 'Credenciales inválidas.' });
            }
            
            // Creamos un token específico para el cliente
            const token = jwt.sign({ 
                clientId: client.id, 
                name: client.name,
                role: 'client' // Rol específico para diferenciar de los admins
            }, JWT_SECRET, { expiresIn: '1h' });
            
            res.json({ message: 'Login de cliente exitoso.', token, name: client.name });
        } catch (error) {
            res.status(500).json({ message: 'Error al iniciar sesión.' });
        }
    });

    return router;
};

module.exports = initClientAuthRoutes;
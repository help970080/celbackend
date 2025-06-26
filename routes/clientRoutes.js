const express = require('express');
const router = express.Router();
const authorizeRoles = require('../middleware/roleMiddleware');
const { Op } = require('sequelize');

let Client;

const initClientRoutes = (models) => {
    Client = models.Client;
    
    router.get('/:id', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'collector_agent']), async (req, res) => {
        try {
            const client = await Client.findByPk(req.params.id);
            if (!client) return res.status(404).json({ message: 'Cliente no encontrado.' });
            res.json(client);
        } catch (error) {
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });
    
    // El resto de las rutas GET all, POST, etc. no necesitan cambios
    
    return router;
};

module.exports = initClientRoutes;
const express = require('express');
const router = express.Router();
const authorizeRoles = require('../middleware/roleMiddleware');

let Store, AuditLog;

const initStoreRoutes = (models) => {
    Store = models.Store;
    AuditLog = models.AuditLog;

    // LISTAR TODAS LAS TIENDAS (solo super_admin)
    router.get('/', authorizeRoles(['super_admin']), async (req, res) => {
        try {
            const stores = await Store.findAll({
                order: [['name', 'ASC']]
            });
            res.json(stores);
        } catch (error) {
            console.error('Error al obtener tiendas:', error);
            res.status(500).json({ message: 'Error al obtener tiendas.' });
        }
    });

    // OBTENER UNA TIENDA POR ID
    router.get('/:id', authorizeRoles(['super_admin']), async (req, res) => {
        try {
            const store = await Store.findByPk(req.params.id);
            if (!store) {
                return res.status(404).json({ message: 'Tienda no encontrada.' });
            }
            res.json(store);
        } catch (error) {
            console.error('Error al obtener tienda:', error);
            res.status(500).json({ message: 'Error al obtener tienda.' });
        }
    });

    // CREAR NUEVA TIENDA (solo super_admin)
    router.post('/', authorizeRoles(['super_admin']), async (req, res) => {
        const { name, address, phone, email } = req.body;
        
        if (!name) {
            return res.status(400).json({ message: 'El nombre de la tienda es obligatorio.' });
        }

        try {
            const newStore = await Store.create({ name, address, phone, email });

            // Registrar en auditoría
            try {
                await AuditLog.create({
                    userId: req.user.userId,
                    username: req.user.username,
                    action: 'CREÓ TIENDA',
                    details: `Tienda: ${newStore.name} (ID: ${newStore.id})`,
                    tiendaId: req.user.tiendaId // Tienda del admin que creó
                });
            } catch (auditError) {
                console.error("Error al registrar en auditoría:", auditError);
            }

            res.status(201).json(newStore);
        } catch (error) {
            console.error('Error al crear tienda:', error);
            res.status(500).json({ message: 'Error al crear tienda.' });
        }
    });

    // ACTUALIZAR TIENDA (solo super_admin)
    router.put('/:id', authorizeRoles(['super_admin']), async (req, res) => {
        const { name, address, phone, email, isActive } = req.body;

        try {
            const store = await Store.findByPk(req.params.id);
            if (!store) {
                return res.status(404).json({ message: 'Tienda no encontrada.' });
            }

            await store.update({ name, address, phone, email, isActive });

            // Registrar en auditoría
            try {
                await AuditLog.create({
                    userId: req.user.userId,
                    username: req.user.username,
                    action: 'ACTUALIZÓ TIENDA',
                    details: `Tienda: ${store.name} (ID: ${store.id})`,
                    tiendaId: req.user.tiendaId
                });
            } catch (auditError) {
                console.error("Error al registrar en auditoría:", auditError);
            }

            res.json(store);
        } catch (error) {
            console.error('Error al actualizar tienda:', error);
            res.status(500).json({ message: 'Error al actualizar tienda.' });
        }
    });

    // DESACTIVAR TIENDA (no eliminar, solo desactivar)
    router.delete('/:id', authorizeRoles(['super_admin']), async (req, res) => {
        try {
            const store = await Store.findByPk(req.params.id);
            if (!store) {
                return res.status(404).json({ message: 'Tienda no encontrada.' });
            }

            // No eliminamos, solo desactivamos
            await store.update({ isActive: false });

            // Registrar en auditoría
            try {
                await AuditLog.create({
                    userId: req.user.userId,
                    username: req.user.username,
                    action: 'DESACTIVÓ TIENDA',
                    details: `Tienda: ${store.name} (ID: ${store.id})`,
                    tiendaId: req.user.tiendaId
                });
            } catch (auditError) {
                console.error("Error al registrar en auditoría:", auditError);
            }

            res.json({ message: 'Tienda desactivada correctamente.', store });
        } catch (error) {
            console.error('Error al desactivar tienda:', error);
            res.status(500).json({ message: 'Error al desactivar tienda.' });
        }
    });

    return router;
};

module.exports = initStoreRoutes;
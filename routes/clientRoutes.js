const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const authorizeRoles = require('../middleware/roleMiddleware');
const { Op, Sequelize } = require('sequelize');
const ExcelJS = require('exceljs');
const moment = require('moment-timezone');

let Client, Sale, SaleItem, Product, Payment;

const TIMEZONE = "America/Mexico_City";

const initClientRoutes = (models) => {
    Client = models.Client;
    Sale = models.Sale;
    SaleItem = models.SaleItem;
    Product = models.Product;
    Payment = models.Payment;

    router.get('/', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
        try {
            const { search, page, limit } = req.query;
            const whereClause = {};

            if (search) {
                whereClause[Op.or] = [
                    { name: { [Op.like]: `%${search}%` } },
                    { lastName: { [Op.like]: `%${search}%` } },
                    { phone: { [Op.like]: `%${search}%` } },
                    { email: { [Op.like]: `%${search}%` } },
                    { address: { [Op.like]: `%${search}%` } },
                    { identificationId: { [Op.like]: `%${search}%` } }
                ];
            }

            const pageNum = parseInt(page, 10) || 1;
            const limitNum = parseInt(limit, 10) || 10;
            const offset = (pageNum - 1) * limitNum;

            const { count, rows } = await Client.findAndCountAll({
                where: whereClause,
                order: [['name', 'ASC']],
                limit: limitNum,
                offset: offset
            });

            res.json({
                totalItems: count,
                totalPages: Math.ceil(count / limitNum),
                currentPage: pageNum,
                clients: rows
            });
        } catch (error) {
            console.error('Error al obtener clientes con búsqueda/paginación:', error);
            res.status(500).json({ message: 'Error interno del servidor al obtener clientes.' });
        }
    });

    router.get('/export-excel', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
        // ... (código de exportación a Excel, no necesita cambios)
    });

    // RUTA GET /:id - Obtener un cliente específico
    // --- SE AÑADE 'collector_agent' A LA LISTA DE ROLES PERMITIDOS ---
    router.get('/:id', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'collector_agent']), async (req, res) => {
        try {
            const client = await Client.findByPk(req.params.id);
            if (!client) {
                return res.status(404).json({ message: 'Cliente no encontrado.' });
            }
            res.json(client);
        } catch (error) {
            console.error('Error al obtener cliente por ID:', error);
            res.status(500).json({ message: 'Error interno del servidor al obtener cliente.' });
        }
    });

    router.post('/', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
        try {
            const { name, lastName, phone, email, address, city, state, zipCode, identificationId, notes } = req.body;
            const newClient = await Client.create({
                name,
                lastName,
                phone,
                email: email === '' ? null : email,
                address,
                city,
                state,
                zipCode,
                identificationId: identificationId === '' ? null : identificationId,
                notes: notes === '' ? null : notes,
            });
            res.status(201).json(newClient);
        } catch (error) {
            console.error('Error al crear cliente:', error);
            if (error.name === 'SequelizeUniqueConstraintError') {
                return res.status(400).json({ message: 'Ya existe un cliente con este email o teléfono.' });
            }
            res.status(500).json({ message: 'Error interno del servidor al crear cliente.' });
        }
    });

    router.put('/:id', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
        // ... (código para actualizar cliente, no necesita cambios)
    });

    router.delete('/:id', authMiddleware, authorizeRoles(['super_admin']), async (req, res) => {
        // ... (código para eliminar cliente, no necesita cambios)
    });

    return router;
};

module.exports = initClientRoutes;
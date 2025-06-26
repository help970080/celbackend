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

    // Ruta para obtener todos los clientes
    router.get('/', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
        try {
            const { search, page, limit } = req.query;
            const whereClause = {};

            if (search) {
                whereClause[Op.or] = [
                    { name: { [Op.like]: `%${search}%` } },
                    { lastName: { [Op.like]: `%${search}%` } },
                    { phone: { [Op.like]: `%${search}%` } }
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
            res.status(500).json({ message: 'Error interno del servidor al obtener clientes.' });
        }
    });

    // Ruta para obtener un cliente específico por ID
    // --- SE AÑADE 'collector_agent' A LOS PERMISOS ---
    router.get('/:id', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'collector_agent']), async (req, res) => {
        try {
            const client = await Client.findByPk(req.params.id);
            if (!client) {
                return res.status(404).json({ message: 'Cliente no encontrado.' });
            }
            res.json(client);
        } catch (error) {
            res.status(500).json({ message: 'Error interno del servidor al obtener cliente.' });
        }
    });

    // Ruta para crear un nuevo cliente
    router.post('/', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
        try {
            const newClient = await Client.create(req.body);
            res.status(201).json(newClient);
        } catch (error) {
            if (error.name === 'SequelizeUniqueConstraintError') {
                return res.status(400).json({ message: 'Ya existe un cliente con este email o teléfono.' });
            }
            res.status(500).json({ message: 'Error interno del servidor al crear cliente.' });
        }
    });

    // El resto de tus rutas (PUT, DELETE, etc.) no necesitan cambios y pueden permanecer como las tienes.

    return router;
};

module.exports = initClientRoutes;
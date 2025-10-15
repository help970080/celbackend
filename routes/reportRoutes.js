// Archivo: routes/reportRoutes.js

const express = require('express');
const router = express.Router();
const { Op, Sequelize } = require('sequelize');
const moment = require('moment-timezone');
const authorizeRoles = require('../middleware/roleMiddleware');

let Sale, Client, Product, Payment, SaleItem, User;
const TIMEZONE = "America/Mexico_City";

// --- Función helper para calcular la próxima fecha de vencimiento dinámicamente (YA EXISTE EN TU ARCHIVO ORIGINAL) ---
const getNextDueDate = (lastPaymentDate, frequency) => {
    const baseDate = moment(lastPaymentDate).tz(TIMEZONE);
    switch (frequency) {
        case 'daily':
...
                totalOverdueAmount: parseFloat(totalOverdueAmount.toFixed(2)),
                totalAdvanceAmount: parseFloat(totalAdvanceAmount.toFixed(2)),
                details: []
            });

        } catch (error) {
            console.error('Error en /projected-vs-real-income:', error);
            res.status(500).json({ message: 'Error interno del servidor al obtener el reporte de ingresos proyectados.' });
        }
    });

    return router;
};

module.exports = initReportRoutes;

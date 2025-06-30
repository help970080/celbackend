// Archivo: routes/salePaymentRoutes.js (Versión con Consulta Corregida)

const express = require('express');
const router = express.Router();
// ... (resto de las importaciones sin cambios)

// ...

const initSalePaymentRoutes = (models, sequelize) => {
    // ... (asignación de modelos sin cambios)

    router.get('/', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']), async (req, res) => {
        try {
            // ... (lógica de paginación y búsqueda sin cambios)

            // --- INICIO DE LA MODIFICACIÓN ---
            // Se añade el modelo Payment a la consulta para evitar errores en el frontend.
            const sales = await Sale.findAll({
                where: { id: { [Op.in]: saleIds } },
                include: [
                    { model: Client, as: 'client' },
                    { model: SaleItem, as: 'saleItems', include: [{ model: Product, as: 'product' }] },
                    { model: Payment, as: 'payments' }, // <-- ESTA LÍNEA ES LA CORRECCIÓN CLAVE
                    { model: User, as: 'assignedCollector', attributes: ['id', 'username'] }
                ],
                order: [['saleDate', 'DESC']],
            });
            // --- FIN DE LA MODIFICACIÓN ---

            res.json({
                totalItems: count,
                totalPages: Math.ceil(count / limitNum),
                currentPage: pageNum,
                sales: sales
            });
        } catch (error) {
            console.error('Error al obtener ventas:', error);
            res.status(500).json({ message: 'Error interno del servidor al obtener ventas.' });
        }
    });

    // El resto de las rutas (POST, PUT, DELETE, etc.) permanecen igual que en la versión anterior.
    // ...
    
    return router;
};

module.exports = initSalePaymentRoutes;
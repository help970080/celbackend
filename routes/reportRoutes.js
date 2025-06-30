// Archivo: routes/reportRoutes.js (Versión con Corrección para "Cliente: N/A")

const express = require('express');
const router = express.Router();
// ... (resto de las importaciones sin cambios)

// ...

const initReportRoutes = (models) => {
    // ... (asignación de modelos sin cambios)

    // --- CORRECCIÓN PARA BUG 'Cliente: N/A' ---
    router.get('/client-statement/:clientId', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports', 'collector_agent']), async (req, res) => {
        const { clientId } = req.params;
        if (isNaN(parseInt(clientId, 10))) return res.status(400).json({ message: 'El ID del cliente debe ser un número válido.' });
        try {
            const client = await Client.findByPk(clientId);
            if (!client) return res.status(404).json({ message: 'Cliente no encontrado.' });
            const sales = await Sale.findAll({
                where: { clientId },
                include: [
                    { model: Client, as: 'client' }, // <<---- ESTA ES LA LÍNEA AÑADIDA
                    { model: SaleItem, as: 'saleItems', include: [{ model: Product, as: 'product' }] },
                    { model: Payment, as: 'payments', order: [['paymentDate', 'ASC']] }
                ],
                order: [['saleDate', 'ASC']]
            });
            let totalClientBalanceDue = sales.reduce((acc, sale) => acc + (sale.isCredit ? sale.balanceDue : 0), 0);
            res.json({ client, sales, totalClientBalanceDue: parseFloat(totalClientBalanceDue.toFixed(2)) });
        } catch (error) {
            console.error('Error en /client-statement:', error);
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    // El resto de las rutas de reportes permanecen igual
    // ...
    
    return router;
};

module.exports = initReportRoutes;
const express = require('express');
const router = express.Router();
const authorizeRoles = require('../middleware/roleMiddleware');
// ... otros imports ...

let Sale, Client, Payment, SaleItem, Product;

const initReportRoutes = (models) => {
    Sale = models.Sale;
    Client = models.Client;
    Payment = models.Payment;
    SaleItem = models.SaleItem;
    Product = models.Product;

    router.get('/client-statement/:clientId', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports', 'collector_agent']), async (req, res) => {
        const { clientId } = req.params;
        try {
            const client = await Client.findByPk(clientId);
            if (!client) return res.status(404).json({ message: 'Cliente no encontrado.' });
            
            const sales = await Sale.findAll({
                where: { clientId },
                include: [
                    { model: SaleItem, as: 'saleItems', include: [{ model: Product, as: 'product' }] },
                    { model: Payment, as: 'payments', order: [['paymentDate', 'ASC']] }
                ],
                order: [['saleDate', 'ASC']]
            });
            let totalClientBalanceDue = sales.reduce((acc, sale) => acc + (sale.isCredit ? sale.balanceDue : 0), 0);
            res.json({ client, sales, totalClientBalanceDue: parseFloat(totalClientBalanceDue.toFixed(2)) });
        } catch (error) {
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });
    
    // El resto de las rutas de reportes no necesitan cambios
    
    return router;
};

module.exports = initReportRoutes;
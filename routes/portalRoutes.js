const express = require('express');
const router = express.Router();
const clientAuthMiddleware = require('../middleware/clientAuthMiddleware');

let Sale, Client, Product, Payment, SaleItem;

const initPortalRoutes = (models) => {
    Sale = models.Sale;
    Client = models.Client;
    Product = models.Product;
    Payment = models.Payment;
    SaleItem = models.SaleItem;

    // Ruta para que el cliente obtenga todos sus propios datos
    router.get('/my-data', clientAuthMiddleware, async (req, res) => {
        try {
            const clientId = req.client.clientId; // Obtenido del token verificado por el middleware

            const clientData = await Client.findByPk(clientId, {
                attributes: { exclude: ['password'] },
                include: [
                    {
                        model: Sale,
                        as: 'sales',
                        include: [
                            { model: SaleItem, as: 'saleItems', include: [{ model: Product, as: 'product' }] },
                            { model: Payment, as: 'payments', order: [['paymentDate', 'DESC']] }
                        ]
                    }
                ],
                order: [[{ model: Sale, as: 'sales' }, 'saleDate', 'DESC']]
            });

            if (!clientData) {
                return res.status(404).json({ message: 'Cliente no encontrado.' });
            }

            res.json(clientData);

        } catch (error) {
            console.error("Error al obtener datos del portal del cliente:", error);
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    return router;
};

module.exports = initPortalRoutes;
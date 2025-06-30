// Archivo: routes/salePaymentRoutes.js (Versión con Creación de Venta Optimizada)

const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const authMiddleware = require('../middleware/authMiddleware');
const authorizeRoles = require('../middleware/roleMiddleware');
const moment = require('moment-timezone');
const ExcelJS = require('exceljs');

let Sale, Client, Product, Payment, SaleItem, User, AuditLog;
const TIMEZONE = "America/Mexico_City";

const initSalePaymentRoutes = (models, sequelize) => {
    Sale = models.Sale;
    Client = models.Client;
    Product = models.Product;
    Payment = models.Payment;
    SaleItem = models.SaleItem;
    User = models.User;
    AuditLog = models.AuditLog;
    
    // --- INICIO DE LA MODIFICACIÓN: RUTA POST / OPTIMIZADA ---
    router.post('/', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
        const { clientId, saleItems, isCredit, downPayment, assignedCollectorId, paymentFrequency, numberOfPayments } = req.body;

        if (!clientId || !saleItems || !saleItems.length) {
            return res.status(400).json({ message: 'Cliente y productos son obligatorios.' });
        }
        const t = await sequelize.transaction();
        try {
            const client = await Client.findByPk(clientId, { transaction: t });
            if (!client) throw new Error('Cliente no encontrado.');

            if (isCredit && assignedCollectorId) {
                const collector = await User.findByPk(assignedCollectorId, { transaction: t });
                if (!collector) throw new Error(`El gestor con ID ${assignedCollectorId} no existe.`);
            }

            let totalAmount = 0;
            const saleItemsToCreate = [];

            for (const item of saleItems) {
                const product = await Product.findByPk(item.productId, { transaction: t, lock: true });
                if (!product || product.stock < item.quantity) {
                    throw new Error(`Stock insuficiente para ${product?.name || 'producto desconocido'}. Disponible: ${product?.stock || 0}`);
                }
                
                totalAmount += product.price * item.quantity;
                
                // Se añade el producto a la lista para crear el SaleItem
                saleItemsToCreate.push({ 
                    productId: item.productId, 
                    quantity: item.quantity, 
                    priceAtSale: product.price 
                });

                // Se descuenta el stock de forma eficiente aquí mismo
                await Product.decrement('stock', {
                    by: item.quantity,
                    where: { id: item.productId },
                    transaction: t
                });
            }
            
            const saleData = { clientId, totalAmount, isCredit: !!isCredit, status: isCredit ? 'pending_credit' : 'completed', assignedCollectorId: isCredit && assignedCollectorId ? parseInt(assignedCollectorId) : null };
            
            if (isCredit) {
                const downPaymentFloat = parseFloat(downPayment);
                const numPaymentsInt = parseInt(numberOfPayments, 10);

                if (isNaN(downPaymentFloat) || downPaymentFloat < 0 || downPaymentFloat > totalAmount) throw new Error('El enganche es inválido.');
                if (isNaN(numPaymentsInt) || numPaymentsInt <= 0) throw new Error('El número de pagos debe ser mayor a cero.');

                const balance = totalAmount - downPaymentFloat;
                
                Object.assign(saleData, { 
                    downPayment: downPaymentFloat, 
                    balanceDue: balance, 
                    paymentFrequency: paymentFrequency || 'weekly',
                    numberOfPayments: numPaymentsInt,
                    weeklyPaymentAmount: parseFloat((balance / numPaymentsInt).toFixed(2))
                });
            } else {
                Object.assign(saleData, { downPayment: totalAmount, balanceDue: 0 });
            }

            const newSale = await Sale.create(saleData, { transaction: t });
            
            const finalSaleItems = saleItemsToCreate.map(item => ({ ...item, saleId: newSale.id }));
            await SaleItem.bulkCreate(finalSaleItems, { transaction: t });
            
            // El bucle ineficiente de 'productUpdates' ha sido eliminado.

            await t.commit();

            try {
                await AuditLog.create({
                    userId: req.user.userId,
                    username: req.user.username,
                    action: 'CREÓ VENTA',
                    details: `Venta ID: ${newSale.id} para Cliente: ${client.name} ${client.lastName} por $${totalAmount.toFixed(2)}`
                });
            } catch (auditError) { console.error("Error al registrar en auditoría:", auditError); }

            const result = await Sale.findByPk(newSale.id, { include: [{ all: true, nested: true }] });
            res.status(201).json(result);
        } catch (error) {
            await t.rollback();
            console.error("Error al crear la venta:", error);
            res.status(400).json({ message: error.message || 'Error interno del servidor.' });
        }
    });
    // --- FIN DE LA MODIFICACIÓN ---

    // El resto de las rutas (GET, PUT, DELETE, etc.) permanecen igual que en la versión anterior.
    // ... (pega aquí el resto de las rutas del archivo `salePaymentRoutes.js` que ya tenías)
    router.get('/', /* ... */);
    router.get('/export-excel', /* ... */);
    router.get('/my-assigned', /* ... */);
    router.get('/:saleId', /* ... */);
    router.put('/:saleId/assign', /* ... */);
    router.post('/:saleId/payments', /* ... */);
    router.delete('/:saleId', /* ... */);


    return router;
};

module.exports = initSalePaymentRoutes;
// Archivo: routes/salePaymentRoutes.js

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

    // ============================================
    // MIDDLEWARE DE LOGGING PARA DEBUGGING
    // ============================================
    router.use((req, res, next) => {
        console.log(`--> Petición Recibida: ${req.method} ${req.path}`);
        if (req.method === 'DELETE') {
            console.log('🔥🔥🔥 DELETE DETECTADO 🔥🔥🔥');
            console.log('   Path completo:', req.originalUrl);
            console.log('   Params:', req.params);
            console.log('   User:', req.user);
        }
        next();
    });

    // ============================================
    // POST / - Crear nueva venta
    // ============================================
    router.post('/', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
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
            const productUpdates = [];
            const saleItemsToCreate = [];

            for (const item of saleItems) {
                const product = await Product.findByPk(item.productId, { transaction: t, lock: true });
                if (!product || product.stock < item.quantity) throw new Error(`Stock insuficiente para ${product?.name || 'producto desconocido'}.`);
                totalAmount += product.price * item.quantity;
                productUpdates.push({ instance: product, newStock: product.stock - item.quantity });
                saleItemsToCreate.push({ productId: item.productId, quantity: item.quantity, priceAtSale: product.price });
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
            for (const update of productUpdates) {
                update.instance.stock = update.newStock;
                await update.instance.save({ transaction: t });
            }

            if (newSale.downPayment > 0) {
                const paymentNotes = newSale.isCredit ? 'Enganche inicial de venta a crédito' : 'Pago total de venta de contado';
                await Payment.create({
                    saleId: newSale.id,
                    amount: newSale.downPayment,
                    paymentMethod: 'cash',
                    notes: paymentNotes
                }, { transaction: t });
            }

            await t.commit();

            try {
                await AuditLog.create({
                    userId: req.user.userId,
                    username: req.user.username,
                    action: 'CREÓ VENTA',
                    details: `Venta ID: ${newSale.id} para Cliente: ${client.name} ${client.lastName} por $${totalAmount.toFixed(2)}. ${newSale.isCredit ? `Enganche: $${newSale.downPayment.toFixed(2)}` : 'Contado'}`
                });
            } catch (auditError) { console.error("Error al registrar en auditoría:", auditError); }

            const result = await Sale.findByPk(newSale.id, { include: [{ all: true, nested: true }] });
            res.status(201).json(result);
        } catch (error) {
            await t.rollback();
            res.status(400).json({ message: error.message || 'Error interno del servidor.' });
        }
    });

    // ============================================
    // GET / - Listar todas las ventas con paginación
    // ============================================
    router.get('/', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
        try {
            const { search, page, limit } = req.query;
            const pageNum = parseInt(page, 10) || 1;
            const limitNum = parseInt(limit, 10) || 10;
            const offset = (pageNum - 1) * limitNum;

            let whereClause = {};
            let clientWhereClause = {};

            if (search) {
                clientWhereClause = {
                    [Op.or]: [
                        { name: { [Op.iLike]: `%${search}%` } },
                        { lastName: { [Op.iLike]: `%${search}%` } }
                    ]
                };
            }

            const { count, rows } = await Sale.findAndCountAll({
                where: whereClause,
                include: [
                    { model: Client, as: 'client', where: clientWhereClause, required: !!search },
                    { model: SaleItem, as: 'saleItems', include: [{ model: Product, as: 'product' }] },
                    { model: User, as: 'assignedCollector', attributes: ['id', 'username'] },
                    { model: Payment, as: 'payments' }
                ],
                order: [['saleDate', 'DESC']],
                limit: limitNum,
                offset: offset,
                distinct: true
            });

            res.json({ totalItems: count, totalPages: Math.ceil(count / limitNum), currentPage: pageNum, sales: rows });
        } catch (error) {
            console.error('Error al obtener ventas:', error);
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    // ============================================
    // GET /export-excel - Exportar ventas a Excel
    // ============================================
    router.get('/export-excel', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']), async (req, res) => {
        try {
            const sales = await Sale.findAll({
                include: [
                    { model: Client, as: 'client' },
                    { model: SaleItem, as: 'saleItems', include: [{ model: Product, as: 'product' }] },
                    { model: User, as: 'assignedCollector', attributes: ['id', 'username'] },
                    { model: Payment, as: 'payments' }
                ],
                order: [['saleDate', 'DESC']]
            });

            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Ventas');

            worksheet.columns = [
                { header: 'ID Venta', key: 'id', width: 10 },
                { header: 'Fecha', key: 'date', width: 15 },
                { header: 'Cliente', key: 'client', width: 25 },
                { header: 'Productos', key: 'products', width: 40 },
                { header: 'Monto Total', key: 'total', width: 15 },
                { header: 'Tipo', key: 'type', width: 10 },
                { header: 'Enganche', key: 'downPayment', width: 15 },
                { header: 'Saldo', key: 'balance', width: 15 },
                { header: 'Pagos Realizados', key: 'paymentsCount', width: 15 },
                { header: 'Estado', key: 'status', width: 15 },
                { header: 'Gestor', key: 'collector', width: 20 }
            ];

            sales.forEach(sale => {
                const clientName = sale.client ? `${sale.client.name} ${sale.client.lastName}` : 'N/A';
                const products = sale.saleItems.map(item => `${item.quantity}x ${item.product?.name || 'N/A'}`).join(', ');
                const paymentsCount = sale.payments?.length || 0;

                worksheet.addRow({
                    id: sale.id,
                    date: moment(sale.saleDate).tz(TIMEZONE).format('DD/MM/YYYY HH:mm'),
                    client: clientName,
                    products: products,
                    total: `$${sale.totalAmount.toFixed(2)}`,
                    type: sale.isCredit ? 'Crédito' : 'Contado',
                    downPayment: `$${sale.downPayment.toFixed(2)}`,
                    balance: `$${sale.balanceDue.toFixed(2)}`,
                    paymentsCount: paymentsCount,
                    status: sale.status,
                    collector: sale.assignedCollector?.username || 'N/A'
                });
            });

            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', 'attachment; filename=Reporte_Ventas.xlsx');

            await workbook.xlsx.write(res);
            res.end();
        } catch (error) {
            console.error('Error al exportar ventas:', error);
            res.status(500).json({ message: 'Error al generar el reporte Excel.' });
        }
    });

    // ============================================
    // GET /my-assigned - Ventas asignadas al gestor actual
    // ============================================
    router.get('/my-assigned', authMiddleware, authorizeRoles(['collector_agent']), async (req, res) => {
        try {
            const collectorId = req.user.userId;
            const sales = await Sale.findAll({
                where: { 
                    assignedCollectorId: collectorId,
                    isCredit: true,
                    balanceDue: { [Op.gt]: 0 }
                },
                include: [
                    { model: Client, as: 'client' },
                    { model: SaleItem, as: 'saleItems', include: [{ model: Product, as: 'product' }] },
                    { model: Payment, as: 'payments' }
                ],
                order: [['saleDate', 'DESC']]
            });

            res.json(sales);
        } catch (error) {
            console.error('Error al obtener ventas asignadas:', error);
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    // ============================================
    // GET /:saleId - Obtener detalles de una venta específica
    // ============================================
    router.get('/:saleId', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'collector_agent']), async (req, res) => {
        try {
            const sale = await Sale.findByPk(req.params.saleId, {
                include: [
                    { model: Client, as: 'client' },
                    { model: SaleItem, as: 'saleItems', include: [{ model: Product, as: 'product' }] },
                    { model: Payment, as: 'payments' },
                    { model: User, as: 'assignedCollector', attributes: ['id', 'username'] }
                ]
            });

            if (!sale) {
                return res.status(404).json({ message: 'Venta no encontrada.' });
            }

            res.json(sale);
        } catch (error) {
            console.error('Error al obtener venta:', error);
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    // ============================================
    // PUT /:saleId/assign - Asignar o reasignar gestor a una venta
    // ============================================
    router.put('/:saleId/assign', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
        const { collectorId } = req.body;
        try {
            const sale = await Sale.findByPk(req.params.saleId);
            if (!sale) {
                return res.status(404).json({ message: 'Venta no encontrada.' });
            }

            const oldCollectorId = sale.assignedCollectorId;
            sale.assignedCollectorId = collectorId ? parseInt(collectorId) : null;
            await sale.save();

            try {
                await AuditLog.create({
                    userId: req.user.userId,
                    username: req.user.username,
                    action: 'REASIGNÓ VENTA',
                    details: `Venta ID: ${sale.id}. Gestor anterior: ${oldCollectorId || 'ninguno'}, Nuevo gestor: ${sale.assignedCollectorId || 'ninguno'}`
                });
            } catch (auditError) { console.error("Error al registrar en auditoría:", auditError); }

            res.json({ message: 'Gestor asignado correctamente.', sale });
        } catch (error) {
            console.error('Error al asignar gestor:', error);
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    // ============================================
    // POST /:saleId/payments - Registrar un nuevo pago
    // ============================================
    router.post('/:saleId/payments', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'collector_agent']), async (req, res) => {
        const { amount, paymentMethod, notes } = req.body;
        const t = await sequelize.transaction();

        try {
            const sale = await Sale.findByPk(req.params.saleId, { transaction: t, lock: true });
            if (!sale) {
                await t.rollback();
                return res.status(404).json({ message: 'Venta no encontrada.' });
            }

            const paymentAmount = parseFloat(amount);
            if (isNaN(paymentAmount) || paymentAmount <= 0) {
                await t.rollback();
                return res.status(400).json({ message: 'El monto del pago debe ser mayor a cero.' });
            }

            if (paymentAmount > sale.balanceDue) {
                await t.rollback();
                return res.status(400).json({ message: `El monto del pago ($${paymentAmount.toFixed(2)}) excede el saldo pendiente ($${sale.balanceDue.toFixed(2)}).` });
            }

            const newPayment = await Payment.create({
                saleId: sale.id,
                amount: paymentAmount,
                paymentMethod: paymentMethod || 'cash',
                notes: notes || ''
            }, { transaction: t });

            sale.balanceDue = parseFloat((sale.balanceDue - paymentAmount).toFixed(2));
            if (sale.balanceDue <= 0) {
                sale.status = 'paid_off';
                sale.balanceDue = 0;
            }
            await sale.save({ transaction: t });

            await t.commit();

            try {
                await AuditLog.create({
                    userId: req.user.userId,
                    username: req.user.username,
                    action: 'REGISTRÓ PAGO',
                    details: `Pago ID: ${newPayment.id} de $${paymentAmount.toFixed(2)} para Venta ID: ${sale.id}. Nuevo saldo: $${sale.balanceDue.toFixed(2)}`
                });
            } catch (auditError) { console.error("Error al registrar en auditoría:", auditError); }

            const updatedSale = await Sale.findByPk(sale.id, {
                include: [
                    { model: Client, as: 'client' },
                    { model: Payment, as: 'payments' },
                    { model: SaleItem, as: 'saleItems', include: [{ model: Product, as: 'product' }] }
                ]
            });

            res.status(201).json({ message: 'Pago registrado con éxito.', payment: newPayment, sale: updatedSale });
        } catch (error) {
            await t.rollback();
            console.error('Error al registrar pago:', error);
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    // ============================================
    // DELETE /payments/:paymentId - Cancelar un pago (solo super_admin)
    // ============================================
    router.delete('/payments/:paymentId', authMiddleware, authorizeRoles(['super_admin']), async (req, res) => {
        const { paymentId } = req.params;
        const t = await sequelize.transaction();

        try {
            const payment = await Payment.findByPk(paymentId, { transaction: t });
            if (!payment) {
                await t.rollback();
                return res.status(404).json({ message: 'Pago no encontrado.' });
            }

            const sale = await Sale.findByPk(payment.saleId, { transaction: t, lock: true });
            if (!sale) {
                await t.rollback();
                return res.status(404).json({ message: 'Venta asociada no encontrada.' });
            }

            const paymentAmount = payment.amount;
            sale.balanceDue = parseFloat((sale.balanceDue + paymentAmount).toFixed(2));
            
            if (sale.status === 'paid_off' && sale.balanceDue > 0) {
                sale.status = 'pending_credit';
            }

            await sale.save({ transaction: t });
            await payment.destroy({ transaction: t });

            await t.commit();

            try {
                await AuditLog.create({
                    userId: req.user.userId,
                    username: req.user.username,
                    action: 'CANCELÓ PAGO',
                    details: `Pago ID: ${paymentId} de $${paymentAmount.toFixed(2)} cancelado. Venta ID: ${sale.id}. Nuevo saldo: $${sale.balanceDue.toFixed(2)}`
                });
            } catch (auditError) { console.error("Error al registrar en auditoría:", auditError); }

            res.json({ message: 'Pago cancelado y saldo actualizado con éxito.', sale });
        } catch (error) {
            await t.rollback();
            console.error('Error al cancelar pago:', error);
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    });

    // ============================================
    // DELETE /:saleId - Eliminar una venta (solo super_admin)
    // ============================================
    router.delete('/:saleId', authMiddleware, authorizeRoles(['super_admin']), async (req, res) => {
        const { saleId } = req.params;
        
        console.log('🔥 DELETE recibido para venta ID:', saleId);
        console.log('🔥 Usuario:', req.user);
        console.log('🔥 Modelos disponibles:', {
            Sale: !!Sale,
            SaleItem: !!SaleItem,
            Payment: !!Payment,
            Product: !!Product,
            Client: !!Client,
            sequelize: !!sequelize
        });
        
        if (!sequelize) {
            console.error('❌ ERROR CRÍTICO: sequelize no está definido');
            return res.status(500).json({ 
                message: 'Error de configuración del servidor: sequelize no disponible' 
            });
        }
        
        let t;
        try {
            t = await sequelize.transaction();
            console.log('✅ Transacción iniciada');
            
            const sale = await Sale.findByPk(saleId, {
                include: [
                    { model: SaleItem, as: 'saleItems' },
                    { model: Client, as: 'client' },
                    { model: Payment, as: 'payments' }
                ],
                transaction: t
            });

            if (!sale) {
                await t.rollback();
                console.log('❌ Venta no encontrada');
                return res.status(404).json({ message: 'Venta no encontrada.' });
            }

            console.log('✅ Venta encontrada:', {
                id: sale.id,
                clientId: sale.clientId,
                totalAmount: sale.totalAmount,
                itemsCount: sale.saleItems?.length || 0,
                paymentsCount: sale.payments?.length || 0
            });

            if (sale.saleItems && sale.saleItems.length > 0) {
                console.log('📦 Restaurando stock de', sale.saleItems.length, 'productos...');
                
                for (const item of sale.saleItems) {
                    try {
                        const product = await Product.findByPk(item.productId, { transaction: t });
                        
                        if (product) {
                            const oldStock = product.stock;
                            product.stock = product.stock + item.quantity;
                            await product.save({ transaction: t });
                            console.log(`  ✓ ${product.name}: ${oldStock} → ${product.stock}`);
                        } else {
                            console.warn(`  ⚠️ Producto ${item.productId} no encontrado`);
                        }
                    } catch (productError) {
                        console.error(`  ❌ Error restaurando producto ${item.productId}:`, productError.message);
                    }
                }
            }

            if (sale.payments && sale.payments.length > 0) {
                const deletedPayments = await Payment.destroy({ 
                    where: { saleId: sale.id }, 
                    transaction: t 
                });
                console.log(`💰 ${deletedPayments} pago(s) eliminado(s)`);
            }

            const deletedItems = await SaleItem.destroy({ 
                where: { saleId: sale.id }, 
                transaction: t 
            });
            console.log(`📋 ${deletedItems} item(s) de venta eliminado(s)`);

            await sale.destroy({ transaction: t });
            console.log('🗑️ Venta eliminada');

            if (AuditLog) {
                try {
                    await AuditLog.create({
                        userId: req.user.userId,
                        username: req.user.username,
                        action: 'ELIMINÓ VENTA',
                        details: `Venta ID: ${sale.id}, Cliente: ${sale.client?.name || 'N/A'} ${sale.client?.lastName || ''}, Monto: $${sale.totalAmount.toFixed(2)}`
                    }, { transaction: t });
                    console.log('📝 Auditoría registrada');
                } catch (auditError) {
                    console.warn('⚠️ No se pudo registrar auditoría:', auditError.message);
                }
            }

            await t.commit();
            console.log('✅ TRANSACCIÓN COMPLETADA EXITOSAMENTE');

            res.status(204).send();
            
        } catch (error) {
            console.error('❌ ERROR AL ELIMINAR VENTA:', error);
            console.error('❌ Error name:', error.name);
            console.error('❌ Error message:', error.message);
            console.error('❌ Stack:', error.stack);
            
            if (t) {
                try {
                    await t.rollback();
                    console.log('🔄 Transacción revertida');
                } catch (rollbackError) {
                    console.error('❌ Error al hacer rollback:', rollbackError);
                }
            }
            
            res.status(500).json({ 
                message: 'Error al eliminar la venta', 
                error: error.message,
                details: process.env.NODE_ENV === 'development' ? error.stack : undefined
            });
        }
    });

    // ============================================
    // VERIFICACIÓN DE RUTAS REGISTRADAS
    // ============================================
    console.log('📋 Rutas registradas en salePaymentRoutes:');
    router.stack.forEach((r) => {
        if (r.route) {
            const methods = Object.keys(r.route.methods).join(', ').toUpperCase();
            console.log(`   ${methods} /api/sales${r.route.path}`);
        }
    });

    return router;
};

module.exports = initSalePaymentRoutes;
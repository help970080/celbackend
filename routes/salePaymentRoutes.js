// routes/salePaymentRoutes.js - VERSIÓN CORREGIDA CON MULTI-TENANT Y STORE EN RECIBO

const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const authMiddleware = require('../middleware/authMiddleware');
const authorizeRoles = require('../middleware/roleMiddleware');
const applyStoreFilter = require('../middleware/storeFilterMiddleware');
const moment = require('moment-timezone');
const ExcelJS = require('exceljs');

let Sale, Client, Product, Payment, SaleItem, User, AuditLog, Store; // ⭐ AGREGADO Store
const TIMEZONE = "America/Mexico_City";

const initSalePaymentRoutes = (models, sequelize) => {
    Sale = models.Sale;
    Client = models.Client;
    Product = models.Product;
    Payment = models.Payment;
    SaleItem = models.SaleItem;
    User = models.User;
    AuditLog = models.AuditLog;
    Store = models.Store; // ⭐ AGREGADO

    // ⭐ POST / - Crear venta
    router.post('/', 
        authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), 
        applyStoreFilter,
        async (req, res) => {
            const { clientId, saleItems, isCredit, downPayment, assignedCollectorId, paymentFrequency, numberOfPayments } = req.body;

            if (!clientId || !saleItems || !saleItems.length) {
                return res.status(400).json({ message: 'Cliente y productos son obligatorios.' });
            }
            
            const t = await sequelize.transaction();
            try {
                // Verificar que el cliente pertenece a la tienda del usuario
                const client = await Client.findOne({
                    where: { 
                        id: clientId,
                        ...req.storeFilter
                    },
                    transaction: t
                });
                
                if (!client) {
                    await t.rollback();
                    return res.status(403).json({ message: 'Cliente no encontrado o no pertenece a tu tienda.' });
                }

                if (isCredit && assignedCollectorId) {
                    const collector = await User.findByPk(assignedCollectorId, { transaction: t });
                    if (!collector) throw new Error(`El gestor con ID ${assignedCollectorId} no existe.`);
                }

                let totalAmount = 0;
                const productUpdates = [];
                const saleItemsToCreate = [];

                for (const item of saleItems) {
                    const product = await Product.findOne({
                        where: {
                            id: item.productId,
                            ...req.storeFilter
                        },
                        transaction: t,
                        lock: true
                    });
                    
                    if (!product) {
                        throw new Error(`Producto ${item.productId} no encontrado o no pertenece a tu tienda.`);
                    }
                    
                    if (product.stock < item.quantity) {
                        throw new Error(`Stock insuficiente para ${product.name}.`);
                    }
                    
                    totalAmount += product.price * item.quantity;
                    productUpdates.push({ instance: product, newStock: product.stock - item.quantity });
                    saleItemsToCreate.push({ productId: item.productId, quantity: item.quantity, priceAtSale: product.price });
                }

                const saleData = { 
                    clientId, 
                    totalAmount, 
                    isCredit: !!isCredit, 
                    status: isCredit ? 'pending_credit' : 'completed', 
                    assignedCollectorId: isCredit && assignedCollectorId ? parseInt(assignedCollectorId) : null,
                    tiendaId: req.user.tiendaId
                };

                if (isCredit) {
                    const downPaymentFloat = parseFloat(downPayment);
                    const numPaymentsInt = parseInt(numberOfPayments, 10);

                    if (isNaN(downPaymentFloat) || downPaymentFloat < 0 || downPaymentFloat > totalAmount) {
                        throw new Error('El enganche es inválido.');
                    }
                    if (isNaN(numPaymentsInt) || numPaymentsInt <= 0) {
                        throw new Error('El número de pagos debe ser mayor a cero.');
                    }

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

                // Registrar enganche como pago
                if (newSale.downPayment > 0) {
                    const paymentNotes = newSale.isCredit 
                        ? 'Enganche inicial de venta a crédito' 
                        : 'Pago total de venta de contado';
                    
                    await Payment.create({
                        saleId: newSale.id,
                        amount: newSale.downPayment,
                        paymentMethod: 'cash',
                        notes: paymentNotes,
                        tiendaId: req.user.tiendaId
                    }, { transaction: t });
                }

                await t.commit();

                try {
                    await AuditLog.create({
                        userId: req.user.userId,
                        username: req.user.username,
                        action: 'CREÓ VENTA',
                        details: `Venta ID: ${newSale.id} para Cliente: ${client.name} ${client.lastName} por $${totalAmount.toFixed(2)}. ${newSale.isCredit ? `Enganche: $${newSale.downPayment.toFixed(2)}` : 'Contado'}`,
                        tiendaId: req.user.tiendaId
                    });
                } catch (auditError) { 
                    console.error("Error al registrar en auditoría:", auditError); 
                }

                res.status(201).json(newSale);
            } catch (error) {
                await t.rollback();
                res.status(400).json({ message: error.message || 'Error interno del servidor.' });
            }
        }
    );

    // GET / - Listar ventas
    router.get('/', 
        authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), 
        applyStoreFilter, 
        async (req, res) => {
            try {
                const { search, page, limit } = req.query;
                const pageNum = parseInt(page, 10) || 1;
                const limitNum = parseInt(limit, 10) || 10;
                const offset = (pageNum - 1) * limitNum;

                let whereClause = { ...req.storeFilter };
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
                        { model: User, as: 'assignedCollector', attributes: ['id', 'username'] }
                    ],
                    order: [['saleDate', 'DESC']],
                    limit: limitNum,
                    offset: offset,
                    distinct: true
                });

                res.json({ 
                    totalItems: count, 
                    totalPages: Math.ceil(count / limitNum), 
                    currentPage: pageNum, 
                    sales: rows 
                });
            } catch (error) {
                console.error('Error al obtener ventas:', error);
                res.status(500).json({ message: 'Error interno del servidor.' });
            }
        }
    );

    // GET /export-excel - Exportar ventas
    router.get('/export-excel', 
        authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']), 
        applyStoreFilter, 
        async (req, res) => {
            try {
                const sales = await Sale.findAll({
                    where: req.storeFilter,
                    include: [
                        { model: Client, as: 'client', attributes: ['name', 'lastName', 'phone', 'address'] },
                        { 
                            model: SaleItem, 
                            as: 'saleItems', 
                            include: [{ model: Product, as: 'product', attributes: ['name', 'price'] }] 
                        },
                        { model: User, as: 'assignedCollector', attributes: ['username'] },
                        { model: Payment, as: 'payments', attributes: ['amount', 'paymentDate', 'paymentMethod'] }
                    ],
                    order: [['saleDate', 'DESC']]
                });

                const workbook = new ExcelJS.Workbook();
                const worksheet = workbook.addWorksheet('Ventas');

                worksheet.columns = [
                    { header: 'ID Venta', key: 'id', width: 10 },
                    { header: 'Fecha', key: 'saleDate', width: 15 },
                    { header: 'Cliente', key: 'client', width: 30 },
                    { header: 'Teléfono', key: 'phone', width: 15 },
                    { header: 'Dirección', key: 'address', width: 40 },
                    { header: 'Productos', key: 'products', width: 50 },
                    { header: 'Monto Total', key: 'totalAmount', width: 15 },
                    { header: 'Tipo', key: 'isCredit', width: 10 },
                    { header: 'Enganche', key: 'downPayment', width: 15 },
                    { header: 'Saldo Pendiente', key: 'balanceDue', width: 15 },
                    { header: 'Pago Semanal', key: 'weeklyPaymentAmount', width: 15 },
                    { header: '# Pagos', key: 'numberOfPayments', width: 10 },
                    { header: 'Frecuencia', key: 'paymentFrequency', width: 12 },
                    { header: 'Estado', key: 'status', width: 15 },
                    { header: 'Gestor Asignado', key: 'collector', width: 20 },
                    { header: 'Pagos Realizados', key: 'paymentsMade', width: 15 },
                    { header: 'Total Pagado', key: 'totalPaid', width: 15 }
                ];

                sales.forEach(sale => {
                    const clientName = sale.client ? `${sale.client.name} ${sale.client.lastName}` : 'N/A';
                    const clientPhone = sale.client?.phone || 'N/A';
                    const clientAddress = sale.client?.address || 'N/A';
                    const productsDisplay = sale.saleItems && sale.saleItems.length > 0
                        ? sale.saleItems.map(item => {
                            const productName = item.product?.name || `ID ${item.productId}`;
                            return `${productName} (x${item.quantity})`;
                          }).join(', ')
                        : 'N/A';
                    const collectorName = sale.assignedCollector?.username || 'N/A';
                    const paymentsMade = sale.payments?.length || 0;
                    const totalPaid = sale.payments?.reduce((sum, p) => sum + p.amount, 0) || 0;

                    worksheet.addRow({
                        id: sale.id,
                        saleDate: moment(sale.saleDate).tz(TIMEZONE).format('DD/MM/YYYY HH:mm'),
                        client: clientName,
                        phone: clientPhone,
                        address: clientAddress,
                        products: productsDisplay,
                        totalAmount: sale.totalAmount,
                        isCredit: sale.isCredit ? 'Crédito' : 'Contado',
                        downPayment: sale.downPayment || 0,
                        balanceDue: sale.balanceDue || 0,
                        weeklyPaymentAmount: sale.weeklyPaymentAmount || 'N/A',
                        numberOfPayments: sale.numberOfPayments || 'N/A',
                        paymentFrequency: sale.paymentFrequency || 'N/A',
                        status: sale.status,
                        collector: collectorName,
                        paymentsMade: paymentsMade,
                        totalPaid: totalPaid
                    });
                });

                worksheet.getRow(1).font = { bold: true };
                worksheet.getRow(1).fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFD3D3D3' }
                };

                res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                res.setHeader('Content-Disposition', `attachment; filename="Reporte_Ventas_${moment().format('YYYYMMDD')}.xlsx"`);
                await workbook.xlsx.write(res);
                res.end();
            } catch (error) {
                console.error('Error al exportar ventas a Excel:', error);
                res.status(500).json({ message: 'Error al generar el reporte de ventas.', error: error.message });
            }
        }
    );

    // ⭐ GET /:saleId - Obtener venta específica (CORREGIDO: INCLUYE STORE)
    router.get('/:saleId', 
        authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'collector_agent']), 
        applyStoreFilter, 
        async (req, res) => {
            try {
                const { saleId } = req.params;
                const sale = await Sale.findOne({
                    where: { 
                        id: saleId,
                        ...req.storeFilter 
                    },
                    include: [
                        { model: Client, as: 'client' },
                        { model: SaleItem, as: 'saleItems', include: [{ model: Product, as: 'product' }] },
                        { model: User, as: 'assignedCollector', attributes: ['id', 'username'] },
                        { model: Payment, as: 'payments', order: [['paymentDate', 'DESC']] },
                        { model: Store, as: 'store', attributes: ['id', 'name', 'address', 'phone', 'email', 'depositInfo'] } // ⭐ INCLUYE depositInfo
                    ]
                });

                if (!sale) {
                    return res.status(404).json({ message: 'Venta no encontrada o no pertenece a tu tienda.' });
                }

                res.json(sale);
            } catch (error) {
                console.error('Error al obtener venta:', error);
                res.status(500).json({ message: 'Error interno del servidor.' });
            }
        }
    );

    // PUT /:saleId/assign - Asignar gestor
    router.put('/:saleId/assign', 
        authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), 
        applyStoreFilter, 
        async (req, res) => {
            const { saleId } = req.params;
            const { collectorId } = req.body;

            try {
                const sale = await Sale.findOne({
                    where: { 
                        id: saleId,
                        ...req.storeFilter 
                    },
                    include: [{ model: User, as: 'assignedCollector', attributes: ['id', 'username'] }]
                });

                if (!sale) {
                    return res.status(404).json({ message: 'Venta no encontrada o no pertenece a tu tienda.' });
                }

                const previousCollector = sale.assignedCollector?.username || 'Nadie';
                sale.assignedCollectorId = collectorId === "null" ? null : parseInt(collectorId, 10);
                await sale.save();

                const updatedSaleWithNewCollector = await Sale.findByPk(saleId, { 
                    include: [{ model: User, as: 'assignedCollector', attributes: ['id', 'username'] }] 
                });
                const newCollector = updatedSaleWithNewCollector.assignedCollector?.username || 'Nadie';

                try {
                    await AuditLog.create({
                        userId: req.user.userId,
                        username: req.user.username,
                        action: 'ASIGNÓ GESTOR',
                        details: `Venta ID: ${saleId}. Cambio de: ${previousCollector} a: ${newCollector}`,
                        tiendaId: req.user.tiendaId
                    });
                } catch (auditError) { 
                    console.error("Error al registrar en auditoría:", auditError); 
                }

                res.json({ message: 'Gestor asignado con éxito.', sale: updatedSaleWithNewCollector });
            } catch (error) {
                res.status(500).json({ message: 'Error interno del servidor.' });
            }
        }
    );

    // POST /:saleId/payments - Registrar pago
    router.post('/:saleId/payments', 
        authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'collector_agent']), 
        applyStoreFilter,
        async (req, res) => {
            const { amount, paymentMethod, notes } = req.body;
            const { saleId } = req.params;
            
            try {
                const sale = await Sale.findOne({
                    where: {
                        id: saleId,
                        ...req.storeFilter
                    }
                });
                
                if (!sale) {
                    return res.status(404).json({ message: 'Venta no encontrada o no pertenece a tu tienda.' });
                }
                
                if (!sale.isCredit) {
                    return res.status(400).json({ message: 'No se pueden registrar pagos a ventas de contado.' });
                }
                
                if (sale.balanceDue <= 0) {
                    return res.status(400).json({ message: 'Esta venta ya no tiene saldo pendiente.' });
                }

                const newPayment = await Payment.create({ 
                    saleId: parseInt(saleId), 
                    amount: parseFloat(amount), 
                    paymentMethod: paymentMethod || 'cash', 
                    notes,
                    tiendaId: req.user.tiendaId
                });

                let newBalance = sale.balanceDue - amount;
                if (Math.abs(newBalance) < 0.01) { 
                    newBalance = 0; 
                }

                sale.balanceDue = parseFloat(newBalance.toFixed(2));
                if (sale.balanceDue <= 0) { 
                    sale.status = 'paid_off'; 
                }
                await sale.save();

                try {
                    await AuditLog.create({
                        userId: req.user.userId,
                        username: req.user.username,
                        action: 'REGISTRÓ PAGO',
                        details: `Monto: $${parseFloat(amount).toFixed(2)} en Venta ID: ${saleId}. Saldo restante: $${sale.balanceDue.toFixed(2)}`,
                        tiendaId: req.user.tiendaId
                    });
                } catch (auditError) { 
                    console.error("Error al registrar en auditoría:", auditError); 
                }
                
                res.status(201).json(newPayment);
            } catch (error) {
                res.status(500).json({ message: 'Error interno del servidor.' });
            }
        }
    );

    // DELETE /payments/:paymentId - Cancelar pago
    router.delete('/payments/:paymentId', 
        authMiddleware, 
        authorizeRoles(['super_admin']), 
        async (req, res) => {
            const { paymentId } = req.params;
            if (isNaN(parseInt(paymentId, 10))) {
                return res.status(400).json({ message: 'El ID del pago debe ser un número válido.' });
            }
            
            const t = await sequelize.transaction();
            try {
                const paymentToDelete = await Payment.findByPk(paymentId, { transaction: t });
                if (!paymentToDelete) {
                    await t.rollback();
                    return res.status(404).json({ message: 'Pago no encontrado.' });
                }
                
                const sale = await Sale.findByPk(paymentToDelete.saleId, { transaction: t });
                if (!sale) {
                    await t.rollback();
                    return res.status(404).json({ message: 'Venta asociada al pago no encontrada.' });
                }
                
                const reversedAmount = paymentToDelete.amount;
                const oldBalanceDue = sale.balanceDue;
                const oldStatus = sale.status;
                
                sale.balanceDue = parseFloat((sale.balanceDue + reversedAmount).toFixed(2));
                if (oldStatus === 'paid_off' && sale.balanceDue > 0) {
                    sale.status = 'pending_credit';
                }
                
                await sale.save({ transaction: t });
                await paymentToDelete.destroy({ transaction: t });
                await t.commit();
                
                try {
                    await AuditLog.create({
                        userId: req.user.userId,
                        username: req.user.username,
                        action: 'CANCELÓ PAGO',
                        details: `Pago ID: ${paymentId} cancelado. Monto revertido: $${reversedAmount.toFixed(2)}. Saldo de Venta ${sale.id} cambió de $${oldBalanceDue.toFixed(2)} a $${sale.balanceDue.toFixed(2)}. Estado de Venta: ${oldStatus} -> ${sale.status}.`,
                        tiendaId: req.user.tiendaId
                    });
                } catch (auditError) {
                    console.error("Error al registrar la cancelación de pago en auditoría:", auditError);
                }
                
                res.status(200).json({ message: 'Pago cancelado y saldo de venta actualizado con éxito.', updatedSale: sale });
            } catch (error) {
                await t.rollback();
                console.error('Error al cancelar pago:', error);
                res.status(500).json({ message: 'Error interno del servidor al cancelar el pago.', error: error.message });
            }
        }
    );

    // DELETE /:saleId - Eliminar venta
    router.delete('/:saleId', 
        authorizeRoles(['super_admin']), 
        applyStoreFilter,
        async (req, res) => {
            const { saleId } = req.params;
            if (isNaN(parseInt(saleId, 10))) {
                return res.status(400).json({ message: 'El ID de la venta debe ser un número válido.' });
            }

            const t = await sequelize.transaction();
            try {
                const saleToDelete = await Sale.findOne({
                    where: {
                        id: saleId,
                        ...req.storeFilter
                    },
                    include: [{ model: SaleItem, as: 'saleItems' }],
                    transaction: t
                });

                if (!saleToDelete) {
                    await t.rollback();
                    return res.status(404).json({ message: 'Venta no encontrada o no pertenece a tu tienda.' });
                }

                // Restaurar stock de productos
                for (const item of saleToDelete.saleItems) {
                    await Product.increment('stock', {
                        by: item.quantity,
                        where: { id: item.productId },
                        transaction: t
                    });
                }

                const saleIdForLog = saleToDelete.id;
                await saleToDelete.destroy({ transaction: t });

                await t.commit();

                try {
                    await AuditLog.create({
                        userId: req.user.userId,
                        username: req.user.username,
                        action: 'ELIMINÓ VENTA',
                        details: `Venta ID: ${saleIdForLog} eliminada. El stock de los productos ha sido restaurado.`,
                        tiendaId: req.user.tiendaId
                    });
                } catch (auditError) { 
                    console.error("Error al registrar en auditoría:", auditError); 
                }

                res.status(204).send();
            } catch (error) {
                await t.rollback();
                console.error('Error al eliminar venta:', error);
                res.status(500).json({ message: 'Error interno del servidor al eliminar la venta.' });
            }
        }
    );

    return router;
};

module.exports = initSalePaymentRoutes;
// Archivo: routes/salePaymentRoutes.js

const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const authMiddleware = require('../middleware/authMiddleware');
const authorizeRoles = require('../middleware/roleMiddleware');
const moment = require('moment-timezone'); [cite_start]// [cite: 484]
const ExcelJS = require('exceljs'); // <--- AÑADIDO: Requerido para generar el Excel

let Sale, Client, Product, Payment, SaleItem, User, AuditLog;
const TIMEZONE = "America/Mexico_City"; [cite_start]// [cite: 484]

const initSalePaymentRoutes = (models, sequelize) => {
    Sale = models.Sale; [cite_start]// [cite: 485]
    Client = models.Client; [cite_start]// [cite: 485]
    Product = models.Product; [cite_start]// [cite: 485]
    Payment = models.Payment; [cite_start]// [cite: 486]
    SaleItem = models.SaleItem; [cite_start]// [cite: 486]
    User = models.User; [cite_start]// [cite: 486]
    AuditLog = models.AuditLog; [cite_start]// [cite: 486]

    // Ruta POST / para crear una venta (lógica de crédito actualizada)
    router.post('/', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
        [cite_start]const { clientId, saleItems, isCredit, downPayment, assignedCollectorId, paymentFrequency, numberOfPayments } = req.body; // [cite: 487]

        [cite_start]if (!clientId || !saleItems || !saleItems.length) { // [cite: 487]
            return res.status(400).json({ message: 'Cliente y productos son obligatorios.' }); [cite_start]// [cite: 488]
        }
        const t = await sequelize.transaction(); [cite_start]// [cite: 488]
        try {
            const client = await Client.findByPk(clientId, { transaction: t }); [cite_start]// [cite: 488]
            if (!client) throw new Error('Cliente no encontrado.'); [cite_start]// [cite: 488]

            [cite_start]if (isCredit && assignedCollectorId) { // [cite: 488]
                const collector = await User.findByPk(assignedCollectorId, { transaction: t }); [cite_start]// [cite: 489]
                if (!collector) throw new Error(`El gestor con ID ${assignedCollectorId} no existe.`); [cite_start]// [cite: 489]
            }

            let totalAmount = 0; [cite_start]// [cite: 490]
            const productUpdates = []; [cite_start]// [cite: 490]
            const saleItemsToCreate = []; [cite_start]// [cite: 491]

            [cite_start]for (const item of saleItems) { // [cite: 491]
                const product = await Product.findByPk(item.productId, { transaction: t, lock: true }); [cite_start]// [cite: 491]
                if (!product || product.stock < item.quantity) throw new Error(`Stock insuficiente para ${product?.name || 'producto desconocido'}.`); [cite_start]// [cite: 492]
                totalAmount += product.price * item.quantity; [cite_start]// [cite: 492]
                productUpdates.push({ instance: product, newStock: product.stock - item.quantity }); [cite_start]// [cite: 493]
                saleItemsToCreate.push({ productId: item.productId, quantity: item.quantity, priceAtSale: product.price }); [cite_start]// [cite: 493]
            }

            const saleData = { clientId, totalAmount, isCredit: !!isCredit, status: isCredit ? 'pending_credit' : 'completed', assignedCollectorId: isCredit && assignedCollectorId ? parseInt(assignedCollectorId) : null }; [cite_start]// [cite: 494, 495]

            [cite_start]if (isCredit) { // [cite: 496]
                const downPaymentFloat = parseFloat(downPayment); [cite_start]// [cite: 496]
                const numPaymentsInt = parseInt(numberOfPayments, 10); [cite_start]// [cite: 497]

                if (isNaN(downPaymentFloat) || downPaymentFloat < 0 || downPaymentFloat > totalAmount) throw new Error('El enganche es inválido.'); [cite_start]// [cite: 497]
                if (isNaN(numPaymentsInt) || numPaymentsInt <= 0) throw new Error('El número de pagos debe ser mayor a cero.'); [cite_start]// [cite: 498]

                const balance = totalAmount - downPaymentFloat; [cite_start]// [cite: 499]

                Object.assign(saleData, {
                    downPayment: downPaymentFloat,
                    balanceDue: balance,
                    [cite_start]paymentFrequency: paymentFrequency || 'weekly', // Frecuencia recibida // [cite: 499]
                    [cite_start]numberOfPayments: numPaymentsInt, // Número de pagos recibido // [cite: 500]
                    [cite_start]weeklyPaymentAmount: parseFloat((balance / numPaymentsInt).toFixed(2)) // Se reutiliza la columna para el monto del pago // [cite: 500]
                });
            } else {
                Object.assign(saleData, { downPayment: totalAmount, balanceDue: 0 }); [cite_start]// [cite: 501]
            }

            const newSale = await Sale.create(saleData, { transaction: t }); [cite_start]// [cite: 502]
            const finalSaleItems = saleItemsToCreate.map(item => ({ ...item, saleId: newSale.id })); [cite_start]// [cite: 503]
            await SaleItem.bulkCreate(finalSaleItems, { transaction: t }); [cite_start]// [cite: 503]
            [cite_start]for (const update of productUpdates) { // [cite: 504]
                update.instance.stock = update.newStock; [cite_start]// [cite: 504]
                await update.instance.save({ transaction: t }); [cite_start]// [cite: 505]
            }

            await t.commit(); [cite_start]// [cite: 505]

            [cite_start]try { // [cite: 506]
                [cite_start]await AuditLog.create({ // [cite: 506]
                    [cite_start]userId: req.user.userId, // [cite: 507]
                    [cite_start]username: req.user.username, // [cite: 507]
                    [cite_start]action: 'CREÓ VENTA', // [cite: 507]
                    [cite_start]details: `Venta ID: ${newSale.id} para Cliente: ${client.name} ${client.lastName} por $${totalAmount.toFixed(2)}` // [cite: 507]
                });
            } catch (auditError) { console.error("Error al registrar en auditoría:", auditError); [cite_start]} // [cite: 508, 509]

            const result = await Sale.findByPk(newSale.id, { include: [{ all: true, nested: true }] }); [cite_start]// [cite: 509]
            res.status(201).json(result); [cite_start]// [cite: 510]
        } catch (error) {
            await t.rollback(); [cite_start]// [cite: 510]
            res.status(400).json({ message: error.message || 'Error interno del servidor.' }); [cite_start]// [cite: 511]
        }
    });

    // Ruta GET / para listar ventas
    router.get('/', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
        try {
            [cite_start]const { search, page, limit } = req.query; // [cite: 512]
            const pageNum = parseInt(page, 10) || 1; [cite_start]// [cite: 512]
            const limitNum = parseInt(limit, 10) || 10; [cite_start]// [cite: 512]
            const offset = (pageNum - 1) * limitNum; [cite_start]// [cite: 513]

            let whereClause = {}; [cite_start]// [cite: 513]
            let clientWhereClause = {}; [cite_start]// [cite: 513]

            [cite_start]if (search) { // [cite: 514]
                [cite_start]clientWhereClause = { // [cite: 514]
                    [cite_start][Op.or]: [ // [cite: 514]
                        [cite_start]{ name: { [Op.iLike]: `%${search}%` } }, // [cite: 514]
                        [cite_start]{ lastName: { [Op.iLike]: `%${search}%` } } // [cite: 515]
                    ]
                };
            }

            [cite_start]const { count, rows } = await Sale.findAndCountAll({ // [cite: 515]
                [cite_start]where: whereClause, // [cite: 515]
                [cite_start]include: [ // [cite: 515]
                    [cite_start]{ model: Client, as: 'client', where: clientWhereClause, required: !!search }, // [cite: 516]
                    [cite_start]{ model: SaleItem, as: 'saleItems', include: [{ model: Product, as: 'product' }] }, // [cite: 516]
                    [cite_start]{ model: User, as: 'assignedCollector', attributes: ['id', 'username'] } // [cite: 516]
                ],
                [cite_start]order: [['saleDate', 'DESC']], // [cite: 516]
                [cite_start]limit: limitNum, // [cite: 517]
                [cite_start]offset: offset, // [cite: 517]
                [cite_start]distinct: true // [cite: 517]
            });

            res.json({ totalItems: count, totalPages: Math.ceil(count / limitNum), currentPage: pageNum, sales: rows }); [cite_start]// [cite: 518]
        } catch (error) {
            console.error('Error al obtener ventas:', error); [cite_start]// [cite: 519]
            res.status(500).json({ message: 'Error interno del servidor al obtener ventas.' }); [cite_start]// [cite: 520]
        }
    });

    // Nueva ruta para exportar todas las ventas a un archivo Excel.
    router.get('/export-excel', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'viewer_reports']), async (req, res) => {
        try {
            const sales = await Sale.findAll({
                include: [
                    { model: Client, as: 'client', attributes: ['name', 'lastName', 'phone'] },
                    { model: SaleItem, as: 'saleItems', include: [{ model: Product, as: 'product', attributes: ['name'] }] },
                    { model: Payment, as: 'payments' },
                    { model: User, as: 'assignedCollector', attributes: ['username'] }
                ],
                order: [['saleDate', 'DESC']]
            });

            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Reporte de Ventas');

            worksheet.columns = [
                { header: 'ID Venta', key: 'id', width: 10 },
                { header: 'Fecha Venta', key: 'saleDate', width: 20, style: { numFmt: 'dd/mm/yyyy hh:mm' } },
                { header: 'Cliente', key: 'clientName', width: 30 },
                { header: 'Teléfono Cliente', key: 'clientPhone', width: 15 },
                { header: 'Producto(s)', key: 'products', width: 50 },
                { header: 'Monto Total', key: 'totalAmount', width: 15, style: { numFmt: '"$"#,##0.00' } },
                { header: 'Tipo Venta', key: 'saleType', width: 15 },
                { header: 'Enganche', key: 'downPayment', width: 15, style: { numFmt: '"$"#,##0.00' } },
                { header: 'Saldo Pendiente', key: 'balanceDue', width: 15, style: { numFmt: '"$"#,##0.00' } },
                { header: 'Estado', key: 'status', width: 15 },
                { header: 'Plan de Pago', key: 'paymentPlan', width: 25 },
                { header: 'Pagos Realizados', key: 'paymentsMade', width: 15, style: { numFmt: '0' } },
                { header: 'Pagos Restantes', key: 'paymentsRemaining', width: 15, style: { numFmt: '0' } },
                { header: 'Asignado A', key: 'collector', width: 20 },
            ];

            const formatFrequency = (freq) => {
                const map = { daily: 'Diario', weekly: 'Semanal', fortnightly: 'Quincenal', monthly: 'Mensual' };
                return map[freq] || freq;
            };

            sales.forEach(sale => {
                const paymentsMade = sale.payments?.length || 0;
                const paymentsRemaining = sale.isCredit && sale.numberOfPayments ? sale.numberOfPayments - paymentsMade : 0;

                worksheet.addRow({
                    id: sale.id,
                    saleDate: moment(sale.saleDate).toDate(), // Usamos moment para asegurar la fecha correcta
                    clientName: sale.client ? `${sale.client.name} ${sale.client.lastName}` : 'N/A',
                    clientPhone: sale.client?.phone || 'N/A',
                    products: sale.saleItems.map(item => `${item.quantity}x ${item.product?.name || 'N/A'}`).join(', '),
                    totalAmount: sale.totalAmount,
                    saleType: sale.isCredit ? 'Crédito' : 'Contado',
                    downPayment: sale.isCredit ? sale.downPayment : sale.totalAmount,
                    balanceDue: sale.balanceDue,
                    status: sale.status,
                    paymentPlan: sale.isCredit ? `$${sale.weeklyPaymentAmount.toFixed(2)} (${formatFrequency(sale.paymentFrequency)})` : 'N/A',
                    paymentsMade: paymentsMade,
                    paymentsRemaining: paymentsRemaining > 0 ? paymentsRemaining : 0,
                    collector: sale.assignedCollector?.username || 'Sin Asignar',
                });
            });

            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', 'attachment; filename=Reporte_Ventas.xlsx');

            await workbook.xlsx.write(res);
            res.end();

        } catch (error) {
            console.error("Error al exportar ventas a Excel:", error);
            res.status(500).json({ message: 'Error interno del servidor al generar el reporte de Excel.' });
        }
    });

    // Ruta GET para cobranzas asignadas a un agente
    router.get('/my-assigned', authorizeRoles(['collector_agent']), async (req, res) => {
        try {
            [cite_start]const collectorId = req.user.userId; // [cite: 521]
            [cite_start]const assignedSales = await Sale.findAll({ // [cite: 521]
                where: {
                    assignedCollectorId: collectorId,
                    [cite_start]isCredit: true, // [cite: 522]
                    [cite_start]status: { [Op.ne]: 'paid_off' } // [cite: 522]
                },
                [cite_start]include: [ // [cite: 522]
                    [cite_start]{ model: Client, as: 'client' }, // [cite: 523]
                    [cite_start]{ model: SaleItem, as: 'saleItems', include: [{ model: Product, as: 'product' }] }, // [cite: 523]
                    [cite_start]{ model: Payment, as: 'payments', order: [['paymentDate', 'DESC']] } // [cite: 523]
                ],
                [cite_start]order: [['saleDate', 'ASC']] // [cite: 523]
            });

            const today = moment().tz(TIMEZONE).startOf('day'); [cite_start]// [cite: 524]
            [cite_start]const groupedByClient = assignedSales.reduce((acc, sale) => { // [cite: 524]
                const clientId = sale.client.id; [cite_start]// [cite: 524]
                [cite_start]if (!acc[clientId]) { // [cite: 525]
                    [cite_start]acc[clientId] = { // [cite: 525]
                        [cite_start]client: sale.client.toJSON(), // [cite: 525]
                        [cite_start]sales: [], // [cite: 525]
                        [cite_start]hasOverdue: false // [cite: 526]
                    };
                }

                const lastPaymentDate = sale.payments.length > 0 ? moment(sale.payments[0].paymentDate) : moment(sale.saleDate); [cite_start]// [cite: 527]
                const addUnit = sale.paymentFrequency === 'daily' ? 'days' : sale.paymentFrequency === 'weekly' ? 'weeks' : sale.paymentFrequency === 'fortnightly' ? 'weeks' : 'months'; [cite_start]// [cite: 527, 528]
                const addAmount = sale.paymentFrequency === 'fortnightly' ? 2 : 1; [cite_start]// [cite: 528]
                const dueDate = moment(lastPaymentDate).tz(TIMEZONE).add(addAmount, addUnit).endOf('day'); [cite_start]// [cite: 529]

                const saleJSON = sale.toJSON(); [cite_start]// [cite: 529]
                [cite_start]if (today.isAfter(dueDate)) { // [cite: 529]
                    saleJSON.dynamicStatus = 'VENCIDO'; [cite_start]// [cite: 530]
                    acc[clientId].hasOverdue = true; [cite_start]// [cite: 530]
                } else {
                    saleJSON.dynamicStatus = 'AL_CORRIENTE'; [cite_start]// [cite: 531]
                }

                acc[clientId].sales.push(saleJSON); [cite_start]// [cite: 531]
                return acc; [cite_start]// [cite: 532]
            }, {});

            const result = Object.values(groupedByClient); [cite_start]// [cite: 532]
            res.json(result); [cite_start]// [cite: 532]

        } catch (error) {
            console.error(error); [cite_start]// [cite: 533]
            res.status(500).json({ message: 'Error interno del servidor.' }); [cite_start]// [cite: 533]
        }
    });

    // Ruta GET para una venta específica
    router.get('/:saleId', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'collector_agent']), async (req, res) => {
        try {
            [cite_start]const { saleId } = req.params; // [cite: 534]
            [cite_start]if (isNaN(parseInt(saleId, 10))) { // [cite: 534]
                return res.status(400).json({ message: 'El ID de la venta debe ser un número válido.' }); [cite_start]// [cite: 534]
            }

            [cite_start]const sale = await Sale.findByPk(saleId, { // [cite: 535]
                [cite_start]include: [ // [cite: 535]
                    [cite_start]{ model: Client, as: 'client' }, // [cite: 535]
                    [cite_start]{ model: SaleItem, as: 'saleItems', include: [{ model: Product, as: 'product' }] }, // [cite: 536]
                    [cite_start]{ model: Payment, as: 'payments', order: [['paymentDate', 'DESC']] }, // [cite: 536]
                    [cite_start]{ model: User, as: 'assignedCollector', attributes: ['id', 'username'] } // [cite: 536]
                ]
            });

            [cite_start]if (!sale) { // [cite: 537]
                return res.status(404).json({ message: 'Venta no encontrada.' }); [cite_start]// [cite: 537]
            }

            res.json(sale); [cite_start]// [cite: 538]
        } catch (error) {
            console.error('Error al obtener la venta:', error); [cite_start]// [cite: 538]
            res.status(500).json({ message: 'Error interno del servidor.' }); [cite_start]// [cite: 538]
        }
    });

    // Ruta PUT para asignar un gestor a una venta
    router.put('/:saleId/assign', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
        [cite_start]const { saleId } = req.params; // [cite: 539]
        const { collectorId } = req.body; [cite_start]// [cite: 539]
        if (collectorId === undefined) return res.status(400).json({ message: 'Se requiere el ID del gestor.' }); [cite_start]// [cite: 539]
        try {
            const sale = await Sale.findByPk(saleId, { include: [{model: User, as: 'assignedCollector'}] }); [cite_start]// [cite: 539]
            if (!sale) return res.status(404).json({ message: 'Venta no encontrada.' }); [cite_start]// [cite: 540]
            if (!sale.isCredit) return res.status(400).json({ message: 'Solo se pueden asignar ventas a crédito.' }); [cite_start]// [cite: 540]

            const previousCollector = sale.assignedCollector?.username || 'Nadie'; [cite_start]// [cite: 540]
            sale.assignedCollectorId = collectorId === "null" ? null : parseInt(collectorId, 10); [cite_start]// [cite: 541]
            await sale.save(); [cite_start]// [cite: 541]

            const updatedSaleWithNewCollector = await Sale.findByPk(saleId, { include: [{ model: User, as: 'assignedCollector', attributes: ['id', 'username'] }] }); [cite_start]// [cite: 541]
            const newCollector = updatedSaleWithNewCollector.assignedCollector?.username || 'Nadie'; [cite_start]// [cite: 542]

            [cite_start]try { // [cite: 542]
                [cite_start]await AuditLog.create({ // [cite: 542]
                    [cite_start]userId: req.user.userId, // [cite: 543]
                    [cite_start]username: req.user.username, // [cite: 543]
                    [cite_start]action: 'ASIGNÓ GESTOR', // [cite: 543]
                    details: `Venta ID: ${saleId}. [cite_start]Cambio de: ${previousCollector} a: ${newCollector}` // [cite: 543]
                });
            } catch (auditError) { console.error("Error al registrar en auditoría:", auditError); [cite_start]} // [cite: 544, 545]

            res.json({ message: 'Gestor asignado con éxito.', sale: updatedSaleWithNewCollector }); [cite_start]// [cite: 545]
        } catch (error) {
            res.status(500).json({ message: 'Error interno del servidor.' }); [cite_start]// [cite: 546]
        }
    });

    // Ruta POST para registrar un pago en una venta
    router.post('/:saleId/payments', authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'collector_agent']), async (req, res) => {
        [cite_start]const { amount, paymentMethod, notes } = req.body; // [cite: 547]
        const { saleId } = req.params; [cite_start]// [cite: 547]
        try {
            const sale = await Sale.findByPk(saleId); [cite_start]// [cite: 547]
            if (!sale) return res.status(404).json({ message: 'Venta no encontrada.' }); [cite_start]// [cite: 547]
            if (!sale.isCredit) return res.status(400).json({ message: 'No se pueden registrar pagos a ventas de contado.' }); [cite_start]// [cite: 548]
            if (sale.balanceDue <= 0) return res.status(400).json({ message: 'Esta venta ya no tiene saldo pendiente.' }); [cite_start]// [cite: 548]

            const newPayment = await Payment.create({ saleId: parseInt(saleId), amount: parseFloat(amount), paymentMethod: paymentMethod || 'cash', notes }); [cite_start]// [cite: 548]

            let newBalance = sale.balanceDue - amount; [cite_start]// [cite: 549]
            if (Math.abs(newBalance) < 0.01) { newBalance = 0; [cite_start]} // [cite: 549]

            sale.balanceDue = parseFloat(newBalance.toFixed(2)); [cite_start]// [cite: 549]
            if (sale.balanceDue <= 0) { sale.status = 'paid_off'; [cite_start]} // [cite: 550]

            await sale.save(); [cite_start]// [cite: 550]

            [cite_start]try { // [cite: 551]
                 [cite_start]await AuditLog.create({ // [cite: 551]
                    [cite_start]userId: req.user.userId, // [cite: 552]
                    [cite_start]username: req.user.username, // [cite: 552]
                    [cite_start]action: 'REGISTRÓ PAGO', // [cite: 552]
                    details: `Monto: $${parseFloat(amount).toFixed(2)} en Venta ID: ${saleId}. [cite_start]Saldo restante: $${sale.balanceDue.toFixed(2)}` // [cite: 552]
                });
            } catch (auditError) { console.error("Error al registrar en auditoría:", auditError); [cite_start]} // [cite: 553, 554]

            res.status(201).json(newPayment); [cite_start]// [cite: 554]
        } catch (error) {
            res.status(500).json({ message: 'Error interno del servidor.' }); [cite_start]// [cite: 555]
        }
    });

    // RUTA PARA ELIMINAR/CANCELAR UN PAGO (PROTEGIDA - SOLO super_admin)
    // ESTA ES LA NUEVA RUTA AGREGADA
    router.delete('/payments/:paymentId', authMiddleware, authorizeRoles(['super_admin']), async (req, res) => {
        const { paymentId } = req.params;
        if (isNaN(parseInt(paymentId, 10))) {
            return res.status(400).json({ message: 'El ID del pago debe ser un número válido.' });
        }

        const t = await sequelize.transaction(); // Iniciar transacción
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

            // Revertir el saldo de la venta
            sale.balanceDue = parseFloat((sale.balanceDue + reversedAmount).toFixed(2));

            // Determinar el nuevo estado de la venta
            // Si la venta estaba pagada y ahora tiene saldo, vuelve a 'pending_credit'
            if (oldStatus === 'paid_off' && sale.balanceDue > 0) {
                sale.status = 'pending_credit';
            }

            await sale.save({ transaction: t });

            // Eliminar el registro del pago
            await paymentToDelete.destroy({ transaction: t });

            await t.commit(); // Confirmar la transacción

            // Registrar en el log de auditoría
            try {
                await AuditLog.create({
                    userId: req.user.userId,
                    username: req.user.username,
                    action: 'CANCELÓ PAGO',
                    details: `Pago ID: ${paymentId} cancelado. Monto revertido: $${reversedAmount.toFixed(2)}. Saldo de Venta ${sale.id} cambió de $${oldBalanceDue.toFixed(2)} a $${sale.balanceDue.toFixed(2)}. Estado de Venta: ${oldStatus} -> ${sale.status}.`
                });
            } catch (auditError) {
                console.error("Error al registrar la cancelación de pago en auditoría:", auditError);
                // No lanzar error fatal aquí, el pago ya fue revertido.
            }

            res.status(200).json({ message: 'Pago cancelado y saldo de venta actualizado con éxito.', updatedSale: sale });

        } catch (error) {
            await t.rollback(); // Revertir la transacción si algo falla
            console.error('Error al cancelar pago:', error);
            res.status(500).json({ message: 'Error interno del servidor al cancelar el pago.', error: error.message });
        }
    });

    // Ruta DELETE para eliminar una venta
    router.delete('/:saleId', authorizeRoles(['super_admin']), async (req, res) => {
        [cite_start]const { saleId } = req.params; // [cite: 556]
        [cite_start]if (isNaN(parseInt(saleId, 10))) { // [cite: 556]
            return res.status(400).json({ message: 'El ID de la venta debe ser un número válido.' }); [cite_start]// [cite: 556]
        }

        const t = await sequelize.transaction(); [cite_start]// [cite: 557]
        try {
            [cite_start]const saleToDelete = await Sale.findByPk(saleId, { // [cite: 557]
                [cite_start]include: [{ model: SaleItem, as: 'saleItems' }], // [cite: 557]
                [cite_start]transaction: t // [cite: 557]
            });

            [cite_start]if (!saleToDelete) { // [cite: 557]
                await t.rollback(); [cite_start]// [cite: 558]
                return res.status(404).json({ message: 'Venta no encontrada.' }); [cite_start]// [cite: 558]
            }

            [cite_start]for (const item of saleToDelete.saleItems) { // [cite: 558]
                [cite_start]await Product.increment('stock', { // [cite: 558]
                    [cite_start]by: item.quantity, // [cite: 559]
                    [cite_start]where: { id: item.productId }, // [cite: 559]
                    [cite_start]transaction: t // [cite: 559]
                });
            }

            const saleIdForLog = saleToDelete.id; [cite_start]// [cite: 559]
            await saleToDelete.destroy({ transaction: t }); [cite_start]// [cite: 560]

            await t.commit(); [cite_start]// [cite: 560]

            [cite_start]try { // [cite: 560]
                [cite_start]await AuditLog.create({ // [cite: 561]
                    [cite_start]userId: req.user.userId, // [cite: 561]
                    [cite_start]username: req.user.username, // [cite: 561]
                    [cite_start]action: 'ELIMINÓ VENTA', // [cite: 561]
                    details: `Venta ID: ${saleIdForLog} eliminada. [cite_start]El stock de los productos ha sido restaurado.` // [cite: 561]
                });
            } catch (auditError) { console.error("Error al registrar en auditoría:", auditError); [cite_start]} // [cite: 562, 563]

            res.status(204).send(); [cite_start]// [cite: 563]
        } catch (error) {
            await t.rollback(); [cite_start]// [cite: 564]
            console.error('Error al eliminar venta:', error); [cite_start]// [cite: 565]
            res.status(500).json({ message: 'Error interno del servidor al eliminar la venta.' }); [cite_start]// [cite: 565]
        }
    });

    return router;
};

module.exports = initSalePaymentRoutes;
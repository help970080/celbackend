const express = require('express');
const router = express.Router();
const { Op, Sequelize } = require('sequelize');
const moment = require('moment-timezone');
const authMiddleware = require('../middleware/authMiddleware');
const authorizeRoles = require('../middleware/roleMiddleware'); // <-- Importar el nuevo middleware

let Sale, Client, Product, Payment, SaleItem;

const initSalePaymentRoutes = (models) => {
    Sale = models.Sale;
    Client = models.Client;
    Product = models.Product;
    Payment = models.Payment;
    SaleItem = models.SaleItem;

    // Todas las rutas de ventas/pagos requieren autenticación y rol específico
    router.get('/', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
        try {
            const { search, page, limit } = req.query;
            const whereClause = {};
            const includeClause = [
                { model: Client, as: 'client' },
                { model: SaleItem, as: 'saleItems', include: [{ model: Product, as: 'product' }] }
            ];

            if (search) {
                whereClause[Op.or] = [
                    { id: parseInt(search) || null },
                    { '$client.name$': { [Op.like]: `%${search}%` } },
                    { '$client.lastName$': { [Op.like]: `%${search}%` } },
                    { '$saleItems.product.name$': { [Op.like]: `%${search}%` } }
                ];
                includeClause[0].required = false;
                includeClause[1].required = false;
                includeClause[1].include[0].required = false;
            }

            const pageNum = parseInt(page, 10) || 1;
            const limitNum = parseInt(limit, 10) || 10;
            const offset = (pageNum - 1) * limitNum;

            const { count, rows } = await Sale.findAndCountAll({
                where: whereClause,
                include: includeClause,
                order: [['saleDate', 'DESC']],
                limit: limitNum,
                offset: offset
            });

            res.json({
                totalItems: count,
                totalPages: Math.ceil(count / limitNum),
                currentPage: pageNum,
                sales: rows
            });
        } catch (error) {
                console.error('Error al obtener ventas con búsqueda/paginación:', error);
                res.status(500).json({ message: 'Error interno del servidor al obtener ventas.' });
        }
    });

    router.get('/:id', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
        try {
            const sale = await Sale.findByPk(req.params.id, {
                include: [
                    { model: Client, as: 'client' },
                    { model: SaleItem, as: 'saleItems', include: [{ model: Product, as: 'product' }] },
                    { model: Payment, as: 'payments' }
                ]
            });
            if (!sale) {
                return res.status(404).json({ message: 'Venta no encontrada.' });
            }
            res.json(sale);
        } catch (error) {
            console.error('Error al obtener venta por ID:', error);
            res.status(500).json({ message: 'Error interno del servidor al obtener venta.' });
        }
    });

    router.post('/', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
        const { clientId, saleItems, isCredit, downPayment, interestRate, numberOfPayments } = req.body;
        
        if (!clientId || !saleItems || saleItems.length === 0) {
            return res.status(400).json({ message: 'Faltan datos obligatorios para la venta (cliente, productos).' });
        }

        const clientExists = await Client.findByPk(clientId);
        if (!clientExists) return res.status(404).json({ message: 'Cliente no encontrado.' });

        let totalAmountCalculated = 0;
        const createdSaleItems = [];

        try {
            for (const item of saleItems) {
                const product = await Product.findByPk(item.productId);
                if (!product) {
                    throw new Error(`Producto con ID ${item.productId} no encontrado.`);
                }
                if (product.stock < item.quantity) {
                    throw new Error(`Stock insuficiente para el producto ${product.name}. Disponible: ${product.stock}, Solicitado: ${item.quantity}.`);
                }
                
                const itemPrice = product.price * item.quantity;
                totalAmountCalculated += itemPrice;
                createdSaleItems.push({
                    productId: item.productId,
                    quantity: item.quantity,
                    priceAtSale: product.price
                });

                product.stock -= item.quantity;
                await product.save();
            }

            let saleData = {
                clientId,
                totalAmount: parseFloat(totalAmountCalculated.toFixed(2)),
                isCredit: isCredit || false,
                downPayment: isCredit ? (downPayment || 0) : parseFloat(totalAmountCalculated.toFixed(2)),
                status: isCredit ? 'pending_credit' : 'completed'
            };

            if (isCredit) {
                if (parseInt(numberOfPayments, 10) !== 17) {
                    for (const item of createdSaleItems) {
                        const product = await Product.findByPk(item.productId);
                        if (product) {
                            product.stock += item.quantity;
                            await product.save();
                        }
                    }
                    return res.status(400).json({ message: 'Para ventas a crédito, el número de pagos debe ser 17.' });
                }

                if (!downPayment || parseFloat(downPayment) < 0) {
                     for (const item of createdSaleItems) {
                        const product = await Product.findByPk(item.productId);
                        if (product) {
                            product.stock += item.quantity;
                            await product.save();
                        }
                    }
                    return res.status(400).json({ message: 'El enganche es obligatorio y debe ser un valor positivo para ventas a crédito.' });
                }
                if (parseFloat(downPayment || 0) > totalAmountCalculated) {
                     for (const item of createdSaleItems) {
                        const product = await Product.findByPk(item.productId);
                        if (product) {
                            product.stock += item.quantity;
                            await product.save();
                        }
                    }
                    return res.status(400).json({ message: 'El enganche no puede ser mayor al monto total de la venta.' });
                }

                const balance = totalAmountCalculated - parseFloat(downPayment || 0);
                const weeklyPayment = balance / 17;

                saleData.interestRate = interestRate || 0;
                saleData.numberOfPayments = 17;
                saleData.weeklyPaymentAmount = parseFloat(weeklyPayment.toFixed(2));
                saleData.balanceDue = parseFloat(balance.toFixed(2));
            } else {
                saleData.balanceDue = 0;
                saleData.downPayment = parseFloat(totalAmountCalculated.toFixed(2));
                saleData.interestRate = 0;
                saleData.numberOfPayments = 0;
                saleData.weeklyPaymentAmount = 0;
            }

            const newSale = await Sale.create(saleData);

            for (const item of createdSaleItems) {
                await SaleItem.create({
                    saleId: newSale.id,
                    productId: item.productId,
                    quantity: item.quantity,
                    priceAtSale: item.priceAtSale
                });
            }

            const fullNewSale = await Sale.findByPk(newSale.id, {
                include: [{ model: SaleItem, as: 'saleItems', include: [{ model: Product, as: 'product' }] }]
            });

            res.status(201).json(fullNewSale);

        } catch (error) {
            console.error('Error al crear venta (con reversión de stock):', error);
            for (const item of createdSaleItems) {
                const product = await Product.findByPk(item.productId);
                if (product) {
                    product.stock += item.quantity;
                    await product.save();
                }
            }
            res.status(500).json({ message: error.message || 'Error interno del servidor al crear venta.' });
        }
    });

    router.put('/:id', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
        const { status, totalAmount, downPayment, interestRate, numberOfPayments, weeklyPaymentAmount } = req.body;
        try {
            const sale = await Sale.findByPk(req.params.id);
            if (!sale) {
                return res.status(404).json({ message: 'Venta no encontrada.' });
            }

            if (status) sale.status = status;
            if (totalAmount !== undefined) sale.totalAmount = totalAmount;
            if (downPayment !== undefined) sale.downPayment = downPayment;
            if (interestRate !== undefined) sale.interestRate = interestRate;
            if (numberOfPayments !== undefined) sale.numberOfPayments = numberOfPayments;
            if (weeklyPaymentAmount !== undefined) sale.weeklyPaymentAmount = weeklyPaymentAmount;


            if (sale.isCredit) {
                const currentTotalAmount = totalAmount !== undefined ? totalAmount : sale.totalAmount;
                const currentDownPayment = downPayment !== undefined ? downPayment : sale.downPayment;

                const balance = currentTotalAmount - currentDownPayment;
                sale.balanceDue = parseFloat(balance.toFixed(2));

                if (sale.numberOfPayments === 17) {
                    sale.weeklyPaymentAmount = parseFloat((balance / 17).toFixed(2));
                }
                if (sale.balanceDue <= 0 && sale.isCredit && sale.status !== 'paid_off') {
                    sale.status = 'paid_off';
                }
            } else {
                sale.balanceDue = 0;
                sale.status = 'completed';
                sale.downPayment = totalAmount !== undefined ? totalAmount : sale.totalAmount;
                sale.interestRate = 0;
                sale.numberOfPayments = 0;
                sale.weeklyPaymentAmount = 0;
            }


            await sale.save();
            res.json(sale);
        } catch (error) {
            console.error('Error al actualizar venta:', error);
            res.status(500).json({ message: 'Error interno del servidor al actualizar venta.' });
        }
    });

    router.delete('/:id', authMiddleware, authorizeRoles(['super_admin']), async (req, res) => { // Solo super_admin puede eliminar
        try {
            const sale = await Sale.findByPk(req.params.id, { include: [{ model: SaleItem, as: 'saleItems' }] });
            if (!sale) {
                return res.status(404).json({ message: 'Venta no encontrada.' });
            }

            for (const item of sale.saleItems) {
                const product = await Product.findByPk(item.productId);
                if (product) {
                    product.stock += item.quantity;
                    await product.save();
                }
            }

            const deletedRows = await Sale.destroy({
                where: { id: req.params.id }
            });
            if (deletedRows === 0) {
                return res.status(404).json({ message: 'Venta no encontrada.' });
            }
            res.status(204).send();
        } catch (error) {
            console.error('Error al eliminar venta:', error);
            res.status(500).json({ message: 'Error interno del servidor al eliminar venta.' });
        }
    });

    router.post('/:saleId/payments', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
        const { amount, paymentMethod, notes } = req.body;
        const { saleId } = req.params;

        if (!amount || !saleId) {
            return res.status(400).json({ message: 'Faltan datos obligatorios para el pago (monto, ID de venta).' });
        }

        try {
            const sale = await Sale.findByPk(saleId);
            if (!sale) {
                return res.status(404).json({ message: 'Venta no encontrada.' });
            }
            if (!sale.isCredit) {
                return res.status(400).json({ message: 'No se pueden registrar pagos en una venta al contado.' });
            }
            if (sale.balanceDue <= 0) {
                return res.status(400).json({ message: 'Esta venta ya no tiene saldo pendiente.' });
            }
            if (amount <= 0) {
                return res.status(400).json({ message: 'El monto del pago debe ser mayor a cero.' });
            }

            const newPayment = await Payment.create({
                saleId,
                amount,
                paymentMethod: paymentMethod || 'cash',
                notes
            });

            sale.balanceDue = parseFloat((sale.balanceDue - amount).toFixed(2));

            if (sale.balanceDue <= 0) {
                sale.status = 'paid_off';
                sale.balanceDue = 0;
                console.log(`Venta ${sale.id} ha sido pagada completamente.`);
            } else if (sale.status === 'paid_off' && sale.balanceDue > 0) {
                sale.status = 'pending_credit';
            }


            await sale.save();

            res.status(201).json(newPayment);
        } catch (error) {
            console.error('Error al registrar pago:', error);
            res.status(500).json({ message: 'Error interno del servidor al registrar pago.' });
        }
    });

    router.get('/:saleId/payments', authMiddleware, authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']), async (req, res) => {
        try {
            const payments = await Payment.findAll({
                where: { saleId: req.params.saleId },
                order: [['paymentDate', 'ASC']]
            });
            res.json(payments);
        } catch (error) {
            console.error('Error al obtener pagos de venta:', error);
            res.status(500).json({ message: 'Error interno del servidor al obtener pagos.' });
        }
    });


    return router;
};

module.exports = initSalePaymentRoutes;
// src/backend/models/index.js (Archivo Corregido)
const UserModel = require('./User');
const ClientModel = require('./Client');
const ProductModel = require('./Product');
const SaleModel = require('./Sale');
const PaymentModel = require('./Payment');
const SaleItemModel = require('./SaleItem');

module.exports = (sequelize) => {
    const User = UserModel(sequelize);
    const Client = ClientModel(sequelize);
    const Product = ProductModel(sequelize);
    const Sale = SaleModel(sequelize);
    const Payment = PaymentModel(sequelize);
    const SaleItem = SaleItemModel(sequelize);

    // --- Definir asociaciones existentes ---
    Sale.belongsTo(Client, { foreignKey: 'clientId', as: 'client' });
    Client.hasMany(Sale, { foreignKey: 'clientId', as: 'sales' });

    Sale.hasMany(SaleItem, { foreignKey: 'saleId', as: 'saleItems', onDelete: 'CASCADE' });
    SaleItem.belongsTo(Sale, { foreignKey: 'saleId' }); // as 'sale' es opcional aquí si no lo usas
    SaleItem.belongsTo(Product, { foreignKey: 'productId', as: 'product' });
    Product.hasMany(SaleItem, { foreignKey: 'productId' }); // as 'saleItems' es opcional

    Sale.hasMany(Payment, { foreignKey: 'saleId', as: 'payments', onDelete: 'CASCADE' });
    Payment.belongsTo(Sale, { foreignKey: 'saleId', as: 'sale' });

    // --- INICIO DE LA ASOCIACIÓN AÑADIDA ---
    // Esta es la relación que faltaba para el módulo de cobranza.
    
    // Una Venta puede ser asignada a un Usuario (el gestor).
    Sale.belongsTo(User, {
      foreignKey: 'assignedCollectorId',
      as: 'assignedCollector', // Este alias es crucial y debe coincidir con el usado en las rutas.
      constraints: false
    });

    // Un Usuario (gestor) puede tener muchas Ventas asignadas.
    User.hasMany(Sale, {
      foreignKey: 'assignedCollectorId',
      as: 'assignedSales'
    });
    // --- FIN DE LA ASOCIACIÓN AÑADIDA ---

    return {
        User,
        Client,
        Product,
        Sale,
        Payment,
        SaleItem,
    };
};
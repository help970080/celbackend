const UserModel = require('./User');
const ClientModel = require('./Client');
const ProductModel = require('./Product');
const SaleModel = require('./Sale');
const PaymentModel = require('./Payment');
const SaleItemModel = require('./SaleItem');
const AuditLogModel = require('./AuditLog'); // <-- AÑADIR IMPORTACIÓN

module.exports = (sequelize) => {
    const User = UserModel(sequelize);
    const Client = ClientModel(sequelize);
    const Product = ProductModel(sequelize);
    const Sale = SaleModel(sequelize);
    const Payment = PaymentModel(sequelize);
    const SaleItem = SaleItemModel(sequelize);
    const AuditLog = AuditLogModel(sequelize); // <-- AÑADIR INICIALIZACIÓN

    // --- ASOCIACIONES DEFINITIVAS ---
    Sale.belongsTo(Client, { foreignKey: 'clientId', as: 'client' });
    Client.hasMany(Sale, { foreignKey: 'clientId', as: 'sales' });

    Sale.belongsTo(User, { foreignKey: 'assignedCollectorId', as: 'assignedCollector' });
    User.hasMany(Sale, { foreignKey: 'assignedCollectorId', as: 'assignedSales' });
    
    Sale.hasMany(SaleItem, { foreignKey: 'saleId', as: 'saleItems', onDelete: 'CASCADE' });
    SaleItem.belongsTo(Sale, { foreignKey: 'saleId' });
    
    SaleItem.belongsTo(Product, { foreignKey: 'productId', as: 'product' });
    Product.hasMany(SaleItem, { foreignKey: 'productId' });

    Sale.hasMany(Payment, { foreignKey: 'saleId', as: 'payments', onDelete: 'CASCADE' });
    Payment.belongsTo(Sale, { foreignKey: 'saleId', as: 'sale' });

    // --- NUEVA ASOCIACIÓN PARA AUDITORÍA ---
    // Si un usuario es eliminado, su ID en los logs se vuelve NULO pero el log se conserva.
    AuditLog.belongsTo(User, { foreignKey: 'userId', onDelete: 'SET NULL' });

    return { User, Client, Product, Sale, Payment, SaleItem, AuditLog }; // <-- AÑADIR AuditLog
};
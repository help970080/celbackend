const UserModel = require('./User');
const ClientModel = require('./Client');
const ProductModel = require('./Product');
const SaleModel = require('./Sale');
const PaymentModel = require('./Payment');
const SaleItemModel = require('./SaleItem');
const AuditLogModel = require('./AuditLog');
const StoreModel = require('./Store');

module.exports = (sequelize) => {
    const User = UserModel(sequelize);
    const Client = ClientModel(sequelize);
    const Product = ProductModel(sequelize);
    const Sale = SaleModel(sequelize);
    const Payment = PaymentModel(sequelize);
    const SaleItem = SaleItemModel(sequelize);
    const AuditLog = AuditLogModel(sequelize);
    const Store = StoreModel(sequelize);

    // --- ASOCIACIONES CON STORE ---
    Store.hasMany(User, { foreignKey: 'tiendaId', as: 'users' });
    User.belongsTo(Store, { foreignKey: 'tiendaId', as: 'store' });

    Store.hasMany(Client, { foreignKey: 'tiendaId', as: 'clients' });
    Client.belongsTo(Store, { foreignKey: 'tiendaId', as: 'store' });

    Store.hasMany(Product, { foreignKey: 'tiendaId', as: 'products' });
    Product.belongsTo(Store, { foreignKey: 'tiendaId', as: 'store' });

    Store.hasMany(Sale, { foreignKey: 'tiendaId', as: 'sales' });
    Sale.belongsTo(Store, { foreignKey: 'tiendaId', as: 'store' });

    Store.hasMany(Payment, { foreignKey: 'tiendaId', as: 'payments' });
    Payment.belongsTo(Store, { foreignKey: 'tiendaId', as: 'store' });

    Store.hasMany(AuditLog, { foreignKey: 'tiendaId', as: 'auditLogs' });
    AuditLog.belongsTo(Store, { foreignKey: 'tiendaId', as: 'store' });

    // --- ASOCIACIONES EXISTENTES ---
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

    AuditLog.belongsTo(User, { foreignKey: 'userId', onDelete: 'SET NULL' });

    return { User, Client, Product, Sale, Payment, SaleItem, AuditLog, Store };
};
// models/index.js - CON INTEGRACIÓN MDM

const UserModel = require('./User');
const ClientModel = require('./Client');
const ProductModel = require('./Product');
const SaleModel = require('./Sale');
const PaymentModel = require('./Payment');
const SaleItemModel = require('./SaleItem');
const AuditLogModel = require('./AuditLog');
const StoreModel = require('./Store');
const CollectionLogModel = require('./CollectionLog');
const DeviceMdmModel = require('./DeviceMdm'); // ⭐ MDM AGREGADO

module.exports = (sequelize) => {
    const User = UserModel(sequelize);
    const Client = ClientModel(sequelize);
    const Product = ProductModel(sequelize);
    const Sale = SaleModel(sequelize);
    const Payment = PaymentModel(sequelize);
    const SaleItem = SaleItemModel(sequelize);
    const AuditLog = AuditLogModel(sequelize);
    const Store = StoreModel(sequelize);
    const CollectionLog = CollectionLogModel(sequelize);
    const DeviceMdm = DeviceMdmModel(sequelize); // ⭐ MDM AGREGADO

    // =========================================================
    // ASOCIACIONES CON STORE (Multi-Tenant)
    // =========================================================
    Store.hasMany(User, { foreignKey: 'tienda_id', as: 'users' });
    User.belongsTo(Store, { foreignKey: 'tienda_id', as: 'store' });

    Store.hasMany(Client, { foreignKey: 'tienda_id', as: 'clients' });
    Client.belongsTo(Store, { foreignKey: 'tienda_id', as: 'store' });

    Store.hasMany(Product, { foreignKey: 'tienda_id', as: 'products' });
    Product.belongsTo(Store, { foreignKey: 'tienda_id', as: 'store' });

    Store.hasMany(Sale, { foreignKey: 'tienda_id', as: 'sales' });
    Sale.belongsTo(Store, { foreignKey: 'tienda_id', as: 'store' });

    Store.hasMany(Payment, { foreignKey: 'tienda_id', as: 'payments' });
    Payment.belongsTo(Store, { foreignKey: 'tienda_id', as: 'store' });

    Store.hasMany(AuditLog, { foreignKey: 'tienda_id', as: 'auditLogs' });
    AuditLog.belongsTo(Store, { foreignKey: 'tienda_id', as: 'store' });

    // ⭐ MDM - Asociación con Store (Multi-Tenant)
    Store.hasMany(DeviceMdm, { foreignKey: 'tienda_id', as: 'devices' });
    DeviceMdm.belongsTo(Store, { foreignKey: 'tienda_id', as: 'store' });

    // =========================================================
    // ASOCIACIONES DE VENTAS Y CLIENTES
    // =========================================================
    Sale.belongsTo(Client, { foreignKey: 'clientId', as: 'client' });
    Client.hasMany(Sale, { foreignKey: 'clientId', as: 'sales' });

    Sale.belongsTo(User, { foreignKey: 'assignedCollectorId', as: 'assignedCollector' });
    User.hasMany(Sale, { foreignKey: 'assignedCollectorId', as: 'assignedSales' });
    
    // =========================================================
    // ASOCIACIONES DE SALE ITEMS
    // =========================================================
    Sale.hasMany(SaleItem, { foreignKey: 'saleId', as: 'saleItems', onDelete: 'CASCADE' });
    SaleItem.belongsTo(Sale, { foreignKey: 'saleId' });
    
    SaleItem.belongsTo(Product, { foreignKey: 'productId', as: 'product' });
    Product.hasMany(SaleItem, { foreignKey: 'productId' });

    // =========================================================
    // ASOCIACIONES DE PAGOS
    // =========================================================
    Sale.hasMany(Payment, { foreignKey: 'saleId', as: 'payments', onDelete: 'CASCADE' });
    Payment.belongsTo(Sale, { foreignKey: 'saleId', as: 'sale' });

    // =========================================================
    // ASOCIACIONES DE AUDITORÍA
    // =========================================================
    AuditLog.belongsTo(User, { foreignKey: 'userId', onDelete: 'SET NULL' });

    // =========================================================
    // ASOCIACIONES DE COLLECTION LOG (GESTIÓN DE COBRANZA)
    // =========================================================
    Sale.hasMany(CollectionLog, { 
        foreignKey: 'saleId', 
        as: 'collectionLogs', 
        onDelete: 'CASCADE' 
    });
    CollectionLog.belongsTo(Sale, { 
        foreignKey: 'saleId', 
        as: 'sale' 
    });

    CollectionLog.belongsTo(User, { 
        foreignKey: 'collectorId', 
        as: 'collector' 
    });
    User.hasMany(CollectionLog, { 
        foreignKey: 'collectorId', 
        as: 'collectionLogs' 
    });

    // =========================================================
    // ⭐ ASOCIACIONES DE DEVICE MDM (BLOQUEO DE DISPOSITIVOS)
    // =========================================================
    // Relación Sale -> DeviceMdm (una venta tiene un dispositivo)
    Sale.hasOne(DeviceMdm, { 
        foreignKey: 'sale_id', 
        as: 'device' 
    });
    DeviceMdm.belongsTo(Sale, { 
        foreignKey: 'sale_id', 
        as: 'sale' 
    });

    // Relación Client -> DeviceMdm (un cliente puede tener varios dispositivos)
    Client.hasMany(DeviceMdm, { 
        foreignKey: 'client_id', 
        as: 'devices' 
    });
    DeviceMdm.belongsTo(Client, { 
        foreignKey: 'client_id', 
        as: 'client' 
    });

    // =========================================================
    // RETORNAR TODOS LOS MODELOS
    // =========================================================
    return { 
        User, 
        Client, 
        Product, 
        Sale, 
        Payment, 
        SaleItem, 
        AuditLog, 
        Store,
        CollectionLog,
        DeviceMdm // ⭐ MDM AGREGADO
    };
};

// models/index.js - CON INTEGRACIÓN MDM + TANDAS

const UserModel = require('./User');
const ClientModel = require('./Client');
const ProductModel = require('./Product');
const SaleModel = require('./Sale');
const PaymentModel = require('./Payment');
const SaleItemModel = require('./SaleItem');
const AuditLogModel = require('./AuditLog');
const StoreModel = require('./Store');
const CollectionLogModel = require('./CollectionLog');
const DeviceMdmModel = require('./DeviceMdm');
const MdmAccountModel = require('./MdmAccount');
// ⭐ TANDAS / CAJA DE AHORRO
const TandaModel = require('./Tanda');
const TandaParticipanteModel = require('./TandaParticipante');
const TandaAportacionModel = require('./TandaAportacion');
const ConfigFinancieraModel = require('./ConfigFinanciera');

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
    const DeviceMdm = DeviceMdmModel(sequelize);
    const MdmAccount = MdmAccountModel(sequelize);
    // ⭐ TANDAS
    const Tanda = TandaModel(sequelize);
    const TandaParticipante = TandaParticipanteModel(sequelize);
    const TandaAportacion = TandaAportacionModel(sequelize);
    const ConfigFinanciera = ConfigFinancieraModel(sequelize);

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

    // MDM - Asociación con Store (Multi-Tenant)
    Store.hasMany(DeviceMdm, { foreignKey: 'tienda_id', as: 'devices' });
    DeviceMdm.belongsTo(Store, { foreignKey: 'tienda_id', as: 'store' });

    // MdmAccount - Asociación con Store (opcional)
    Store.hasMany(MdmAccount, { foreignKey: 'tienda_id', as: 'mdmAccounts' });
    MdmAccount.belongsTo(Store, { foreignKey: 'tienda_id', as: 'store' });

    // ⭐ Tandas - Asociación con Store (Multi-Tenant)
    Store.hasMany(Tanda, { foreignKey: 'tienda_id', as: 'tandas' });
    Tanda.belongsTo(Store, { foreignKey: 'tienda_id', as: 'store' });

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
    // ASOCIACIONES DE DEVICE MDM (BLOQUEO DE DISPOSITIVOS)
    // =========================================================
    Sale.hasOne(DeviceMdm, { 
        foreignKey: 'sale_id', 
        as: 'device' 
    });
    DeviceMdm.belongsTo(Sale, { 
        foreignKey: 'sale_id', 
        as: 'sale' 
    });

    Client.hasMany(DeviceMdm, { 
        foreignKey: 'client_id', 
        as: 'devices' 
    });
    DeviceMdm.belongsTo(Client, { 
        foreignKey: 'client_id', 
        as: 'client' 
    });

    // DeviceMdm - Asociación con MdmAccount (qué cuenta lo gestiona)
    MdmAccount.hasMany(DeviceMdm, { 
        foreignKey: 'mdm_account_id', 
        as: 'devices' 
    });
    DeviceMdm.belongsTo(MdmAccount, { 
        foreignKey: 'mdm_account_id', 
        as: 'mdmAccount' 
    });

    // =========================================================
    // ⭐ ASOCIACIONES DE TANDAS / CAJA DE AHORRO
    // =========================================================
    
    // Tanda tiene muchos participantes
    Tanda.hasMany(TandaParticipante, { 
        foreignKey: 'tanda_id', 
        as: 'participantes',
        onDelete: 'CASCADE'
    });
    TandaParticipante.belongsTo(Tanda, { 
        foreignKey: 'tanda_id', 
        as: 'tanda' 
    });

    // Participante tiene muchas aportaciones
    TandaParticipante.hasMany(TandaAportacion, { 
        foreignKey: 'participante_id', 
        as: 'aportaciones',
        onDelete: 'CASCADE'
    });
    TandaAportacion.belongsTo(TandaParticipante, { 
        foreignKey: 'participante_id', 
        as: 'participante' 
    });

    // Aportación pertenece a una tanda (para queries directas)
    TandaAportacion.belongsTo(Tanda, { 
        foreignKey: 'tanda_id', 
        as: 'tanda' 
    });
    Tanda.hasMany(TandaAportacion, { 
        foreignKey: 'tanda_id', 
        as: 'aportaciones' 
    });

    // Participante puede estar vinculado a un usuario del sistema
    TandaParticipante.belongsTo(User, { 
        foreignKey: 'user_id', 
        as: 'usuario' 
    });
    User.hasMany(TandaParticipante, { 
        foreignKey: 'user_id', 
        as: 'participacionesTandas' 
    });

    // Tanda creada por un usuario
    Tanda.belongsTo(User, { 
        foreignKey: 'creado_por', 
        as: 'creador' 
    });

    // Aportación registrada por un usuario
    TandaAportacion.belongsTo(User, { 
        foreignKey: 'registrado_por', 
        as: 'registrador' 
    });

    // ConfigFinanciera por tienda o global
    ConfigFinanciera.belongsTo(Store, { 
        foreignKey: 'tienda_id', 
        as: 'store' 
    });
    ConfigFinanciera.belongsTo(User, { 
        foreignKey: 'actualizado_por', 
        as: 'actualizador' 
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
        DeviceMdm,
        MdmAccount,
        // ⭐ TANDAS
        Tanda,
        TandaParticipante,
        TandaAportacion,
        ConfigFinanciera
    };
};
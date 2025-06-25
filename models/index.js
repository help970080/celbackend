// src/backend/models/index.js (Versión Completa y Corregida)
const UserModel = require('./User');
const ClientModel = require('./Client');
const ProductModel = require('./Product');
const SaleModel = require('./Sale');
const PaymentModel = require('./Payment');
const SaleItemModel = require('./SaleItem');

module.exports = (sequelize) => {
    // Inicialización de todos los modelos
    const User = UserModel(sequelize);
    const Client = ClientModel(sequelize);
    const Product = ProductModel(sequelize);
    const Sale = SaleModel(sequelize);
    const Payment = PaymentModel(sequelize);
    const SaleItem = SaleItemModel(sequelize);

    // --- SECCIÓN DE ASOCIACIONES (RELACIONES) ---
    // Aquí definimos el "mapa" completo de cómo se conectan tus datos.

    // Relación Venta <-> Cliente
    Sale.belongsTo(Client, { foreignKey: 'clientId', as: 'client' });
    Client.hasMany(Sale, { foreignKey: 'clientId', as: 'sales' });

    // Relación Venta <-> Item de Venta
    Sale.hasMany(SaleItem, { foreignKey: 'saleId', as: 'saleItems', onDelete: 'CASCADE' });
    SaleItem.belongsTo(Sale, { foreignKey: 'saleId' });

    // Relación Item de Venta <-> Producto
    SaleItem.belongsTo(Product, { foreignKey: 'productId', as: 'product' });
    Product.hasMany(SaleItem, { foreignKey: 'productId' });

    // Relación Venta <-> Pago
    Sale.hasMany(Payment, { foreignKey: 'saleId', as: 'payments', onDelete: 'CASCADE' });
    Payment.belongsTo(Sale, { foreignKey: 'saleId', as: 'sale' });

    // Relación Venta <-> Usuario (Gestor de Cobranza) - ¡LA QUE FALTABA!
    Sale.belongsTo(User, {
      foreignKey: 'assignedCollectorId',
      as: 'assignedCollector', // Este alias es crucial
      constraints: false
    });
    User.hasMany(Sale, {
      foreignKey: 'assignedCollectorId',
      as: 'assignedSales'
    });
    
    // --- FIN DE ASOCIACIONES ---

    // Exportamos todos los modelos para que el resto de la aplicación los use
    return {
        User,
        Client,
        Product,
        Sale,
        Payment,
        SaleItem,
    };
};
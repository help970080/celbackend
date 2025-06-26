const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const SaleItem = sequelize.define('SaleItem', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        quantity: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 1
        },
        // --- CORRECCIÓN CLAVE ---
        // Se define explícitamente que el precio es obligatorio.
        priceAtSale: {
            type: DataTypes.FLOAT,
            allowNull: false
        }
    }, {
        tableName: 'sale_items',
        timestamps: true
    });

    return SaleItem;
};
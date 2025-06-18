const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const SaleItem = sequelize.define('SaleItem', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
            allowNull: false
        },
        quantity: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 1
        },
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
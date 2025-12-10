const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const Product = sequelize.define('Product', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
            allowNull: false
        },
        name: {
            type: DataTypes.STRING,
            allowNull: false
        },
        description: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        price: {
            type: DataTypes.FLOAT,
            allowNull: false
        },
        stock: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0
        },
        imageUrls: {
            type: DataTypes.JSON,
            allowNull: true,
            defaultValue: []
        },
        category: {
            type: DataTypes.STRING,
            allowNull: true
        },
        brand: {
            type: DataTypes.STRING,
            allowNull: true
        },
        tiendaId: {
            type: DataTypes.INTEGER,
            allowNull: false,
            field: 'tienda_id',
            defaultValue: 1
        }
    }, {
        tableName: 'products',
        timestamps: true
    });

    return Product;
};
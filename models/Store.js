// models/Store.js - CORREGIDO SIN UNDERSCORED

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const Store = sequelize.define('Store', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        name: {
            type: DataTypes.STRING,
            allowNull: false
        },
        address: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        phone: {
            type: DataTypes.STRING,
            allowNull: true
        },
        email: {
            type: DataTypes.STRING,
            allowNull: true,
            validate: {
                isEmail: true
            }
        },
        depositInfo: {
            type: DataTypes.TEXT,
            allowNull: true,
            field: 'deposit_info' // ⭐ Solo este campo usa snake_case
        },
        isActive: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
            field: 'is_active' // ⭐ Solo este campo usa snake_case
        }
    }, {
        tableName: 'stores',
        timestamps: true
        // ❌ SIN underscored - tu BD usa createdAt/updatedAt en camelCase
    });

    return Store;
};
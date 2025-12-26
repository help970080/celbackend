// models/Store.js - CORREGIDO PARA POSTGRESQL (snake_case)

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
            field: 'deposit_info' // ⭐ Mapeo a snake_case en BD
        },
        isActive: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
            field: 'is_active' // ⭐ Mapeo a snake_case en BD
        }
    }, {
        tableName: 'stores',
        timestamps: true,
        underscored: true // ⭐ Esto hace que createdAt → created_at, etc.
    });

    return Store;
};
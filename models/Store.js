// models/Store.js - CON CAMPO depositInfo PARA MULTI-TENANT

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
            allowNull: false,
            comment: 'Nombre de la tienda'
        },
        address: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'Dirección física de la tienda'
        },
        phone: {
            type: DataTypes.STRING,
            allowNull: true,
            comment: 'Teléfono de contacto'
        },
        email: {
            type: DataTypes.STRING,
            allowNull: true,
            validate: {
                isEmail: true
            },
            comment: 'Correo electrónico de la tienda'
        },
        depositInfo: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'Información de cuenta para depósitos (OXXO, banco, CLABE, etc.)'
        },
        isActive: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
            comment: 'Indica si la tienda está activa'
        }
    }, {
        tableName: 'stores',
        timestamps: true
    });

    return Store;
};
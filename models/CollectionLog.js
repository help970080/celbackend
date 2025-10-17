// models/CollectionLog.js

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const CollectionLog = sequelize.define('CollectionLog', {
        id: { 
            type: DataTypes.INTEGER, 
            primaryKey: true, 
            autoIncrement: true 
        },
        saleId: { 
            type: DataTypes.INTEGER, 
            allowNull: false, 
            references: { model: 'sales', key: 'id' } 
        },
        collectorId: { 
            type: DataTypes.INTEGER, 
            allowNull: false, 
            references: { model: 'Usuarios', key: 'id' } 
        },
        result: { 
            type: DataTypes.STRING, 
            allowNull: false // Ej: PROMISE, NO_ANSWER, PAID, etc.
        }, 
        notes: { 
            type: DataTypes.TEXT, 
            allowNull: true 
        },
        date: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW
        },
        nextActionDate: { 
            type: DataTypes.DATEONLY, 
            allowNull: true // Fecha para el próximo seguimiento
        },
    }, {
        tableName: 'collection_logs',
        timestamps: true
    });
    
    return CollectionLog;
};
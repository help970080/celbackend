// models/CollectionLog.js - VERSIÓN MEJORADA CON MULTI-TENANT

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
            field: 'saleId', // Mapeo explícito
            references: { 
                model: 'sales', 
                key: 'id' 
            } 
        },
        collectorId: { 
            type: DataTypes.INTEGER, 
            allowNull: false,
            field: 'collectorId', // Mapeo explícito
            references: { 
                model: 'Users', 
                key: 'id' 
            } 
        },
        result: { 
            type: DataTypes.STRING, 
            allowNull: false,
            comment: 'Resultado de la gestión: PROMISE, NO_ANSWER, PAID, REFUSED, etc.'
        }, 
        notes: { 
            type: DataTypes.TEXT, 
            allowNull: true,
            comment: 'Notas adicionales de la gestión'
        },
        date: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW,
            comment: 'Fecha y hora de la gestión'
        },
        nextActionDate: { 
            type: DataTypes.DATEONLY, 
            allowNull: true,
            comment: 'Fecha programada para el próximo seguimiento'
        },
        // ⭐ AGREGADO: tiendaId para multi-tenant
        tiendaId: {
            type: DataTypes.INTEGER,
            allowNull: false,
            field: 'tienda_id',
            defaultValue: 1,
            comment: 'ID de la tienda (multi-tenant)'
        }
    }, {
        tableName: 'collection_logs',
        timestamps: true,
        indexes: [
            {
                fields: ['saleId']
            },
            {
                fields: ['collectorId']
            },
            {
                fields: ['tienda_id'] // ⭐ Índice para optimizar consultas multi-tenant
            },
            {
                fields: ['date']
            }
        ]
    });
    
    return CollectionLog;
};
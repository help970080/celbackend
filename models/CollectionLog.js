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
            field: 'sale_id',
            references: {
                model: 'sales',
                key: 'id'
            }
        },
        collectorId: {
            type: DataTypes.INTEGER,
            allowNull: false,
            field: 'collector_id',
            references: {
                model: 'users',
                key: 'id'
            }
        },
        contactType: {
            type: DataTypes.STRING(50),
            allowNull: false,
            field: 'contact_type'
        },
        contactResult: {
            type: DataTypes.STRING(100),
            allowNull: true,
            field: 'contact_result'
        },
        notes: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        nextContactDate: {
            type: DataTypes.DATE,
            allowNull: true,
            field: 'next_contact_date'
        },
        createdAt: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW,
            field: 'created_at'
        },
        updatedAt: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW,
            field: 'updated_at'
        }
    }, {
        tableName: 'collection_logs',
        timestamps: true,
        underscored: true
    });

    return CollectionLog;
};
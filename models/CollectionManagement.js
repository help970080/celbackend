// models/CollectionManagement.js - VERSIÓN SIMPLIFICADA

module.exports = (sequelize, DataTypes) => {
    const CollectionManagement = sequelize.define('CollectionManagement', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        clientId: {
            type: DataTypes.INTEGER,
            allowNull: false,
            field: 'client_id'
        },
        userId: {
            type: DataTypes.INTEGER,
            allowNull: false,
            field: 'user_id'
        },
        tiendaId: {
            type: DataTypes.INTEGER,
            allowNull: false,
            field: 'tienda_id'
        },
        managementType: {
            type: DataTypes.STRING(50),
            allowNull: false,
            defaultValue: 'phone_call',
            field: 'management_type'
        },
        result: {
            type: DataTypes.STRING(50),
            allowNull: false,
            field: 'result'
        },
        notes: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        nextActionDate: {
            type: DataTypes.DATE,
            allowNull: true,
            field: 'next_action_date'
        },
        amountPromised: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: true,
            field: 'amount_promised'
        }
    }, {
        tableName: 'collection_managements',
        timestamps: true,
        underscored: true
    });

    CollectionManagement.associate = (models) => {
        CollectionManagement.belongsTo(models.Client, {
            foreignKey: 'clientId',
            as: 'client'
        });
        CollectionManagement.belongsTo(models.User, {
            foreignKey: 'userId',
            as: 'user'
        });
    };

    return CollectionManagement;
};
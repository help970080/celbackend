// models/MdmAccount.js - Cuentas MDM ManageEngine (Simplificado)
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const MdmAccount = sequelize.define('MdmAccount', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        nombre: {
            type: DataTypes.STRING(100),
            allowNull: false
        },
        email: {
            type: DataTypes.STRING(150),
            allowNull: true
        },
        clientId: {
            type: DataTypes.TEXT,
            allowNull: false,
            field: 'client_id'
        },
        clientSecret: {
            type: DataTypes.TEXT,
            allowNull: false,
            field: 'client_secret'
        },
        refreshToken: {
            type: DataTypes.TEXT,
            allowNull: false,
            field: 'refresh_token'
        },
        accessToken: {
            type: DataTypes.TEXT,
            allowNull: true,
            field: 'access_token'
        },
        tokenExpiresAt: {
            type: DataTypes.DATE,
            allowNull: true,
            field: 'token_expires_at'
        },
        tiendaId: {
            type: DataTypes.INTEGER,
            allowNull: true,
            field: 'tienda_id'
        },
        activo: {
            type: DataTypes.BOOLEAN,
            defaultValue: true
        },
        lastStatus: {
            type: DataTypes.STRING(50),
            allowNull: true,
            field: 'last_status'
        },
        lastCheckedAt: {
            type: DataTypes.DATE,
            allowNull: true,
            field: 'last_checked_at'
        },
        deviceCount: {
            type: DataTypes.INTEGER,
            defaultValue: 0,
            field: 'device_count'
        },
        notas: {
            type: DataTypes.TEXT,
            allowNull: true
        }
    }, {
        tableName: 'mdm_accounts',
        timestamps: true,
        underscored: true
    });

    return MdmAccount;
};

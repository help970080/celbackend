// models/DeviceMdm.js - Modelo para dispositivos vinculados a ventas
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const DeviceMdm = sequelize.define('DeviceMdm', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        // Número/identificador del dispositivo en MDM
        deviceNumber: {
            type: DataTypes.STRING(100),
            allowNull: false,
            field: 'device_number'
        },
        // IMEI del dispositivo
        imei: {
            type: DataTypes.STRING(20),
            allowNull: true
        },
        // Número de serie
        serialNumber: {
            type: DataTypes.STRING(50),
            allowNull: true,
            field: 'serial_number'
        },
        // Marca del dispositivo
        brand: {
            type: DataTypes.STRING(50),
            allowNull: true
        },
        // Modelo del dispositivo
        model: {
            type: DataTypes.STRING(100),
            allowNull: true
        },
        // ID de la venta asociada
        saleId: {
            type: DataTypes.INTEGER,
            allowNull: true,
            field: 'sale_id',
            references: {
                model: 'sales',
                key: 'id'
            }
        },
        // ID del cliente asociado
        clientId: {
            type: DataTypes.INTEGER,
            allowNull: true,
            field: 'client_id',
            references: {
                model: 'clients',
                key: 'id'
            }
        },
        // Estado actual del dispositivo
        status: {
            type: DataTypes.ENUM('active', 'locked', 'wiped', 'returned', 'lost'),
            defaultValue: 'active'
        },
        // Fecha de último bloqueo
        lastLockedAt: {
            type: DataTypes.DATE,
            allowNull: true,
            field: 'last_locked_at'
        },
        // Fecha de último desbloqueo
        lastUnlockedAt: {
            type: DataTypes.DATE,
            allowNull: true,
            field: 'last_unlocked_at'
        },
        // Razón del último bloqueo
        lockReason: {
            type: DataTypes.STRING(255),
            allowNull: true,
            field: 'lock_reason'
        },
        // ID de configuración actual en MDM
        mdmConfigurationId: {
            type: DataTypes.INTEGER,
            allowNull: true,
            field: 'mdm_configuration_id'
        },
        // Última ubicación conocida
        lastLatitude: {
            type: DataTypes.DECIMAL(10, 8),
            allowNull: true,
            field: 'last_latitude'
        },
        lastLongitude: {
            type: DataTypes.DECIMAL(11, 8),
            allowNull: true,
            field: 'last_longitude'
        },
        lastLocationAt: {
            type: DataTypes.DATE,
            allowNull: true,
            field: 'last_location_at'
        },
        // Notas adicionales
        notes: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        // Multi-tenant
        tiendaId: {
            type: DataTypes.INTEGER,
            allowNull: false,
            field: 'tienda_id',
            references: {
                model: 'stores',
                key: 'id'
            }
        }
    }, {
        tableName: 'devices_mdm',
        timestamps: true,
        underscored: true,
        indexes: [
            { fields: ['device_number'] },
            { fields: ['imei'] },
            { fields: ['sale_id'] },
            { fields: ['client_id'] },
            { fields: ['tienda_id'] },
            { fields: ['status'] }
        ]
    });

    return DeviceMdm;
};

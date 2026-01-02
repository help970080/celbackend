// models/ConfigFinanciera.js - Configuración financiera para cálculo de techo
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const ConfigFinanciera = sequelize.define('ConfigFinanciera', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        tiendaId: {
            type: DataTypes.INTEGER,
            allowNull: true,
            field: 'tienda_id',
            comment: 'NULL = configuración global'
        },
        ingresoMensualPromedio: {
            type: DataTypes.DECIMAL(12, 2),
            allowNull: false,
            defaultValue: 0,
            field: 'ingreso_mensual_promedio'
        },
        liquidezDisponible: {
            type: DataTypes.DECIMAL(12, 2),
            allowNull: false,
            defaultValue: 0,
            field: 'liquidez_disponible',
            comment: 'Efectivo + cuentas por cobrar 30 días'
        },
        porcentajeTecho: {
            type: DataTypes.DECIMAL(5, 2),
            allowNull: false,
            defaultValue: 70.00,
            field: 'porcentaje_techo',
            comment: 'Porcentaje máximo de liquidez para compromisos'
        },
        alertaAdvertencia: {
            type: DataTypes.DECIMAL(5, 2),
            allowNull: false,
            defaultValue: 70.00,
            field: 'alerta_advertencia',
            comment: 'Porcentaje para alerta amarilla'
        },
        alertaCritica: {
            type: DataTypes.DECIMAL(5, 2),
            allowNull: false,
            defaultValue: 90.00,
            field: 'alerta_critica',
            comment: 'Porcentaje para alerta roja'
        },
        actualizadoPor: {
            type: DataTypes.INTEGER,
            allowNull: true,
            field: 'actualizado_por'
        },
        ultimaActualizacion: {
            type: DataTypes.DATE,
            allowNull: true,
            field: 'ultima_actualizacion'
        },
        notas: {
            type: DataTypes.TEXT,
            allowNull: true
        }
    }, {
        tableName: 'config_financiera',
        timestamps: true,
        underscored: true
    });

    return ConfigFinanciera;
};

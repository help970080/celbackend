// models/TandaAportacion.js - Registro de aportaciones
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const TandaAportacion = sequelize.define('TandaAportacion', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        tandaId: {
            type: DataTypes.INTEGER,
            allowNull: false,
            field: 'tanda_id'
        },
        participanteId: {
            type: DataTypes.INTEGER,
            allowNull: false,
            field: 'participante_id'
        },
        monto: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false
        },
        numPeriodo: {
            type: DataTypes.INTEGER,
            allowNull: false,
            field: 'num_periodo',
            comment: 'Número de quincena/semana/mes'
        },
        fechaPago: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW,
            field: 'fecha_pago'
        },
        metodoPago: {
            type: DataTypes.ENUM('efectivo', 'transferencia', 'tarjeta', 'descuento_nomina'),
            allowNull: false,
            defaultValue: 'efectivo',
            field: 'metodo_pago'
        },
        reciboFolio: {
            type: DataTypes.STRING(50),
            allowNull: true,
            field: 'recibo_folio'
        },
        comprobante: {
            type: DataTypes.STRING(255),
            allowNull: true,
            comment: 'URL de imagen de comprobante'
        },
        registradoPor: {
            type: DataTypes.INTEGER,
            allowNull: true,
            field: 'registrado_por'
        },
        notas: {
            type: DataTypes.TEXT,
            allowNull: true
        }
    }, {
        tableName: 'tanda_aportaciones',
        timestamps: true,
        underscored: true
    });

    return TandaAportacion;
};

// models/Tanda.js - Modelo de Tandas/Caja de Ahorro
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const Tanda = sequelize.define('Tanda', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        nombre: {
            type: DataTypes.STRING(100),
            allowNull: false
        },
        descripcion: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        montoTurno: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
            field: 'monto_turno',
            comment: 'Monto total que recibe cada participante en su turno'
        },
        aportacion: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
            comment: 'Monto que aporta cada participante por período'
        },
        numParticipantes: {
            type: DataTypes.INTEGER,
            allowNull: false,
            field: 'num_participantes'
        },
        frecuencia: {
            type: DataTypes.ENUM('semanal', 'quincenal', 'mensual'),
            allowNull: false,
            defaultValue: 'quincenal'
        },
        fechaInicio: {
            type: DataTypes.DATEONLY,
            allowNull: false,
            field: 'fecha_inicio'
        },
        fechaFin: {
            type: DataTypes.DATEONLY,
            allowNull: true,
            field: 'fecha_fin'
        },
        estado: {
            type: DataTypes.ENUM('activa', 'completada', 'cancelada', 'pausada'),
            allowNull: false,
            defaultValue: 'activa'
        },
        periodoActual: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 1,
            field: 'periodo_actual',
            comment: 'Número de período/quincena actual'
        },
        notas: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        tiendaId: {
            type: DataTypes.INTEGER,
            allowNull: false,
            field: 'tienda_id'
        },
        creadoPor: {
            type: DataTypes.INTEGER,
            allowNull: true,
            field: 'creado_por'
        }
    }, {
        tableName: 'tandas',
        timestamps: true,
        underscored: true
    });

    return Tanda;
};

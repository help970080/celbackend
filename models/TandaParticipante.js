// models/TandaParticipante.js - Participantes de cada tanda
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const TandaParticipante = sequelize.define('TandaParticipante', {
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
        // Puede ser colaborador interno o externo
        nombre: {
            type: DataTypes.STRING(100),
            allowNull: false
        },
        telefono: {
            type: DataTypes.STRING(20),
            allowNull: true
        },
        email: {
            type: DataTypes.STRING(100),
            allowNull: true
        },
        // Si es colaborador interno, enlazar con User
        userId: {
            type: DataTypes.INTEGER,
            allowNull: true,
            field: 'user_id'
        },
        numTurno: {
            type: DataTypes.INTEGER,
            allowNull: false,
            field: 'num_turno',
            comment: 'Número de turno asignado (1, 2, 3...)'
        },
        fechaEntregaEstimada: {
            type: DataTypes.DATEONLY,
            allowNull: true,
            field: 'fecha_entrega_estimada'
        },
        entregaRealizada: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
            field: 'entrega_realizada'
        },
        fechaEntregaReal: {
            type: DataTypes.DATE,
            allowNull: true,
            field: 'fecha_entrega_real'
        },
        montoEntregado: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: true,
            field: 'monto_entregado'
        },
        // Total acumulado de aportaciones
        totalAportado: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
            defaultValue: 0,
            field: 'total_aportado'
        },
        estado: {
            type: DataTypes.ENUM('activo', 'completado', 'retirado', 'moroso'),
            allowNull: false,
            defaultValue: 'activo'
        },
        notas: {
            type: DataTypes.TEXT,
            allowNull: true
        }
    }, {
        tableName: 'tanda_participantes',
        timestamps: true,
        underscored: true
    });

    return TandaParticipante;
};

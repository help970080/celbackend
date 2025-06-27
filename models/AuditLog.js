const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const AuditLog = sequelize.define('AuditLog', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        userId: { type: DataTypes.INTEGER, allowNull: true },
        username: { type: DataTypes.STRING, allowNull: true },
        action: { type: DataTypes.STRING, allowNull: false }, // Ej: "CREÓ CLIENTE", "REGISTRÓ PAGO"
        details: { type: DataTypes.TEXT, allowNull: true }, // Ej: "Cliente ID: 15", "Monto: $500 en Venta #3"
    }, {
        tableName: 'audit_logs',
        timestamps: true,
        updatedAt: false // No necesitamos 'updatedAt' para un log
    });
    return AuditLog;
};
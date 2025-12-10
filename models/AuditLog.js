const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const AuditLog = sequelize.define('AuditLog', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        userId: { type: DataTypes.INTEGER, allowNull: true },
        username: { type: DataTypes.STRING, allowNull: true },
        action: { type: DataTypes.STRING, allowNull: false },
        details: { type: DataTypes.TEXT, allowNull: true },
        tiendaId: {
            type: DataTypes.INTEGER,
            allowNull: false,
            field: 'tienda_id',
            defaultValue: 1
        }
    }, {
        tableName: 'audit_logs',
        timestamps: true,
        updatedAt: false
    });
    return AuditLog;
};
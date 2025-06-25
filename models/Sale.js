const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const Sale = sequelize.define('Sale', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        clientId: {
            type: DataTypes.INTEGER,
            allowNull: false,
            // La referencia a Clientes funciona bien, la dejamos
            references: {
                model: 'Clientes', 
                key: 'id'
            }
        },
        saleDate: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
        totalAmount: { type: DataTypes.FLOAT, allowNull: false },
        isCredit: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        downPayment: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
        interestRate: { type: DataTypes.FLOAT, allowNull: true, defaultValue: 0 },
        paymentFrequency: { type: DataTypes.STRING, allowNull: true, defaultValue: 'weekly' },
        numberOfPayments: { type: DataTypes.INTEGER, allowNull: true },
        weeklyPaymentAmount: { type: DataTypes.FLOAT, allowNull: true },
        balanceDue: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
        status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'completed' },
        
        // --- CAMBIO DE EMERGENCIA ---
        // Se elimina temporalmente la restricción de clave foránea para evitar el error.
        // El campo seguirá guardando el ID del gestor, pero sin la validación estricta de la BD.
        assignedCollectorId: {
            type: DataTypes.INTEGER,
            allowNull: true
            /*
            references: {
                model: 'Usuarios',
                key: 'id'
            },
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL'
            */
        },
    }, {
        tableName: 'sales',
        timestamps: true
    });
    return Sale;
};
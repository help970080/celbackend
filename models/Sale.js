const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const Sale = sequelize.define('Sale', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        clientId: {
            type: DataTypes.INTEGER,
            allowNull: false,
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
        
        // --- INICIO DE LA CORRECCIÓN ---
        // Se restaura la restricción de clave foránea para garantizar integridad de datos.
        assignedCollectorId: {
            type: DataTypes.INTEGER,
            allowNull: true,
            references: {
                model: 'Usuarios',
                key: 'id'
            },
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL'
        },
        // --- FIN DE LA CORRECCIÓN ---
    }, {
        tableName: 'sales',
        timestamps: true
    });
    return Sale;
};
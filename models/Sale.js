const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const Sale = sequelize.define('Sale', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
            allowNull: false
        },
        // --- CAMPO ESENCIAL AÑADIDO ---
        clientId: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: {
                model: 'clients', // Referencia explícita a la tabla 'clients'
                key: 'id'
            }
        },
        saleDate: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW
        },
        totalAmount: {
            type: DataTypes.FLOAT,
            allowNull: false
        },
        isCredit: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false
        },
        downPayment: {
            type: DataTypes.FLOAT,
            allowNull: false,
            defaultValue: 0
        },
        interestRate: {
            type: DataTypes.FLOAT,
            allowNull: true,
            defaultValue: 0
        },
        paymentFrequency: {
            type: DataTypes.STRING,
            allowNull: true,
            defaultValue: 'weekly'
        },
        numberOfPayments: {
            type: DataTypes.INTEGER,
            allowNull: true
        },
        weeklyPaymentAmount: {
            type: DataTypes.FLOAT,
            allowNull: true
        },
        balanceDue: {
            type: DataTypes.FLOAT,
            allowNull: false,
            defaultValue: 0
        },
        status: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: 'completed'
        },
        // --- CAMPO NUEVO PARA GESTIÓN DE COBRANZA AÑADIDO ---
        assignedCollectorId: {
            type: DataTypes.INTEGER,
            allowNull: true,
            references: {
                model: 'users', // Referencia explícita a la tabla 'users'
                key: 'id'
            },
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL'
        },
    }, {
        tableName: 'sales', // Nombre de tabla explícito
        timestamps: true
    });

    return Sale;
};
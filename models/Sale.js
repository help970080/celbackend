const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const Sale = sequelize.define('Sale', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
            allowNull: false
        },
        // --- CORRECCIÓN IMPORTANTE AÑADIDA ---
        // Este campo es esencial para saber a qué cliente pertenece la venta.
        clientId: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: {
                model: 'Clients', // Asegúrate que el nombre de tu tabla de Clientes sea 'Clients'
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
        weeklyPaymentAmount: { // Campo para el pago semanal calculado
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
        // --- CAMPO NUEVO PARA GESTIÓN DE COBRANZA ---
        assignedCollectorId: {
            type: DataTypes.INTEGER,
            allowNull: true, // Puede ser nulo si la venta no está asignada
            references: {
                model: 'Users', // Nombre de la tabla de Usuarios
                key: 'id'
            },
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL' // Si se elimina el gestor, la venta queda sin asignar
        },
    }, {
        tableName: 'sales',
        timestamps: true
    });

    return Sale;
};
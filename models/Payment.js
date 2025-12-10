const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const Payment = sequelize.define('Payment', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
            allowNull: false
        },
        paymentDate: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW
        },
        amount: {
            type: DataTypes.FLOAT,
            allowNull: false
        },
        paymentMethod: {
            type: DataTypes.STRING,
            allowNull: true
        },
        notes: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        tiendaId: {
            type: DataTypes.INTEGER,
            allowNull: false,
            field: 'tienda_id',
            defaultValue: 1
        }
    }, {
        tableName: 'payments',
        timestamps: true
    });

    return Payment;
};
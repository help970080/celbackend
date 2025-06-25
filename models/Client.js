const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const Client = sequelize.define('Client', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
            allowNull: false
        },
        name: {
            type: DataTypes.STRING,
            allowNull: false
        },
        lastName: {
            type: DataTypes.STRING,
            allowNull: false
        },
        phone: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true
        },
        email: {
            type: DataTypes.STRING,
            allowNull: true,
            unique: true,
            validate: {
                isEmail: true
            }
        },
        address: {
            type: DataTypes.STRING
        },
        city: {
            type: DataTypes.STRING
        },
        state: {
            type: DataTypes.STRING
        },
        zipCode: {
            type: DataTypes.STRING
        },
        identificationId: {
            type: DataTypes.STRING
        },
        notes: {
            type: DataTypes.TEXT
        }
    }, {
        // --- MODIFICACIÓN CLAVE ---
        // Se define explícitamente el nombre de la tabla para evitar errores.
        tableName: 'clients', 
        timestamps: true
    });

    return Client;
};
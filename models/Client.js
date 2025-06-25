const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const Client = sequelize.define('Client', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING, allowNull: false },
        lastName: { type: DataTypes.STRING, allowNull: false },
        phone: { type: DataTypes.STRING, allowNull: false, unique: true },
        email: { type: DataTypes.STRING, unique: true, allowNul: true, validate: { isEmail: true } },
        address: { type: DataTypes.STRING },
        city: { type: DataTypes.STRING },
        state: { type: DataTypes.STRING },
        zipCode: { type: DataTypes.STRING },
        identificationId: { type: DataTypes.STRING },
        notes: { type: DataTypes.TEXT },
    }, {
        tableName: 'Clientes', // Corrección final del nombre de la tabla
        timestamps: true
    });
    return Client;
};
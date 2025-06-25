const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const Client = sequelize.define('Client', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING, allowNull: false },
        lastName: { type: DataTypes.STRING, allowNull: false },
        phone: { type: DataTypes.STRING, allowNull: false, unique: true },
        email: { type: DataTypes.STRING, unique: true, validate: { isEmail: true } },
        address: DataTypes.STRING,
        city: DataTypes.STRING,
        state: DataTypes.STRING,
        zipCode: DataTypes.STRING,
        identificationId: DataTypes.STRING,
        notes: DataTypes.TEXT,
    }, {
        tableName: 'clients', // Se define explícitamente el nombre de la tabla
        timestamps: true
    });
    return Client;
};
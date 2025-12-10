const { DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');

module.exports = (sequelize) => {
    const Client = sequelize.define('Client', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING, allowNull: false },
        lastName: { type: DataTypes.STRING, allowNull: false },
        phone: { type: DataTypes.STRING, allowNull: false }, // unique manejado por tienda
        email: { type: DataTypes.STRING, allowNull: true, validate: { isEmail: true } },
        password: {
            type: DataTypes.STRING,
            allowNull: true
        },
        address: { type: DataTypes.STRING },
        city: { type: DataTypes.STRING },
        state: { type: DataTypes.STRING },
        zipCode: { type: DataTypes.STRING },
        identificationId: { type: DataTypes.STRING },
        notes: { type: DataTypes.TEXT },
        tiendaId: {
            type: DataTypes.INTEGER,
            allowNull: false,
            field: 'tienda_id',
            defaultValue: 1
        }
    }, {
        tableName: 'clients', // ⭐ Corregido para tu SQLite
        timestamps: true,
        hooks: {
            beforeCreate: async (client) => {
                if (client.password) {
                    const salt = await bcrypt.genSalt(10);
                    client.password = await bcrypt.hash(client.password, salt);
                }
            },
            beforeUpdate: async (client) => {
                if (client.changed('password') && client.password) {
                    const salt = await bcrypt.genSalt(10);
                    client.password = await bcrypt.hash(client.password, salt);
                }
            },
        },
    });

    Client.prototype.comparePassword = async function (candidatePassword) {
        return await bcrypt.compare(candidatePassword, this.password || '');
    };

    return Client;
};
const { DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs'); // <-- AÑADIR BCRYPT

module.exports = (sequelize) => {
    const Client = sequelize.define('Client', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING, allowNull: false },
        lastName: { type: DataTypes.STRING, allowNull: false },
        phone: { type: DataTypes.STRING, allowNull: false, unique: true },
        email: { type: DataTypes.STRING, unique: true, allowNull: true, validate: { isEmail: true } },
        
        // --- INICIO DE LA MODIFICACIÓN ---
        password: {
            type: DataTypes.STRING,
            allowNull: true // Se permite nulo para que los clientes existentes no fallen y puedan activar su portal después.
        },
        // --- FIN DE LA MODIFICACIÓN ---

        address: { type: DataTypes.STRING },
        city: { type: DataTypes.STRING },
        state: { type: DataTypes.STRING },
        zipCode: { type: DataTypes.STRING },
        identificationId: { type: DataTypes.STRING },
        notes: { type: DataTypes.TEXT },
    }, {
        tableName: 'Clientes',
        timestamps: true,
        // --- INICIO DE LA MODIFICACIÓN ---
        // Hooks para encriptar la contraseña automáticamente antes de guardarla.
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
        // --- FIN DE LA MODIFICACIÓN ---
    });

    // --- INICIO DE LA MODIFICACIÓN ---
    // Se añade un método al prototipo del modelo para comparar la contraseña de forma segura durante el login.
    Client.prototype.comparePassword = async function (candidatePassword) {
        // Se compara la contraseña proporcionada con la contraseña encriptada de la base de datos.
        // El '|| ""' es por si el campo de contraseña es nulo para un cliente.
        return await bcrypt.compare(candidatePassword, this.password || '');
    };
    // --- FIN DE LA MODIFICACIÓN ---

    return Client;
};
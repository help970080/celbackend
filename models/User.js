// src/backend/models/User.js (Archivo Corregido y Actualizado)
const { DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');

module.exports = (sequelize) => {
    const User = sequelize.define('User', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },
        username: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true,
        },
        password: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        // --- CAMPO ROLE MODIFICADO ---
        role: {
            // Se cambia a ENUM para mayor integridad de datos
            type: DataTypes.ENUM(
                'super_admin', 
                'regular_admin', 
                'sales_admin', 
                'inventory_admin', 
                'viewer_reports', 
                'collector_agent' // <-- ROL AÑADIDO
            ),
            allowNull: false,
            // Se quita el defaultValue para asignar roles explícitamente
        },
    }, {
        timestamps: true,
        hooks: {
            beforeCreate: async (user) => {
                if (user.password) {
                    const salt = await bcrypt.genSalt(10);
                    user.password = await bcrypt.hash(user.password, salt);
                }
            },
            beforeUpdate: async (user) => {
                if (user.changed('password')) {
                    const salt = await bcrypt.genSalt(10);
                    user.password = await bcrypt.hash(user.password, salt);
                }
            },
        },
    });

    // Método de instancia para comparar contraseñas
    User.prototype.comparePassword = async function (candidatePassword) {
        return await bcrypt.compare(candidatePassword, this.password);
    };

    return User;
};
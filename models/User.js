// src/backend/models/User.js (o donde definas tu modelo User)
const { DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs'); // Asegúrate de que bcryptjs esté importado

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
        // --- NUEVO CAMPO: Role ---
        role: {
            type: DataTypes.STRING, // Puedes usar DataTypes.ENUM(['super_admin', 'admin_ventas', 'admin_inventario']) para roles fijos
            allowNull: false,
            defaultValue: 'regular_admin', // Rol por defecto. Lo cambiaremos a 'super_admin' para el primer usuario.
        },
    }, {
        timestamps: true, // `createdAt` and `updatedAt` will be automatically added
        hooks: {
            beforeCreate: async (user) => {
                if (user.password) {
                    const salt = await bcrypt.genSalt(10);
                    user.password = await bcrypt.hash(user.password, salt);
                }
            },
            beforeUpdate: async (user) => {
                if (user.changed('password')) { // Solo hashear si la contraseña ha cambiado
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
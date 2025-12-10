const { DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');

module.exports = (sequelize) => {
    const User = sequelize.define('User', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        username: { type: DataTypes.STRING, allowNull: false, unique: true },
        password: { type: DataTypes.STRING, allowNull: false },
        role: {
            type: DataTypes.STRING, // Cambiado de ENUM a STRING para SQLite
            allowNull: false
        },
        tiendaId: {
            type: DataTypes.INTEGER,
            allowNull: false,
            field: 'tienda_id',
            defaultValue: 1
        }
    }, {
        tableName: 'Users', // ⭐ Corregido para tu SQLite
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

    User.prototype.comparePassword = async function (candidatePassword) {
        return await bcrypt.compare(candidatePassword, this.password);
    };

    return User;
};
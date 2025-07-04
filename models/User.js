const { DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');

module.exports = (sequelize) => {
    const User = sequelize.define('User', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        username: { type: DataTypes.STRING, allowNull: false, unique: true },
        password: { type: DataTypes.STRING, allowNull: false },
        role: {
            type: DataTypes.ENUM('super_admin', 'regular_admin', 'sales_admin', 'inventory_admin', 'viewer_reports', 'collector_agent'),
            allowNull: false
        },
    }, {
        tableName: 'Usuarios', // Corrección final del nombre de la tabla
        timestamps: true,
        hooks: {
            beforeCreate: async (user) => { if (user.password) { const salt = await bcrypt.genSalt(10); user.password = await bcrypt.hash(user.password, salt); } },
            beforeUpdate: async (user) => { if (user.changed('password')) { const salt = await bcrypt.genSalt(10); user.password = await bcrypt.hash(user.password, salt); } },
        },
    });

    User.prototype.comparePassword = async function (candidatePassword) {
        return await bcrypt.compare(candidatePassword, this.password);
    };

    return User;
};
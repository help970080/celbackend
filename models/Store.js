const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const Store = sequelize.define('Store', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        name: {
            type: DataTypes.STRING,
            allowNull: false
        },
        address: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        phone: {
            type: DataTypes.STRING,
            allowNull: true
        },
        email: {
            type: DataTypes.STRING,
            allowNull: true,
            validate: {
                isEmail: true
            }
        },
        isActive: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
            field: 'is_active'  // ⭐ AGREGADO: mapeo a la columna PostgreSQL
        }
    }, {
        tableName: 'stores',
        timestamps: true,
        createdAt: 'createdAt',  // ⭐ AGREGADO: mapeo explícito
        updatedAt: 'updatedAt'   // ⭐ AGREGADO: mapeo explícito
    });

    return Store;
};
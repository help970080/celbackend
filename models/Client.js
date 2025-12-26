// models/Client.js - CON CAMPOS PARA DOCUMENTOS Y VERIFICACIÓN FACIAL

const { DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');

module.exports = (sequelize) => {
    const Client = sequelize.define('Client', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING, allowNull: false },
        lastName: { type: DataTypes.STRING, allowNull: false },
        phone: { type: DataTypes.STRING, allowNull: false },
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
        },
        
        // ⭐ NUEVOS CAMPOS PARA DOCUMENTOS
        ineFrente: {
            type: DataTypes.STRING,
            allowNull: true,
            field: 'ine_frente',
            comment: 'URL de Cloudinary - Foto INE frente'
        },
        ineReverso: {
            type: DataTypes.STRING,
            allowNull: true,
            field: 'ine_reverso',
            comment: 'URL de Cloudinary - Foto INE reverso'
        },
        selfie: {
            type: DataTypes.STRING,
            allowNull: true,
            comment: 'URL de Cloudinary - Selfie del cliente'
        },
        fotoEntrega: {
            type: DataTypes.STRING,
            allowNull: true,
            field: 'foto_entrega',
            comment: 'URL de Cloudinary - Foto de entrega del equipo'
        },
        fotoEquipo: {
            type: DataTypes.STRING,
            allowNull: true,
            field: 'foto_equipo',
            comment: 'URL de Cloudinary - Foto del equipo con IMEI visible'
        },
        
        // ⭐ CAMPOS DE VERIFICACIÓN FACIAL
        verificacionFacial: {
            type: DataTypes.FLOAT,
            allowNull: true,
            field: 'verificacion_facial',
            comment: 'Porcentaje de coincidencia facial (0-100)'
        },
        verificadoEl: {
            type: DataTypes.DATE,
            allowNull: true,
            field: 'verificado_el',
            comment: 'Fecha y hora de la verificación facial'
        },
        estadoVerificacion: {
            type: DataTypes.STRING,
            allowNull: true,
            field: 'estado_verificacion',
            defaultValue: 'pendiente',
            comment: 'pendiente, verificado, rechazado'
        }
    }, {
        tableName: 'clients',
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
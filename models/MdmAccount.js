// models/MdmAccount.js - Cuentas MDM ManageEngine
const { DataTypes } = require('sequelize');
const crypto = require('crypto');

// Clave para encriptar (debe estar en .env en producción)
const ENCRYPTION_KEY = process.env.MDM_ENCRYPTION_KEY || 'celexpress-mdm-key-32-characters!';
const IV_LENGTH = 16;

// Funciones de encriptación
function encrypt(text) {
    if (!text) return null;
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY.padEnd(32).slice(0, 32)), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text) {
    if (!text) return null;
    try {
        const parts = text.split(':');
        const iv = Buffer.from(parts.shift(), 'hex');
        const encrypted = Buffer.from(parts.join(':'), 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY.padEnd(32).slice(0, 32)), iv);
        let decrypted = decipher.update(encrypted);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString();
    } catch (error) {
        console.error('Error desencriptando:', error.message);
        return null;
    }
}

module.exports = (sequelize) => {
    const MdmAccount = sequelize.define('MdmAccount', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        // Nombre descriptivo de la cuenta
        nombre: {
            type: DataTypes.STRING(100),
            allowNull: false
        },
        // Email de la cuenta Zoho/ManageEngine
        email: {
            type: DataTypes.STRING(150),
            allowNull: true
        },
        // Client ID de Zoho API
        clientId: {
            type: DataTypes.TEXT,
            allowNull: false,
            field: 'client_id',
            set(value) {
                this.setDataValue('clientId', encrypt(value));
            },
            get() {
                const value = this.getDataValue('clientId');
                return decrypt(value);
            }
        },
        // Client Secret de Zoho API
        clientSecret: {
            type: DataTypes.TEXT,
            allowNull: false,
            field: 'client_secret',
            set(value) {
                this.setDataValue('clientSecret', encrypt(value));
            },
            get() {
                const value = this.getDataValue('clientSecret');
                return decrypt(value);
            }
        },
        // Refresh Token (permanente)
        refreshToken: {
            type: DataTypes.TEXT,
            allowNull: false,
            field: 'refresh_token',
            set(value) {
                this.setDataValue('refreshToken', encrypt(value));
            },
            get() {
                const value = this.getDataValue('refreshToken');
                return decrypt(value);
            }
        },
        // Access Token actual (se renueva automáticamente)
        accessToken: {
            type: DataTypes.TEXT,
            allowNull: true,
            field: 'access_token'
        },
        // Fecha de expiración del access token
        tokenExpiresAt: {
            type: DataTypes.DATE,
            allowNull: true,
            field: 'token_expires_at'
        },
        // Tienda asociada (opcional)
        tiendaId: {
            type: DataTypes.INTEGER,
            allowNull: true,
            field: 'tienda_id',
            references: {
                model: 'stores',
                key: 'id'
            }
        },
        // Estado de la cuenta
        activo: {
            type: DataTypes.BOOLEAN,
            defaultValue: true
        },
        // Último estado de conexión
        lastStatus: {
            type: DataTypes.STRING(50),
            allowNull: true,
            field: 'last_status'
        },
        // Última verificación exitosa
        lastCheckedAt: {
            type: DataTypes.DATE,
            allowNull: true,
            field: 'last_checked_at'
        },
        // Conteo de dispositivos
        deviceCount: {
            type: DataTypes.INTEGER,
            defaultValue: 0,
            field: 'device_count'
        },
        // Notas adicionales
        notas: {
            type: DataTypes.TEXT,
            allowNull: true
        }
    }, {
        tableName: 'mdm_accounts',
        timestamps: true,
        underscored: true,
        indexes: [
            { fields: ['tienda_id'] },
            { fields: ['activo'] },
            { fields: ['nombre'] }
        ]
    });

    return MdmAccount;
};

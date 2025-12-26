// services/mdmService.js - Integración con Headwind MDM
const crypto = require('crypto');

class MDMService {
    constructor() {
        this.baseUrl = process.env.MDM_BASE_URL || 'https://mdm.celexpress.org';
        this.username = process.env.MDM_USERNAME || 'admin';
        this.password = process.env.MDM_PASSWORD || 'admin';
        this.token = null;
        this.tokenExpiry = null;
    }

    /**
     * Genera hash MD5 en mayúsculas (requerido por Headwind MDM)
     */
    md5Hash(password) {
        return crypto.createHash('md5').update(password).digest('hex').toUpperCase();
    }

    /**
     * Autenticación con Headwind MDM
     * Obtiene JWT token para llamadas posteriores
     */
    async authenticate() {
        try {
            // Si el token existe y no ha expirado, reutilizarlo
            if (this.token && this.tokenExpiry && Date.now() < this.tokenExpiry) {
                return this.token;
            }

            const response = await fetch(`${this.baseUrl}/rest/public/jwt/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    login: this.username,
                    password: this.md5Hash(this.password)
                })
            });

            if (!response.ok) {
                throw new Error(`Error de autenticación MDM: ${response.status}`);
            }

            const data = await response.json();
            this.token = data.id_token;
            // Token válido por 23 horas (expira en 24h)
            this.tokenExpiry = Date.now() + (23 * 60 * 60 * 1000);
            
            console.log('✅ Autenticación MDM exitosa');
            return this.token;
        } catch (error) {
            console.error('❌ Error autenticando con MDM:', error.message);
            throw error;
        }
    }

    /**
     * Hacer petición autenticada a la API de MDM
     */
    async apiRequest(endpoint, method = 'GET', body = null) {
        const token = await this.authenticate();
        
        const options = {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        };

        if (body) {
            options.body = JSON.stringify(body);
        }

        const response = await fetch(`${this.baseUrl}${endpoint}`, options);
        
        if (response.status === 401) {
            // Token expirado, reintentar
            this.token = null;
            this.tokenExpiry = null;
            return this.apiRequest(endpoint, method, body);
        }

        return response;
    }

    /**
     * Obtener lista de todos los dispositivos
     */
    async getDevices() {
        try {
            const response = await this.apiRequest('/rest/private/devices/search', 'POST', {
                pageSize: 1000,
                pageNum: 1
            });

            if (!response.ok) {
                throw new Error(`Error obteniendo dispositivos: ${response.status}`);
            }

            const data = await response.json();
            return data.data || [];
        } catch (error) {
            console.error('❌ Error obteniendo dispositivos MDM:', error.message);
            throw error;
        }
    }

    /**
     * Buscar dispositivo por número/identificador
     */
    async findDeviceByNumber(deviceNumber) {
        try {
            const devices = await this.getDevices();
            return devices.find(d => d.number === deviceNumber || d.imei === deviceNumber);
        } catch (error) {
            console.error('❌ Error buscando dispositivo:', error.message);
            return null;
        }
    }

    /**
     * Obtener información de un dispositivo específico
     */
    async getDevice(deviceId) {
        try {
            const response = await this.apiRequest(`/rest/private/devices/${deviceId}`, 'GET');

            if (!response.ok) {
                throw new Error(`Error obteniendo dispositivo: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('❌ Error obteniendo dispositivo MDM:', error.message);
            throw error;
        }
    }

    /**
     * Crear/registrar un nuevo dispositivo
     */
    async createDevice(deviceData) {
        try {
            const response = await this.apiRequest('/rest/private/devices', 'POST', {
                number: deviceData.number || deviceData.imei,
                description: deviceData.description || '',
                configurationId: deviceData.configurationId || 1, // Configuración por defecto
                groups: deviceData.groups || []
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Error creando dispositivo: ${response.status} - ${errorText}`);
            }

            const result = await response.json();
            console.log('✅ Dispositivo creado en MDM:', deviceData.number);
            return result;
        } catch (error) {
            console.error('❌ Error creando dispositivo MDM:', error.message);
            throw error;
        }
    }

    /**
     * Actualizar configuración de un dispositivo (para bloqueo/desbloqueo)
     */
    async updateDeviceConfiguration(deviceId, configurationId) {
        try {
            const response = await this.apiRequest(`/rest/private/devices/${deviceId}`, 'PUT', {
                configurationId: configurationId
            });

            if (!response.ok) {
                throw new Error(`Error actualizando dispositivo: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('❌ Error actualizando configuración MDM:', error.message);
            throw error;
        }
    }

    /**
     * Enviar comando al dispositivo
     * Comandos disponibles: lock, unlock, reboot, wipe, etc.
     */
    async sendCommand(deviceNumber, command) {
        try {
            // Buscar dispositivo por número
            const device = await this.findDeviceByNumber(deviceNumber);
            if (!device) {
                throw new Error(`Dispositivo ${deviceNumber} no encontrado`);
            }

            const response = await this.apiRequest('/rest/private/devices/command', 'POST', {
                deviceId: device.id,
                command: command
            });

            if (!response.ok) {
                throw new Error(`Error enviando comando: ${response.status}`);
            }

            console.log(`✅ Comando '${command}' enviado a dispositivo ${deviceNumber}`);
            return await response.json();
        } catch (error) {
            console.error('❌ Error enviando comando MDM:', error.message);
            throw error;
        }
    }

    /**
     * BLOQUEAR dispositivo - Cambiar a configuración de bloqueo
     * @param {string} deviceNumber - Número o IMEI del dispositivo
     * @param {string} reason - Razón del bloqueo (ej: "Mora en pagos")
     */
    async lockDevice(deviceNumber, reason = 'Mora en pagos') {
        try {
            const device = await this.findDeviceByNumber(deviceNumber);
            if (!device) {
                throw new Error(`Dispositivo ${deviceNumber} no encontrado en MDM`);
            }

            // Opción 1: Enviar comando de bloqueo
            // await this.sendCommand(deviceNumber, 'lock');

            // Opción 2: Cambiar a configuración "Bloqueado" (más persistente)
            // Necesitas crear una configuración llamada "Bloqueado" en Headwind
            const blockedConfigId = process.env.MDM_BLOCKED_CONFIG_ID || 2;
            
            const response = await this.apiRequest(`/rest/private/devices/${device.id}`, 'PUT', {
                configurationId: parseInt(blockedConfigId),
                description: `BLOQUEADO: ${reason} - ${new Date().toISOString()}`
            });

            if (!response.ok) {
                throw new Error(`Error bloqueando dispositivo: ${response.status}`);
            }

            console.log(`🔒 Dispositivo ${deviceNumber} BLOQUEADO - Razón: ${reason}`);
            return {
                success: true,
                deviceNumber,
                action: 'locked',
                reason,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('❌ Error bloqueando dispositivo:', error.message);
            throw error;
        }
    }

    /**
     * DESBLOQUEAR dispositivo - Restaurar configuración normal
     * @param {string} deviceNumber - Número o IMEI del dispositivo
     */
    async unlockDevice(deviceNumber) {
        try {
            const device = await this.findDeviceByNumber(deviceNumber);
            if (!device) {
                throw new Error(`Dispositivo ${deviceNumber} no encontrado en MDM`);
            }

            // Cambiar a configuración normal/desbloqueada
            const normalConfigId = process.env.MDM_NORMAL_CONFIG_ID || 1;
            
            const response = await this.apiRequest(`/rest/private/devices/${device.id}`, 'PUT', {
                configurationId: parseInt(normalConfigId),
                description: `Desbloqueado - ${new Date().toISOString()}`
            });

            if (!response.ok) {
                throw new Error(`Error desbloqueando dispositivo: ${response.status}`);
            }

            console.log(`🔓 Dispositivo ${deviceNumber} DESBLOQUEADO`);
            return {
                success: true,
                deviceNumber,
                action: 'unlocked',
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('❌ Error desbloqueando dispositivo:', error.message);
            throw error;
        }
    }

    /**
     * Obtener configuraciones disponibles
     */
    async getConfigurations() {
        try {
            const response = await this.apiRequest('/rest/private/configurations', 'GET');

            if (!response.ok) {
                throw new Error(`Error obteniendo configuraciones: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('❌ Error obteniendo configuraciones MDM:', error.message);
            throw error;
        }
    }

    /**
     * Wipe remoto del dispositivo (borrar datos)
     */
    async wipeDevice(deviceNumber) {
        try {
            return await this.sendCommand(deviceNumber, 'wipe');
        } catch (error) {
            console.error('❌ Error haciendo wipe:', error.message);
            throw error;
        }
    }

    /**
     * Reiniciar dispositivo remotamente
     */
    async rebootDevice(deviceNumber) {
        try {
            return await this.sendCommand(deviceNumber, 'reboot');
        } catch (error) {
            console.error('❌ Error reiniciando dispositivo:', error.message);
            throw error;
        }
    }

    /**
     * Obtener ubicación del dispositivo
     */
    async getDeviceLocation(deviceNumber) {
        try {
            const device = await this.findDeviceByNumber(deviceNumber);
            if (!device) {
                throw new Error(`Dispositivo ${deviceNumber} no encontrado`);
            }

            // La ubicación suele estar en los datos del dispositivo
            return {
                latitude: device.lat,
                longitude: device.lon,
                lastUpdate: device.lastUpdate
            };
        } catch (error) {
            console.error('❌ Error obteniendo ubicación:', error.message);
            throw error;
        }
    }
}

// Exportar instancia singleton
module.exports = new MDMService();

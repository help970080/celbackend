/**
 * MDM Service para ManageEngine - Lee cuentas desde BD
 * Versión con soporte multi-cuenta dinámico
 */

const axios = require('axios');

// Cache de tokens por cuenta
const tokenCache = new Map();

/**
 * Renueva el access token de una cuenta
 */
async function refreshAccessToken(account) {
    try {
        const response = await axios.post('https://accounts.zoho.com/oauth/v2/token', null, {
            params: {
                refresh_token: account.refreshToken,
                client_id: account.clientId,
                client_secret: account.clientSecret,
                grant_type: 'refresh_token'
            }
        });

        const accessToken = response.data.access_token;
        const expiresAt = new Date(Date.now() + (response.data.expires_in * 1000) - 60000);

        // Guardar en cache
        tokenCache.set(account.id, {
            accessToken,
            expiresAt
        });

        // Actualizar en BD
        await account.update({
            accessToken,
            tokenExpiresAt: expiresAt,
            lastStatus: 'active',
            lastCheckedAt: new Date()
        });

        console.log(`✅ Token renovado para cuenta: ${account.nombre}`);
        return accessToken;
    } catch (error) {
        console.error(`❌ Error renovando token para ${account.nombre}:`, error.response?.data || error.message);
        
        await account.update({
            lastStatus: 'error',
            lastCheckedAt: new Date()
        });
        
        throw new Error(`Error de autenticación MDM: ${account.nombre}`);
    }
}

/**
 * Obtiene token válido para una cuenta
 */
async function getValidToken(account) {
    const cached = tokenCache.get(account.id);
    
    if (cached && cached.expiresAt > new Date()) {
        return cached.accessToken;
    }
    
    return await refreshAccessToken(account);
}

/**
 * Headers de autorización para una cuenta
 */
async function getHeaders(account) {
    const token = await getValidToken(account);
    return {
        'Authorization': `Zoho-oauthtoken ${token}`,
        'Content-Type': 'application/json'
    };
}

/**
 * Obtiene todas las cuentas MDM activas
 */
async function getActiveAccounts(MdmAccount) {
    return await MdmAccount.findAll({
        where: { activo: true },
        order: [['id', 'ASC']]
    });
}

/**
 * Obtiene cuenta por ID
 */
async function getAccountById(MdmAccount, accountId) {
    return await MdmAccount.findByPk(accountId);
}

/**
 * Obtiene cuenta para una tienda específica
 */
async function getAccountForStore(MdmAccount, tiendaId) {
    // Buscar cuenta asignada a la tienda
    let account = await MdmAccount.findOne({
        where: { tiendaId, activo: true }
    });
    
    // Si no hay, buscar cuenta sin tienda asignada
    if (!account) {
        account = await MdmAccount.findOne({
            where: { tiendaId: null, activo: true }
        });
    }
    
    // Si aún no hay, usar la primera activa
    if (!account) {
        account = await MdmAccount.findOne({
            where: { activo: true }
        });
    }
    
    return account;
}

/**
 * Obtiene dispositivos de una cuenta
 */
async function getDevicesFromAccount(account) {
    const headers = await getHeaders(account);
    
    const response = await axios.get('https://mdm.manageengine.com/api/v1/mdm/devices', {
        headers
    });
    
    const devices = response.data.devices || [];
    
    // Actualizar conteo
    const activeCount = devices.filter(d => d.is_removed === 'false').length;
    await account.update({ deviceCount: activeCount });
    
    return devices;
}

/**
 * Obtiene todos los dispositivos de todas las cuentas activas
 */
async function getAllDevices(MdmAccount) {
    const accounts = await getActiveAccounts(MdmAccount);
    const allDevices = [];
    
    for (const account of accounts) {
        try {
            const devices = await getDevicesFromAccount(account);
            devices.forEach(d => {
                d._accountId = account.id;
                d._accountName = account.nombre;
                allDevices.push(d);
            });
        } catch (error) {
            console.error(`Error obteniendo dispositivos de ${account.nombre}:`, error.message);
        }
    }
    
    return allDevices;
}

/**
 * Busca dispositivo por IMEI en todas las cuentas
 */
async function findDeviceByImei(MdmAccount, imei) {
    const accounts = await getActiveAccounts(MdmAccount);
    
    for (const account of accounts) {
        try {
            const devices = await getDevicesFromAccount(account);
            
            const device = devices.find(d => {
                if (d.is_removed === 'true') return false;
                return Array.isArray(d.imei) ? d.imei.includes(imei) : d.imei === imei;
            });
            
            if (device) {
                return { account, device };
            }
        } catch (error) {
            console.error(`Error buscando en ${account.nombre}:`, error.message);
        }
    }
    
    return { account: null, device: null };
}

/**
 * BLOQUEAR dispositivo (Lost Mode)
 */
async function lockDevice(account, deviceId, message, phone) {
    const headers = await getHeaders(account);
    
    await axios.post(
        `https://mdm.manageengine.com/api/v1/mdm/devices/${deviceId}/actions/enable_lost_mode`,
        {
            lock_message: message || 'Dispositivo bloqueado por falta de pago. Contacte a CelExpress.',
            phone_number: phone || process.env.CELEXPRESS_PHONE || ''
        },
        { headers }
    );
    
    return { success: true, action: 'locked', deviceId };
}

/**
 * DESBLOQUEAR dispositivo
 */
async function unlockDevice(account, deviceId) {
    const headers = await getHeaders(account);
    
    await axios.post(
        `https://mdm.manageengine.com/api/v1/mdm/devices/${deviceId}/actions/disable_lost_mode`,
        {},
        { headers }
    );
    
    return { success: true, action: 'unlocked', deviceId };
}

/**
 * Bloquear por IMEI
 */
async function lockDeviceByImei(MdmAccount, imei, message, phone) {
    const { account, device } = await findDeviceByImei(MdmAccount, imei);
    
    if (!account || !device) {
        throw new Error(`Dispositivo con IMEI ${imei} no encontrado en ninguna cuenta MDM`);
    }
    
    return await lockDevice(account, device.device_id, message, phone);
}

/**
 * Desbloquear por IMEI
 */
async function unlockDeviceByImei(MdmAccount, imei) {
    const { account, device } = await findDeviceByImei(MdmAccount, imei);
    
    if (!account || !device) {
        throw new Error(`Dispositivo con IMEI ${imei} no encontrado en ninguna cuenta MDM`);
    }
    
    return await unlockDevice(account, device.device_id);
}

/**
 * Alarma remota
 */
async function ringDevice(account, deviceId) {
    const headers = await getHeaders(account);
    
    await axios.post(
        `https://mdm.manageengine.com/api/v1/mdm/devices/${deviceId}/actions/remote_alarm`,
        {},
        { headers }
    );
    
    return { success: true, action: 'ring', deviceId };
}

/**
 * Ubicación del dispositivo
 */
async function getDeviceLocation(account, deviceId) {
    const headers = await getHeaders(account);
    
    const response = await axios.get(
        `https://mdm.manageengine.com/api/v1/mdm/devices/${deviceId}/location`,
        { headers }
    );
    
    return response.data;
}

/**
 * Probar conexión de una cuenta
 */
async function testAccountConnection(account) {
    try {
        const devices = await getDevicesFromAccount(account);
        const activeCount = devices.filter(d => d.is_removed === 'false').length;
        
        return {
            success: true,
            message: 'Conexión exitosa',
            deviceCount: activeCount
        };
    } catch (error) {
        return {
            success: false,
            message: 'Error de conexión',
            error: error.message
        };
    }
}

/**
 * Verificar estado de todas las cuentas
 */
async function checkAllAccounts(MdmAccount) {
    const accounts = await MdmAccount.findAll();
    const results = [];
    
    for (const account of accounts) {
        const status = await testAccountConnection(account);
        results.push({
            id: account.id,
            nombre: account.nombre,
            activo: account.activo,
            ...status
        });
    }
    
    return results;
}

module.exports = {
    getActiveAccounts,
    getAccountById,
    getAccountForStore,
    getDevicesFromAccount,
    getAllDevices,
    findDeviceByImei,
    lockDevice,
    unlockDevice,
    lockDeviceByImei,
    unlockDeviceByImei,
    ringDevice,
    getDeviceLocation,
    testAccountConnection,
    checkAllAccounts,
    refreshAccessToken
};

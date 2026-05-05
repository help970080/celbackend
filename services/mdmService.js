/**
 * MDM Service para ManageEngine - VERSIÓN CORREGIDA SIN PAGINACIÓN
 *
 * Cambios respecto a la versión anterior:
 *   - REMOVIDA paginación (Zoho devolvía HTTP 400 con page/size)
 *   - Vuelve al GET simple sin parámetros que sí funciona
 *   - Conserva todas las demás mejoras:
 *       * Verifica respuesta REAL de Zoho (no asume éxito por HTTP 200)
 *       * Detecta dispositivos offline / agente caído
 *       * Combina lock_device + lost_mode
 *       * Normalización robusta de IMEI
 *       * Función diagnoseImei
 *       * Mejor logging de errores
 */

const axios = require('axios');

const tokenCache = new Map();

// ============================================================
// AUTENTICACIÓN
// ============================================================

async function refreshAccessToken(account) {
    try {
        const response = await axios.post('https://accounts.zoho.com/oauth/v2/token', null, {
            params: {
                refresh_token: account.refreshToken,
                client_id: account.clientId,
                client_secret: account.clientSecret,
                grant_type: 'refresh_token'
            },
            timeout: 15000
        });

        if (!response.data.access_token) {
            throw new Error(`Zoho no devolvió access_token. Response: ${JSON.stringify(response.data)}`);
        }

        const accessToken = response.data.access_token;
        const expiresIn = response.data.expires_in || 3600;
        const expiresAt = new Date(Date.now() + (expiresIn * 1000) - 60000);

        tokenCache.set(account.id, { accessToken, expiresAt });

        try {
            await account.update({
                accessToken,
                tokenExpiresAt: expiresAt,
                lastStatus: 'active',
                lastCheckedAt: new Date()
            });
        } catch (dbError) {
            console.error(`⚠️ Error guardando token en BD para ${account.nombre}:`, dbError.message);
        }

        console.log(`✅ Token renovado para cuenta: ${account.nombre}`);
        return accessToken;
    } catch (error) {
        const errMsg = error.response?.data?.error || error.response?.data || error.message;
        console.error(`❌ Error renovando token para ${account.nombre}:`, errMsg);

        try {
            await account.update({
                lastStatus: 'error',
                lastCheckedAt: new Date()
            });
        } catch (dbError) {}

        throw new Error(`Error de autenticación MDM: ${account.nombre} — ${typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg)}`);
    }
}

async function getValidToken(account) {
    const cached = tokenCache.get(account.id);
    if (cached && cached.expiresAt > new Date()) {
        return cached.accessToken;
    }

    if (account.accessToken && account.tokenExpiresAt) {
        const expiresAt = new Date(account.tokenExpiresAt);
        if (!isNaN(expiresAt.getTime()) && expiresAt > new Date()) {
            tokenCache.set(account.id, {
                accessToken: account.accessToken,
                expiresAt
            });
            return account.accessToken;
        }
    }

    return await refreshAccessToken(account);
}

async function getHeaders(account) {
    const token = await getValidToken(account);
    return {
        'Authorization': `Zoho-oauthtoken ${token}`,
        'Content-Type': 'application/json'
    };
}

// ============================================================
// CUENTAS
// ============================================================

async function getActiveAccounts(MdmAccount) {
    return await MdmAccount.findAll({
        where: { activo: true },
        order: [['id', 'ASC']]
    });
}

async function getAccountById(MdmAccount, accountId) {
    return await MdmAccount.findByPk(accountId);
}

async function getAccountForStore(MdmAccount, tiendaId) {
    let account = await MdmAccount.findOne({ where: { tiendaId, activo: true } });
    if (!account) {
        account = await MdmAccount.findOne({ where: { tiendaId: null, activo: true } });
    }
    if (!account) {
        account = await MdmAccount.findOne({ where: { activo: true } });
    }
    return account;
}

// ============================================================
// LISTAR DISPOSITIVOS — SIN PAGINACIÓN
// Zoho rechazaba ?page=N&size=N con HTTP 400.
// Volvemos al GET simple original.
// ============================================================

async function getDevicesFromAccount(account) {
    const headers = await getHeaders(account);

    try {
        const response = await axios.get('https://mdm.manageengine.com/api/v1/mdm/devices', {
            headers,
            timeout: 30000
        });

        const devices = response.data.devices || [];
        const activeCount = devices.filter(d => d.is_removed === 'false' || d.is_removed === false).length;

        try {
            await account.update({ deviceCount: activeCount });
        } catch (e) {}

        console.log(`✅ ${account.nombre}: ${devices.length} dispositivos obtenidos (${activeCount} activos)`);
        return devices;
    } catch (error) {
        const status = error.response?.status;
        const body = error.response?.data;
        console.error(`❌ Error obteniendo dispositivos de ${account.nombre}: HTTP ${status}`, body || error.message);
        return [];
    }
}

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

// ============================================================
// NORMALIZACIÓN ROBUSTA DE IMEI
// ============================================================

function normalizeImei(imei) {
    if (imei === null || imei === undefined) return '';
    return String(imei).replace(/[\s\-\.]/g, '').trim();
}

function imeiMatches(deviceImei, searchImei) {
    const search = normalizeImei(searchImei);
    if (!search) return false;

    if (Array.isArray(deviceImei)) {
        return deviceImei.some(i => normalizeImei(i) === search);
    }
    return normalizeImei(deviceImei) === search;
}

async function findDeviceByImei(MdmAccount, imei) {
    const accounts = await getActiveAccounts(MdmAccount);

    for (const account of accounts) {
        try {
            const devices = await getDevicesFromAccount(account);

            const device = devices.find(d => {
                const removed = d.is_removed === 'true' || d.is_removed === true;
                if (removed) return false;
                return imeiMatches(d.imei, imei);
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

// ============================================================
// VERIFICAR ALCANZABILIDAD DEL DISPOSITIVO
// ============================================================

function checkDeviceReachability(device) {
    const warnings = [];

    const lastContact = device.last_contacted_time || device.last_contact_time || device.last_communication;
    if (lastContact) {
        const lastDate = new Date(isNaN(lastContact) ? lastContact : Number(lastContact));
        if (!isNaN(lastDate.getTime())) {
            const hoursAgo = (Date.now() - lastDate.getTime()) / (1000 * 60 * 60);
            if (hoursAgo > 72) {
                warnings.push(`Dispositivo sin contacto hace ${Math.round(hoursAgo)} horas`);
            }
        }
    } else {
        warnings.push('Sin información de último contacto');
    }

    if (device.device_status && device.device_status.toLowerCase().includes('inactiv')) {
        warnings.push(`Estado del dispositivo: ${device.device_status}`);
    }

    if (device.agent_status === 'uninstalled' || device.is_agent_active === false) {
        warnings.push('Agente MDM desinstalado o inactivo');
    }

    return {
        reachable: warnings.length === 0,
        warnings
    };
}

// ============================================================
// BLOQUEO REAL CON VERIFICACIÓN DE RESPUESTA
// ============================================================

async function lockDevice(account, deviceId, message, phone, options = {}) {
    const headers = await getHeaders(account);
    const lockMessage = message || 'Dispositivo bloqueado por falta de pago. Contacte a CelExpress.';
    const lockPhone = phone || process.env.CELEXPRESS_PHONE || '';

    // FORZAR string explícitamente
    const safeDeviceId = String(deviceId).trim();

    const results = {
        success: false,
        action: 'locked',
        deviceId: safeDeviceId,
        steps: []
    };

    console.log(`🔒 [lockDevice] account=${account.nombre} deviceId="${safeDeviceId}" (len=${safeDeviceId.length}) typeof=${typeof safeDeviceId}`);

    // STEP 1: Lock device
    // ManageEngine MDM oficial: POST /api/v1/mdm/devices/{id}/actions/{action_name}
    // donde action_name = 'lock' (según documentación oficial)
    const lockUrl = `https://mdm.manageengine.com/api/v1/mdm/devices/${safeDeviceId}/actions/lock`;
    console.log(`🔒 [lockDevice] URL: ${lockUrl}`);

    try {
        const lockResp = await axios.post(
            lockUrl,
            { lock_message: lockMessage },
            { headers, timeout: 30000, validateStatus: () => true }
        );

        const ok = lockResp.status >= 200 && lockResp.status < 300;
        const body = lockResp.data || {};
        const apiSuccess = ok && body.status !== 'FAILED' && body.status !== 'ERROR' && !body.error_code;

        console.log(`🔒 [lockDevice] response status=${lockResp.status} body=${JSON.stringify(body).substring(0,200)}`);

        results.steps.push({
            step: 'lock_device',
            url: lockUrl,
            httpStatus: lockResp.status,
            apiStatus: body.status || 'unknown',
            success: apiSuccess,
            response: body
        });

        if (!apiSuccess) {
            throw new Error(`lock_device falló: HTTP ${lockResp.status}, URL: ${lockUrl}, body: ${JSON.stringify(body)}`);
        }
    } catch (e) {
        results.steps.push({ step: 'lock_device', success: false, error: e.message });
        throw new Error(`Bloqueo falló en step lock_device: ${e.message}`);
    }

    // STEP 2: Lost Mode (mensaje + teléfono visible)
    try {
        const lostResp = await axios.post(
            `https://mdm.manageengine.com/api/v1/mdm/devices/${safeDeviceId}/actions/enable_lost_mode`,
            { lock_message: lockMessage, phone_number: lockPhone },
            { headers, timeout: 30000, validateStatus: () => true }
        );

        const ok = lostResp.status >= 200 && lostResp.status < 300;
        const body = lostResp.data || {};
        const apiSuccess = ok && body.status !== 'FAILED' && !body.error_code;

        results.steps.push({
            step: 'enable_lost_mode',
            httpStatus: lostResp.status,
            apiStatus: body.status || 'unknown',
            success: apiSuccess,
            response: body
        });
    } catch (e) {
        results.steps.push({ step: 'enable_lost_mode', success: false, error: e.message });
    }

    results.success = true;
    return results;
}

async function unlockDevice(account, deviceId) {
    const headers = await getHeaders(account);
    const safeDeviceId = String(deviceId).trim();
    const results = { success: false, action: 'unlocked', deviceId: safeDeviceId, steps: [] };

    console.log(`🔓 [unlockDevice] account=${account.nombre} deviceId="${safeDeviceId}"`);

    // STEP 1: Disable lost mode
    try {
        const r1 = await axios.post(
            `https://mdm.manageengine.com/api/v1/mdm/devices/${safeDeviceId}/actions/disable_lost_mode`,
            {},
            { headers, timeout: 30000, validateStatus: () => true }
        );
        console.log(`🔓 [unlockDevice] disable_lost_mode status=${r1.status}`);
        results.steps.push({ step: 'disable_lost_mode', httpStatus: r1.status, response: r1.data });
    } catch (e) {
        results.steps.push({ step: 'disable_lost_mode', error: e.message });
    }

    // STEP 2: Clear passcode (esto desbloquea el equipo en Android)
    try {
        const r2 = await axios.post(
            `https://mdm.manageengine.com/api/v1/mdm/devices/${safeDeviceId}/actions/clear_passcode`,
            {},
            { headers, timeout: 30000, validateStatus: () => true }
        );
        console.log(`🔓 [unlockDevice] clear_passcode status=${r2.status}`);
        results.steps.push({ step: 'clear_passcode', httpStatus: r2.status, response: r2.data });
    } catch (e) {
        results.steps.push({ step: 'clear_passcode', error: e.message });
    }

    results.success = true;
    return results;
}

// ============================================================
// LOCK / UNLOCK por IMEI
// ============================================================

async function lockDeviceByImei(MdmAccount, imei, message, phone) {
    const { account, device } = await findDeviceByImei(MdmAccount, imei);

    if (!account || !device) {
        throw new Error(`Dispositivo con IMEI ${imei} no encontrado en ninguna cuenta MDM. Verifica que el agente esté instalado y el equipo enrolado.`);
    }

    const reach = checkDeviceReachability(device);

    // FIX CRÍTICO: device_id siempre como string (Zoho usa IDs de 18 dígitos
    // que pierden precisión si JavaScript los trata como Number)
    const deviceIdStr = String(device.device_id);

    const result = await lockDevice(account, deviceIdStr, message, phone);
    result.imei = imei;
    result.deviceName = device.name || device.device_name;
    result.accountName = account.nombre;
    result.reachability = reach;

    if (!reach.reachable) {
        result.warning = `⚠️ El comando se envió pero el dispositivo puede no recibirlo: ${reach.warnings.join('; ')}`;
    }

    return result;
}

async function unlockDeviceByImei(MdmAccount, imei) {
    const { account, device } = await findDeviceByImei(MdmAccount, imei);
    if (!account || !device) {
        throw new Error(`Dispositivo con IMEI ${imei} no encontrado en ninguna cuenta MDM`);
    }
    // FIX: device_id siempre como string (precisión de IDs de 18 dígitos)
    return await unlockDevice(account, String(device.device_id));
}

// ============================================================
// EXTRAS
// ============================================================

async function ringDevice(account, deviceId) {
    const headers = await getHeaders(account);
    const r = await axios.post(
        `https://mdm.manageengine.com/api/v1/mdm/devices/${deviceId}/actions/remote_alarm`,
        {},
        { headers, validateStatus: () => true }
    );
    return { success: r.status >= 200 && r.status < 300, action: 'ring', deviceId, response: r.data };
}

async function getDeviceLocation(account, deviceId) {
    const headers = await getHeaders(account);
    const response = await axios.get(
        `https://mdm.manageengine.com/api/v1/mdm/devices/${deviceId}/location`,
        { headers }
    );
    return response.data;
}

async function testAccountConnection(account) {
    try {
        const devices = await getDevicesFromAccount(account);
        const activeCount = devices.filter(d => d.is_removed === 'false' || d.is_removed === false).length;
        return { success: true, message: 'Conexión exitosa', deviceCount: activeCount };
    } catch (error) {
        return { success: false, message: 'Error de conexión', error: error.message };
    }
}

async function checkAllAccounts(MdmAccount) {
    const accounts = await MdmAccount.findAll({ where: { activo: true } });
    const results = [];
    for (const account of accounts) {
        const status = await testAccountConnection(account);
        results.push({ id: account.id, nombre: account.nombre, activo: account.activo, ...status });
    }
    return results;
}

// ============================================================
// DIAGNÓSTICO DE UN IMEI SIN BLOQUEAR
// ============================================================

async function diagnoseImei(MdmAccount, imei) {
    const { account, device } = await findDeviceByImei(MdmAccount, imei);

    if (!account) {
        return {
            found: false,
            imei,
            normalizedImei: normalizeImei(imei),
            reason: 'IMEI no encontrado en ninguna cuenta MDM',
            suggestion: 'Verifica que el agente MDM esté instalado y enrolado, y que el IMEI esté bien capturado en tu BD'
        };
    }

    const reach = checkDeviceReachability(device);
    return {
        found: true,
        imei,
        normalizedImei: normalizeImei(imei),
        accountName: account.nombre,
        deviceId: device.device_id,
        deviceName: device.name || device.device_name,
        deviceStatus: device.device_status,
        lastContact: device.last_contacted_time || device.last_contact_time || null,
        isRemoved: device.is_removed,
        reachable: reach.reachable,
        warnings: reach.warnings,
        rawDevice: device
    };
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
    refreshAccessToken,
    diagnoseImei,
    normalizeImei,
    checkDeviceReachability
};

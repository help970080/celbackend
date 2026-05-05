/**
 * mdmImportService.js
 * Servicio para importar IMEIs desde Zoho a la BD local.
 *
 * Funcionalidades:
 *   - importAllFromZoho: jala todos los devices de las 3 cuentas y los guarda en devices_mdm
 *   - lockAllDevices: bloquea todos los devices que no estén ya bloqueados
 *   - getOrphanDevices: devuelve devices sin sale_id
 *   - getSalesWithoutDevice: devuelve ventas a crédito sin device vinculado
 *   - linkDeviceToSale: vincula un device a una venta
 */

const mdmService = require('./mdmService');

/**
 * Importa todos los devices de Zoho a la BD local.
 * Si ya existen (mismo IMEI), los actualiza pero NO sobreescribe sale_id.
 */
async function importAllFromZoho(models, options = {}) {
    const { DeviceMdm, MdmAccount, AuditLog } = models;
    const accounts = await mdmService.getActiveAccounts(MdmAccount);

    const results = {
        accountsProcessed: 0,
        totalFromZoho: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        errors: []
    };

    for (const account of accounts) {
        try {
            const zohoDevices = await mdmService.getDevicesFromAccount(account);
            results.accountsProcessed++;
            results.totalFromZoho += zohoDevices.length;

            console.log(`📥 Importando ${zohoDevices.length} devices de cuenta "${account.nombre}"`);

            for (const zd of zohoDevices) {
                try {
                    // Saltar dispositivos removidos
                    if (zd.is_removed === 'true' || zd.is_removed === true) {
                        results.skipped++;
                        continue;
                    }

                    // Normalizar IMEI: Zoho puede devolverlo como array o string
                    let imei = null;
                    if (Array.isArray(zd.imei) && zd.imei.length > 0) {
                        imei = String(zd.imei[0]).replace(/[\s\-\.]/g, '').trim();
                    } else if (zd.imei) {
                        imei = String(zd.imei).replace(/[\s\-\.]/g, '').trim();
                    }

                    if (!imei) {
                        results.skipped++;
                        continue;
                    }

                    const deviceName = zd.name || zd.device_name || `Device-${zd.device_id}`;

                    // FIX: device_number nunca null
                    let deviceNumber = zd.device_id || zd.deviceId || zd.udid;
                    if (!deviceNumber) deviceNumber = `IMEI-${imei}`;
                    deviceNumber = String(deviceNumber);

                    // FIX: tienda_id nunca null (default 1 si la cuenta no la tiene)
                    const tiendaId = account.tiendaId || 1;

                    // Buscar si ya existe
                    const existing = await DeviceMdm.findOne({ where: { imei } });

                    if (existing) {
                        const updateData = {
                            device_number: deviceNumber,
                            mdm_account_id: account.id
                        };
                        if (existing.status !== 'locked') {
                            updateData.status = 'active';
                        }
                        // Solo asignar tienda_id si está vacía
                        if (!existing.tienda_id) {
                            updateData.tienda_id = tiendaId;
                        }
                        await existing.update(updateData);
                        results.updated++;
                    } else {
                        await DeviceMdm.create({
                            imei,
                            device_number: deviceNumber,
                            status: 'active',
                            mdm_account_id: account.id,
                            tienda_id: tiendaId,
                            sale_id: null,
                            client_id: null
                        });
                        results.created++;
                    }
                } catch (deviceError) {
                    console.error(`Error importando device ${zd.device_id}:`, deviceError.message);
                    results.errors.push({
                        deviceId: zd.device_id,
                        error: deviceError.message
                    });
                }
            }
        } catch (accountError) {
            console.error(`Error con cuenta ${account.nombre}:`, accountError.message);
            results.errors.push({
                account: account.nombre,
                error: accountError.message
            });
        }
    }

    if (AuditLog) {
        try {
            await AuditLog.create({
                tabla: 'devices_mdm',
                accion: 'IMPORTACION MASIVA ZOHO',
                descripcion: `Importados desde Zoho: creados ${results.created}, actualizados ${results.updated}, errores ${results.errors.length}`,
                tienda_id: null
            });
        } catch (e) {}
    }

    console.log(`✅ Importación completa: ${results.created} nuevos, ${results.updated} actualizados, ${results.skipped} saltados, ${results.errors.length} errores`);
    return results;
}

/**
 * Bloquea TODOS los devices activos en BD.
 * Útil para hacer un bloqueo masivo inicial.
 */
async function lockAllDevices(models, options = {}) {
    const { DeviceMdm, MdmAccount, AuditLog } = models;
    const message = options.message || `Equipo bloqueado. Contacte a CelExpress: ${process.env.CELEXPRESS_PHONE || ''}`;
    const reason = options.reason || 'Bloqueo masivo administrativo';
    const user = options.user || 'sistema';

    const results = {
        attempted: 0,
        locked: 0,
        alreadyLocked: 0,
        failed: 0,
        errors: []
    };

    const devices = await DeviceMdm.findAll({
        where: {
            status: ['active'],
            ...(options.storeFilter || {})
        }
    });

    console.log(`🔒 Bloqueo masivo: ${devices.length} dispositivos a procesar`);

    for (const device of devices) {
        results.attempted++;

        if (!device.imei) {
            results.failed++;
            results.errors.push({ deviceId: device.id, error: 'Sin IMEI' });
            continue;
        }

        try {
            const lockResult = await mdmService.lockDeviceByImei(
                MdmAccount,
                device.imei,
                message,
                process.env.CELEXPRESS_PHONE
            );

            await device.update({
                status: 'locked',
                last_locked_at: new Date(),
                lock_reason: reason
            });

            if (AuditLog) {
                try {
                    await AuditLog.create({
                        tabla: 'devices_mdm',
                        accion: 'BLOQUEO MASIVO',
                        descripcion: `IMEI ${device.imei} bloqueado en operación masiva. Razón: ${reason}. Por: ${user}${lockResult.warning ? '. ' + lockResult.warning : ''}`,
                        tienda_id: device.tienda_id
                    });
                } catch (e) {}
            }

            results.locked++;
            console.log(`   ✅ ${device.imei} bloqueado${lockResult.warning ? ' (con advertencia)' : ''}`);
        } catch (error) {
            results.failed++;
            results.errors.push({
                deviceId: device.id,
                imei: device.imei,
                error: error.message
            });
            console.error(`   ❌ ${device.imei}: ${error.message}`);
        }
    }

    console.log(`✅ Bloqueo masivo completado: ${results.locked} bloqueados, ${results.failed} fallaron`);
    return results;
}

/**
 * Devices sin sale_id (huérfanos)
 */
async function getOrphanDevices(models, options = {}) {
    const { DeviceMdm } = models;
    const { Op } = require('sequelize');

    const devices = await DeviceMdm.findAll({
        where: {
            sale_id: null,
            ...(options.storeFilter || {})
        },
        order: [['id', 'ASC']]
    });

    return devices.map(d => ({
        deviceId: d.id,
        imei: d.imei,
        deviceNumber: d.device_number,
        status: d.status,
        lockedAt: d.last_locked_at,
        lockReason: d.lock_reason,
        tiendaId: d.tienda_id,
        mdmAccountId: d.mdm_account_id
    }));
}

/**
 * Ventas a crédito sin device vinculado
 */
async function getSalesWithoutDevice(models, options = {}) {
    const { Sale, Client, DeviceMdm } = models;
    const { Op } = require('sequelize');

    // IDs de ventas que YA tienen device
    const linkedSaleIds = await DeviceMdm.findAll({
        attributes: ['sale_id'],
        where: { sale_id: { [Op.ne]: null } },
        raw: true
    });
    const linkedIds = linkedSaleIds.map(d => d.sale_id);

    const sales = await Sale.findAll({
        where: {
            isCredit: true,
            id: { [Op.notIn]: linkedIds.length ? linkedIds : [0] },
            ...(options.storeFilter || {})
        },
        include: [{ model: Client, as: 'client' }],
        order: [['saleDate', 'DESC']]
    });

    return sales.map(s => ({
        saleId: s.id,
        saleDate: s.saleDate,
        status: s.status,
        balanceDue: s.balanceDue,
        weeklyPaymentAmount: s.weeklyPaymentAmount,
        clientId: s.clientId,
        clientName: s.client ? `${s.client.name || ''} ${s.client.lastName || ''}`.trim() : 'Sin cliente',
        clientPhone: s.client?.phone || s.client?.telefono || null,
        tiendaId: s.tiendaId
    }));
}

/**
 * Vincula un device a una venta
 */
async function linkDeviceToSale(models, deviceId, saleId, options = {}) {
    const { DeviceMdm, Sale, AuditLog } = models;

    const device = await DeviceMdm.findByPk(deviceId);
    if (!device) throw new Error(`Device ${deviceId} no encontrado`);

    const sale = await Sale.findByPk(saleId);
    if (!sale) throw new Error(`Venta ${saleId} no encontrada`);

    if (device.sale_id && device.sale_id !== parseInt(saleId)) {
        throw new Error(`Device ya está vinculado a la venta ${device.sale_id}. Desvincula primero.`);
    }

    await device.update({
        sale_id: sale.id,
        client_id: sale.clientId,
        tienda_id: sale.tiendaId || device.tienda_id
    });

    if (AuditLog) {
        try {
            await AuditLog.create({
                tabla: 'devices_mdm',
                accion: 'VINCULACION MANUAL',
                descripcion: `Device ${deviceId} (IMEI ${device.imei}) vinculado a venta ${saleId}. Por: ${options.user || 'sistema'}`,
                tienda_id: device.tienda_id
            });
        } catch (e) {}
    }

    return {
        success: true,
        device: {
            id: device.id,
            imei: device.imei,
            sale_id: device.sale_id,
            client_id: device.client_id
        }
    };
}

/**
 * Desvincula un device de su venta
 */
async function unlinkDevice(models, deviceId, options = {}) {
    const { DeviceMdm, AuditLog } = models;
    const device = await DeviceMdm.findByPk(deviceId);
    if (!device) throw new Error(`Device ${deviceId} no encontrado`);

    const oldSaleId = device.sale_id;
    await device.update({
        sale_id: null,
        client_id: null
    });

    if (AuditLog) {
        try {
            await AuditLog.create({
                tabla: 'devices_mdm',
                accion: 'DESVINCULACION',
                descripcion: `Device ${deviceId} desvinculado de venta ${oldSaleId}. Por: ${options.user || 'sistema'}`,
                tienda_id: device.tienda_id
            });
        } catch (e) {}
    }

    return { success: true, deviceId, oldSaleId };
}

module.exports = {
    importAllFromZoho,
    lockAllDevices,
    getOrphanDevices,
    getSalesWithoutDevice,
    linkDeviceToSale,
    unlinkDevice
};

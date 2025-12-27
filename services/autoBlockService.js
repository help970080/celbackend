/**
 * Auto-bloqueo MDM - Lee cuentas desde BD
 */

const mdmService = require('./mdmService');

// Calcula días de atraso
function calculateDaysLate(sale) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const payments = sale.payments || [];
    const lastPayment = payments.length > 0
        ? payments.sort((a, b) => new Date(b.fecha) - new Date(a.fecha))[0]
        : null;

    const lastPaymentDate = lastPayment ? new Date(lastPayment.fecha) : new Date(sale.fecha);

    const frequency = sale.frecuenciaPago || 'semanal';
    let daysToAdd = 7;
    if (frequency === 'quincenal') daysToAdd = 15;
    if (frequency === 'mensual') daysToAdd = 30;

    const dueDate = new Date(lastPaymentDate);
    dueDate.setDate(dueDate.getDate() + daysToAdd);
    dueDate.setHours(0, 0, 0, 0);

    return Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
}

// Procesa bloqueos automáticos
async function processAutoBlocks(models, options = {}) {
    const { Sale, Payment, Client, DeviceMdm, MdmAccount, AuditLog } = models;
    const daysToBlock = parseInt(process.env.MDM_DAYS_TO_BLOCK) || 2;
    const results = { processed: 0, blocked: 0, errors: [] };

    try {
        const sales = await Sale.findAll({
            where: { tipoVenta: 'credito', estatus: 'activa', ...options.storeFilter },
            include: [
                { model: Payment, as: 'payments' },
                { model: Client, as: 'client' },
                { model: DeviceMdm, as: 'device', required: true }
            ]
        });

        console.log(`📱 Auto-bloqueo: Procesando ${sales.length} ventas con dispositivo`);

        for (const sale of sales) {
            results.processed++;
            try {
                if (sale.device.status === 'locked') continue;

                const daysLate = calculateDaysLate(sale);

                if (daysLate >= daysToBlock) {
                    console.log(`🔒 Bloqueando ${sale.client?.nombre} - ${daysLate} días de atraso`);

                    await mdmService.lockDeviceByImei(
                        MdmAccount,
                        sale.device.imei,
                        `Pago vencido hace ${daysLate} días. Contacte a CelExpress.`,
                        process.env.CELEXPRESS_PHONE
                    );

                    await sale.device.update({
                        status: 'locked',
                        lastLockedAt: new Date(),
                        lockReason: `Auto-bloqueo: ${daysLate} días de atraso`
                    });

                    if (AuditLog) {
                        await AuditLog.create({
                            tabla: 'devices_mdm',
                            accion: 'BLOQUEO AUTOMÁTICO',
                            descripcion: `IMEI ${sale.device.imei} bloqueado. Cliente: ${sale.client?.nombre}. Atraso: ${daysLate} días`,
                            tiendaId: sale.tiendaId
                        });
                    }

                    results.blocked++;
                }
            } catch (error) {
                results.errors.push({ saleId: sale.id, error: error.message });
            }
        }

        console.log(`✅ Auto-bloqueo: ${results.blocked} dispositivos bloqueados`);
    } catch (error) {
        results.errors.push({ general: error.message });
    }

    return results;
}

// Procesa desbloqueos automáticos
async function processAutoUnblocks(models, options = {}) {
    const { Sale, Payment, Client, DeviceMdm, MdmAccount, AuditLog } = models;
    const daysToBlock = parseInt(process.env.MDM_DAYS_TO_BLOCK) || 2;
    const results = { processed: 0, unblocked: 0, errors: [] };

    try {
        const sales = await Sale.findAll({
            where: { tipoVenta: 'credito', estatus: 'activa', ...options.storeFilter },
            include: [
                { model: Payment, as: 'payments' },
                { model: Client, as: 'client' },
                { model: DeviceMdm, as: 'device', required: true, where: { status: 'locked' } }
            ]
        });

        console.log(`🔓 Auto-desbloqueo: Procesando ${sales.length} dispositivos bloqueados`);

        for (const sale of sales) {
            results.processed++;
            try {
                const daysLate = calculateDaysLate(sale);

                if (daysLate < daysToBlock || sale.saldoPendiente <= 0) {
                    console.log(`🔓 Desbloqueando ${sale.client?.nombre}`);

                    await mdmService.unlockDeviceByImei(MdmAccount, sale.device.imei);

                    await sale.device.update({
                        status: 'active',
                        lastUnlockedAt: new Date(),
                        lockReason: null
                    });

                    if (AuditLog) {
                        await AuditLog.create({
                            tabla: 'devices_mdm',
                            accion: 'DESBLOQUEO AUTOMÁTICO',
                            descripcion: `IMEI ${sale.device.imei} desbloqueado. Cliente: ${sale.client?.nombre}`,
                            tiendaId: sale.tiendaId
                        });
                    }

                    results.unblocked++;
                }
            } catch (error) {
                results.errors.push({ saleId: sale.id, error: error.message });
            }
        }

        console.log(`✅ Auto-desbloqueo: ${results.unblocked} dispositivos desbloqueados`);
    } catch (error) {
        results.errors.push({ general: error.message });
    }

    return results;
}

// Ejecuta ciclo completo
async function runFullCycle(models, options = {}) {
    console.log('🔄 Iniciando ciclo MDM...');
    const blocks = await processAutoBlocks(models, options);
    const unblocks = await processAutoUnblocks(models, options);
    return { timestamp: new Date().toISOString(), blocks, unblocks };
}

// Estadísticas
async function getStats(models, options = {}) {
    const { DeviceMdm } = models;
    const where = options.storeFilter?.tienda_id ? { tiendaId: options.storeFilter.tienda_id } : {};

    return {
        total: await DeviceMdm.count({ where }),
        active: await DeviceMdm.count({ where: { ...where, status: 'active' } }),
        locked: await DeviceMdm.count({ where: { ...where, status: 'locked' } }),
        wiped: await DeviceMdm.count({ where: { ...where, status: 'wiped' } })
    };
}

module.exports = { calculateDaysLate, processAutoBlocks, processAutoUnblocks, runFullCycle, getStats };

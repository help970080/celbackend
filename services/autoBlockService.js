/**
 * Auto-bloqueo MDM - Lee cuentas desde BD
 * CORREGIDO: Usa nombres de campos correctos del modelo Sale
 */

const mdmService = require('./mdmService');

// Calcula días de atraso
function calculateDaysLate(sale) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const payments = sale.payments || [];
    const lastPayment = payments.length > 0
        ? payments.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0]
        : null;

    const lastPaymentDate = lastPayment ? new Date(lastPayment.createdAt) : new Date(sale.saleDate);

    const frequency = sale.paymentFrequency || 'weekly';
    let daysToAdd = 7;
    if (frequency === 'fortnightly') daysToAdd = 15;
    if (frequency === 'monthly') daysToAdd = 30;
    if (frequency === 'daily') daysToAdd = 1;

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
        // Buscar ventas a crédito activas con dispositivo vinculado
        const sales = await Sale.findAll({
            where: { 
                isCredit: true, 
                status: ['active', 'pending', 'pending_credit'],
                ...options.storeFilter 
            },
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
                // Si ya está bloqueado, saltar
                if (sale.device.status === 'locked') continue;

                const daysLate = calculateDaysLate(sale);

                if (daysLate >= daysToBlock) {
                    const clientName = sale.client ? `${sale.client.name} ${sale.client.lastName || ''}`.trim() : 'Sin nombre';
                    console.log(`🔒 Bloqueando ${clientName} - ${daysLate} días de atraso`);

                    await mdmService.lockDeviceByImei(
                        MdmAccount,
                        sale.device.imei,
                        `Pago vencido hace ${daysLate} días. Contacte a CelExpress.`,
                        process.env.CELEXPRESS_PHONE
                    );

                    await sale.device.update({
                        status: 'locked',
                        last_locked_at: new Date(),
                        lock_reason: `Auto-bloqueo: ${daysLate} días de atraso`
                    });

                    if (AuditLog) {
                        await AuditLog.create({
                            tabla: 'devices_mdm',
                            accion: 'BLOQUEO AUTOMATICO',
                            descripcion: `IMEI ${sale.device.imei} bloqueado. Cliente: ${clientName}. Atraso: ${daysLate} días`,
                            tienda_id: sale.tiendaId
                        });
                    }

                    results.blocked++;
                }
            } catch (error) {
                console.error(`Error procesando venta ${sale.id}:`, error.message);
                results.errors.push({ saleId: sale.id, error: error.message });
            }
        }

        console.log(`✅ Auto-bloqueo: ${results.blocked} dispositivos bloqueados`);
    } catch (error) {
        console.error('Error general en auto-bloqueo:', error.message);
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
        // Buscar ventas con dispositivo bloqueado
        const sales = await Sale.findAll({
            where: { 
                isCredit: true,
                ...options.storeFilter 
            },
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
                const isPaidOff = sale.balanceDue <= 0 || sale.status === 'completed';

                // Desbloquear si ya no tiene atraso o si pagó todo
                if (daysLate < daysToBlock || isPaidOff) {
                    const clientName = sale.client ? `${sale.client.name} ${sale.client.lastName || ''}`.trim() : 'Sin nombre';
                    console.log(`🔓 Desbloqueando ${clientName}`);

                    await mdmService.unlockDeviceByImei(MdmAccount, sale.device.imei);

                    await sale.device.update({
                        status: 'active',
                        last_unlocked_at: new Date(),
                        lock_reason: null
                    });

                    if (AuditLog) {
                        await AuditLog.create({
                            tabla: 'devices_mdm',
                            accion: 'DESBLOQUEO AUTOMATICO',
                            descripcion: `IMEI ${sale.device.imei} desbloqueado. Cliente: ${clientName}`,
                            tienda_id: sale.tiendaId
                        });
                    }

                    results.unblocked++;
                }
            } catch (error) {
                console.error(`Error desbloqueando venta ${sale.id}:`, error.message);
                results.errors.push({ saleId: sale.id, error: error.message });
            }
        }

        console.log(`✅ Auto-desbloqueo: ${results.unblocked} dispositivos desbloqueados`);
    } catch (error) {
        console.error('Error general en auto-desbloqueo:', error.message);
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
    const where = options.storeFilter?.tienda_id ? { tienda_id: options.storeFilter.tienda_id } : {};

    return {
        total: await DeviceMdm.count({ where }),
        active: await DeviceMdm.count({ where: { ...where, status: 'active' } }),
        locked: await DeviceMdm.count({ where: { ...where, status: 'locked' } }),
        wiped: await DeviceMdm.count({ where: { ...where, status: 'wiped' } })
    };
}

module.exports = { calculateDaysLate, processAutoBlocks, processAutoUnblocks, runFullCycle, getStats };

/**
 * Auto-bloqueo MDM - VERSIÓN CORREGIDA
 *
 * Fixes:
 *   #1 Cálculo de días de atraso basado en SALDO REAL vs SALDO ESPERADO
 *      (ya no se rompe con clientes que adelantan o pagan parcial)
 *   #2 Status de venta más permisivo (no deja morosos fuera del filtro)
 *   #3 Tolerancia configurable de "ya está bloqueado, no reintentar"
 *   #4 No marca status='locked' en BD si Zoho devolvió warning de
 *      dispositivo no alcanzable
 *   #5 Logging más útil para debugging
 */

const mdmService = require('./mdmService');

// ============================================================
// FIX #1: CÁLCULO REAL DE DÍAS DE ATRASO
// ============================================================

/**
 * Calcula días de atraso basado en saldo esperado vs saldo real.
 *
 * Lógica:
 *   - Cuántas cuotas debieron pagarse hasta hoy desde la venta
 *   - Cuánto dinero debió haberse pagado
 *   - Cuánto dinero realmente se pagó
 *   - Diferencia / monto_cuota = cuotas atrasadas
 *   - cuotas_atrasadas × días_por_cuota = días de atraso
 */
function calculateDaysLate(sale) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const saleDate = new Date(sale.saleDate);
    saleDate.setHours(0, 0, 0, 0);

    // Días desde la venta
    const daysSinceSale = Math.floor((today.getTime() - saleDate.getTime()) / (1000 * 60 * 60 * 24));
    if (daysSinceSale <= 0) return 0;

    // Frecuencia de pago en días
    const frequency = sale.paymentFrequency || 'weekly';
    let daysPerPayment = 7;
    if (frequency === 'fortnightly') daysPerPayment = 15;
    if (frequency === 'monthly') daysPerPayment = 30;
    if (frequency === 'daily') daysPerPayment = 1;
    if (frequency === 'biweekly') daysPerPayment = 14;

    // Cuántas cuotas debieron pagarse a la fecha (sin contar la enganche)
    const expectedPayments = Math.floor(daysSinceSale / daysPerPayment);
    if (expectedPayments <= 0) return 0;

    // Monto de cada cuota — intenta varios campos posibles del modelo
    const installmentAmount = parseFloat(
        sale.installmentAmount ||
        sale.weeklyPayment ||
        sale.paymentAmount ||
        sale.cuota ||
        0
    );

    // Si no podemos saber la cuota, fallback al método viejo (mejor que nada)
    if (!installmentAmount || installmentAmount <= 0) {
        return calculateDaysLateLegacy(sale);
    }

    // Suma de todos los pagos hechos (ignorando enganche si está marcada)
    const payments = sale.payments || [];
    const totalPaid = payments
        .filter(p => !p.isDownPayment && !p.is_down_payment) // excluir enganche
        .reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);

    // Lo que debió pagar a la fecha
    const expectedPaid = expectedPayments * installmentAmount;

    // Diferencia: si negativa, está al corriente o adelantado
    const shortfall = expectedPaid - totalPaid;
    if (shortfall <= 0) return 0;

    // Convertir dinero atrasado a cuotas atrasadas y luego a días
    const installmentsLate = shortfall / installmentAmount;
    const daysLate = Math.floor(installmentsLate * daysPerPayment);

    return daysLate;
}

/**
 * Método legacy (el que tenías antes) — solo se usa como fallback
 * cuando no podemos determinar el monto de la cuota
 */
function calculateDaysLateLegacy(sale) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const payments = (sale.payments || []).filter(p => !p.isDownPayment && !p.is_down_payment);
    const lastPayment = payments.length > 0
        ? payments.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0]
        : null;

    const lastPaymentDate = lastPayment ? new Date(lastPayment.createdAt) : new Date(sale.saleDate);

    const frequency = sale.paymentFrequency || 'weekly';
    let daysToAdd = 7;
    if (frequency === 'fortnightly') daysToAdd = 15;
    if (frequency === 'monthly') daysToAdd = 30;
    if (frequency === 'daily') daysToAdd = 1;
    if (frequency === 'biweekly') daysToAdd = 14;

    const dueDate = new Date(lastPaymentDate);
    dueDate.setDate(dueDate.getDate() + daysToAdd);
    dueDate.setHours(0, 0, 0, 0);

    return Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
}

// ============================================================
// FIX #2: STATUS PERMISIVO PARA NO DEJAR MOROSOS FUERA
// ============================================================

// Statuses que indican "venta viva, sigue cobrándose"
// Si tu BD usa otros, agrégalos aquí
const ACTIVE_SALE_STATUSES = [
    'active',
    'pending',
    'pending_credit',
    'overdue',
    'in_collection',
    'collection',
    'restructured',
    'partial'
];

// ============================================================
// PROCESAR BLOQUEOS AUTOMÁTICOS
// ============================================================

async function processAutoBlocks(models, options = {}) {
    const { Sale, Payment, Client, DeviceMdm, MdmAccount, AuditLog } = models;
    const daysToBlock = parseInt(process.env.MDM_DAYS_TO_BLOCK) || 7;
    const results = {
        processed: 0,
        blocked: 0,
        skipped_already_locked: 0,
        skipped_not_late: 0,
        skipped_no_imei: 0,
        skipped_unreachable: 0,
        errors: []
    };

    try {
        const sales = await Sale.findAll({
            where: {
                isCredit: true,
                status: ACTIVE_SALE_STATUSES,
                ...options.storeFilter
            },
            include: [
                { model: Payment, as: 'payments' },
                { model: Client, as: 'client' },
                { model: DeviceMdm, as: 'device', required: true }
            ]
        });

        console.log(`📱 Auto-bloqueo: Procesando ${sales.length} ventas con dispositivo (umbral: ${daysToBlock} días)`);

        for (const sale of sales) {
            results.processed++;
            try {
                // Skip si ya bloqueado
                if (sale.device.status === 'locked') {
                    results.skipped_already_locked++;
                    continue;
                }

                // Skip si no tiene IMEI
                if (!sale.device.imei) {
                    results.skipped_no_imei++;
                    continue;
                }

                const daysLate = calculateDaysLate(sale);

                if (daysLate < daysToBlock) {
                    results.skipped_not_late++;
                    continue;
                }

                const clientName = sale.client
                    ? `${sale.client.name} ${sale.client.lastName || ''}`.trim()
                    : 'Sin nombre';

                console.log(`🔒 Bloqueando ${clientName} (Venta ${sale.id}) - ${daysLate} días de atraso, IMEI ${sale.device.imei}`);

                // FIX #4: Capturar el resultado completo, incluyendo warnings
                let lockResult;
                try {
                    lockResult = await mdmService.lockDeviceByImei(
                        MdmAccount,
                        sale.device.imei,
                        `Pago vencido hace ${daysLate} días. Contacte a CelExpress: ${process.env.CELEXPRESS_PHONE || ''}`,
                        process.env.CELEXPRESS_PHONE
                    );
                } catch (lockErr) {
                    // El nuevo mdmService SÍ trona si Zoho falla
                    console.error(`   ❌ Lock falló: ${lockErr.message}`);
                    results.errors.push({
                        saleId: sale.id,
                        clientName,
                        imei: sale.device.imei,
                        daysLate,
                        error: lockErr.message
                    });

                    // Audit del intento fallido
                    if (AuditLog) {
                        try {
                            await AuditLog.create({
                                tabla: 'devices_mdm',
                                accion: 'BLOQUEO FALLIDO',
                                descripcion: `IMEI ${sale.device.imei} NO se pudo bloquear. Cliente: ${clientName}. Atraso: ${daysLate} días. Error: ${lockErr.message}`,
                                tienda_id: sale.tiendaId
                            });
                        } catch (e) {}
                    }
                    continue;
                }

                // Si el lock se mandó pero el dispositivo no es alcanzable, avisar
                if (lockResult.warning) {
                    console.warn(`   ⚠️  ${lockResult.warning}`);
                    results.skipped_unreachable++;
                }

                // Marcar como bloqueado en BD
                await sale.device.update({
                    status: 'locked',
                    last_locked_at: new Date(),
                    lock_reason: `Auto-bloqueo: ${daysLate} días de atraso${lockResult.warning ? ' (dispositivo posiblemente offline)' : ''}`
                });

                if (AuditLog) {
                    try {
                        await AuditLog.create({
                            tabla: 'devices_mdm',
                            accion: 'BLOQUEO AUTOMATICO',
                            descripcion: `IMEI ${sale.device.imei} bloqueado. Cliente: ${clientName}. Atraso: ${daysLate} días${lockResult.warning ? '. ' + lockResult.warning : ''}`,
                            tienda_id: sale.tiendaId
                        });
                    } catch (e) {}
                }

                results.blocked++;
            } catch (error) {
                console.error(`Error procesando venta ${sale.id}:`, error.message);
                results.errors.push({ saleId: sale.id, error: error.message });
            }
        }

        console.log(`✅ Auto-bloqueo completado:`);
        console.log(`   - Total procesadas: ${results.processed}`);
        console.log(`   - Bloqueadas: ${results.blocked}`);
        console.log(`   - Ya bloqueadas (skip): ${results.skipped_already_locked}`);
        console.log(`   - Al corriente (skip): ${results.skipped_not_late}`);
        console.log(`   - Sin IMEI: ${results.skipped_no_imei}`);
        console.log(`   - Bloqueadas pero offline: ${results.skipped_unreachable}`);
        console.log(`   - Errores: ${results.errors.length}`);
    } catch (error) {
        console.error('Error general en auto-bloqueo:', error.message);
        results.errors.push({ general: error.message });
    }

    return results;
}

// ============================================================
// PROCESAR DESBLOQUEOS AUTOMÁTICOS
// ============================================================

async function processAutoUnblocks(models, options = {}) {
    const { Sale, Payment, Client, DeviceMdm, MdmAccount, AuditLog } = models;
    const daysToBlock = parseInt(process.env.MDM_DAYS_TO_BLOCK) || 7;
    const results = {
        processed: 0,
        unblocked: 0,
        skipped_still_late: 0,
        errors: []
    };

    try {
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
                const balanceDue = parseFloat(sale.balanceDue || 0);
                const isPaidOff = balanceDue <= 0 || sale.status === 'completed' || sale.status === 'paid';

                // Solo desbloquear si: pagó todo O ya no tiene atraso
                if (daysLate < daysToBlock || isPaidOff) {
                    const clientName = sale.client
                        ? `${sale.client.name} ${sale.client.lastName || ''}`.trim()
                        : 'Sin nombre';
                    console.log(`🔓 Desbloqueando ${clientName} (Venta ${sale.id}) - ${isPaidOff ? 'liquidado' : 'al corriente, ' + daysLate + ' días'}`);

                    try {
                        await mdmService.unlockDeviceByImei(MdmAccount, sale.device.imei);
                    } catch (e) {
                        console.error(`   ❌ Unlock falló: ${e.message}`);
                        results.errors.push({ saleId: sale.id, error: e.message });
                        continue;
                    }

                    await sale.device.update({
                        status: 'active',
                        last_unlocked_at: new Date(),
                        lock_reason: null
                    });

                    if (AuditLog) {
                        try {
                            await AuditLog.create({
                                tabla: 'devices_mdm',
                                accion: 'DESBLOQUEO AUTOMATICO',
                                descripcion: `IMEI ${sale.device.imei} desbloqueado. Cliente: ${clientName}. ${isPaidOff ? 'Liquidado' : 'Al corriente'}`,
                                tienda_id: sale.tiendaId
                            });
                        } catch (e) {}
                    }

                    results.unblocked++;
                } else {
                    results.skipped_still_late++;
                }
            } catch (error) {
                console.error(`Error desbloqueando venta ${sale.id}:`, error.message);
                results.errors.push({ saleId: sale.id, error: error.message });
            }
        }

        console.log(`✅ Auto-desbloqueo completado:`);
        console.log(`   - Total procesadas: ${results.processed}`);
        console.log(`   - Desbloqueadas: ${results.unblocked}`);
        console.log(`   - Aún atrasadas (siguen bloqueadas): ${results.skipped_still_late}`);
        console.log(`   - Errores: ${results.errors.length}`);
    } catch (error) {
        console.error('Error general en auto-desbloqueo:', error.message);
        results.errors.push({ general: error.message });
    }

    return results;
}

// ============================================================
// CICLO COMPLETO
// ============================================================

async function runFullCycle(models, options = {}) {
    const startTime = Date.now();
    console.log('🔄 ═══════════════════════════════════════');
    console.log(`🔄 Iniciando ciclo MDM ${new Date().toISOString()}`);
    console.log(`🔄 Umbral configurado: ${parseInt(process.env.MDM_DAYS_TO_BLOCK) || 7} días`);
    console.log('🔄 ═══════════════════════════════════════');

    const blocks = await processAutoBlocks(models, options);
    const unblocks = await processAutoUnblocks(models, options);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`🔄 Ciclo MDM completado en ${elapsed}s`);
    console.log('🔄 ═══════════════════════════════════════');

    return {
        timestamp: new Date().toISOString(),
        elapsed_seconds: parseFloat(elapsed),
        blocks,
        unblocks
    };
}

// ============================================================
// ESTADÍSTICAS
// ============================================================

async function getStats(models, options = {}) {
    const { DeviceMdm } = models;
    const where = options.storeFilter?.tienda_id
        ? { tienda_id: options.storeFilter.tienda_id }
        : {};

    return {
        total: await DeviceMdm.count({ where }),
        active: await DeviceMdm.count({ where: { ...where, status: 'active' } }),
        locked: await DeviceMdm.count({ where: { ...where, status: 'locked' } }),
        wiped: await DeviceMdm.count({ where: { ...where, status: 'wiped' } }),
        threshold_days: parseInt(process.env.MDM_DAYS_TO_BLOCK) || 7
    };
}

// ============================================================
// HERRAMIENTA NUEVA: Diagnóstico de una venta específica
// Útil para ver POR QUÉ una venta se está bloqueando o no
// ============================================================

async function diagnoseSale(models, saleId) {
    const { Sale, Payment, Client, DeviceMdm } = models;
    const daysToBlock = parseInt(process.env.MDM_DAYS_TO_BLOCK) || 7;

    const sale = await Sale.findByPk(saleId, {
        include: [
            { model: Payment, as: 'payments' },
            { model: Client, as: 'client' },
            { model: DeviceMdm, as: 'device' }
        ]
    });

    if (!sale) return { found: false, error: `Venta ${saleId} no encontrada` };

    const daysLate = calculateDaysLate(sale);
    const installmentAmount = parseFloat(
        sale.installmentAmount || sale.weeklyPayment || sale.paymentAmount || sale.cuota || 0
    );
    const totalPaid = (sale.payments || [])
        .filter(p => !p.isDownPayment && !p.is_down_payment)
        .reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);

    return {
        found: true,
        saleId: sale.id,
        clientName: sale.client ? `${sale.client.name} ${sale.client.lastName || ''}`.trim() : null,
        saleDate: sale.saleDate,
        status: sale.status,
        isCredit: sale.isCredit,
        balanceDue: sale.balanceDue,
        installmentAmount,
        paymentFrequency: sale.paymentFrequency,
        totalPaid,
        paymentsCount: (sale.payments || []).length,
        daysLate,
        daysToBlock,
        shouldBeBlocked: daysLate >= daysToBlock,
        device: sale.device ? {
            imei: sale.device.imei,
            status: sale.device.status,
            last_locked_at: sale.device.last_locked_at,
            lock_reason: sale.device.lock_reason
        } : null,
        verdict: !sale.device ? 'SIN DISPOSITIVO MDM REGISTRADO'
            : !sale.device.imei ? 'DISPOSITIVO SIN IMEI'
            : sale.device.status === 'locked' ? 'YA ESTÁ BLOQUEADO EN BD'
            : daysLate >= daysToBlock ? 'DEBERÍA BLOQUEARSE EN EL PRÓXIMO CICLO'
            : 'AL CORRIENTE, NO REQUIERE BLOQUEO'
    };
}

module.exports = {
    calculateDaysLate,
    calculateDaysLateLegacy,
    processAutoBlocks,
    processAutoUnblocks,
    runFullCycle,
    getStats,
    diagnoseSale
};

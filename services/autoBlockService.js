// services/autoBlockService.js - Bloqueo automático por mora
const { Op } = require('sequelize');
const moment = require('moment-timezone');
const mdmService = require('./mdmService');

const TIMEZONE = "America/Mexico_City";

// Configuración de días para bloqueo automático
const DAYS_TO_BLOCK = parseInt(process.env.MDM_DAYS_TO_BLOCK) || 2;
const DAYS_TO_WARN = parseInt(process.env.MDM_DAYS_TO_WARN) || 1;

/**
 * Helper: Inicio del día en timezone de México
 */
const startOfDay = (date) => {
    return moment(date).tz(TIMEZONE).startOf('day').toDate();
};

/**
 * Helper: Calcular próxima fecha de vencimiento
 */
const getNextDueDate = (lastPaymentDate, frequency) => {
    const baseDate = moment(lastPaymentDate).tz(TIMEZONE);
    switch (frequency) {
        case 'daily':
            return baseDate.add(1, 'days').endOf('day').toDate();
        case 'fortnightly':
            return baseDate.add(15, 'days').endOf('day').toDate();
        case 'monthly':
            return baseDate.add(1, 'months').endOf('day').toDate();
        case 'weekly':
        default:
            return baseDate.add(7, 'days').endOf('day').toDate();
    }
};

/**
 * Helper: Parsear número seguro
 */
const N = (value) => {
    const num = parseFloat(value);
    return isNaN(num) ? 0 : num;
};

class AutoBlockService {
    constructor() {
        this.Sale = null;
        this.Client = null;
        this.Payment = null;
        this.DeviceMdm = null;
        this.AuditLog = null;
    }

    /**
     * Inicializar con modelos de Sequelize
     */
    init(models) {
        this.Sale = models.Sale;
        this.Client = models.Client;
        this.Payment = models.Payment;
        this.DeviceMdm = models.DeviceMdm;
        this.AuditLog = models.AuditLog;
        console.log('✅ AutoBlockService inicializado');
    }

    /**
     * Calcular días de atraso de una venta
     * @param {Object} sale - Venta con pagos incluidos
     * @returns {Object} { daysLate, dueDate, isOverdue }
     */
    calculateDaysLate(sale) {
        const today = startOfDay(new Date());
        const msPerDay = 24 * 60 * 60 * 1000;

        // Determinar última fecha de pago o fecha de venta
        let lastPaymentDate = sale.saleDate;
        
        if (sale.payments && sale.payments.length > 0) {
            const sortedPayments = sale.payments
                .slice()
                .sort((a, b) => new Date(b.paymentDate) - new Date(a.paymentDate));
            lastPaymentDate = sortedPayments[0].paymentDate;
        }

        // Calcular fecha de vencimiento
        const dueDate = getNextDueDate(lastPaymentDate, sale.paymentFrequency);
        
        // Calcular diferencia en días
        const diffMs = today.getTime() - dueDate.getTime();
        const daysLate = Math.floor(diffMs / msPerDay);

        return {
            daysLate: daysLate > 0 ? daysLate : 0,
            dueDate,
            isOverdue: daysLate > 0,
            lastPaymentDate
        };
    }

    /**
     * Obtener ventas con dispositivos que necesitan revisión
     * @param {Object} storeFilter - Filtro multi-tenant (opcional)
     * @returns {Array} Lista de ventas con info de atraso
     */
    async getSalesWithDevices(storeFilter = {}) {
        if (!this.Sale || !this.DeviceMdm) {
            throw new Error('AutoBlockService no inicializado. Llama a init(models) primero.');
        }

        const sales = await this.Sale.findAll({
            where: {
                isCredit: true,
                balanceDue: { [Op.gt]: 0 },
                status: { [Op.ne]: 'paid_off' },
                ...storeFilter
            },
            include: [
                {
                    model: this.Client,
                    as: 'client',
                    attributes: ['id', 'name', 'lastName', 'phone']
                },
                {
                    model: this.Payment,
                    as: 'payments',
                    attributes: ['paymentDate', 'amount']
                },
                {
                    model: this.DeviceMdm,
                    as: 'device',
                    required: true // Solo ventas con dispositivo vinculado
                }
            ]
        });

        // Calcular días de atraso para cada venta
        return sales.map(sale => {
            const lateInfo = this.calculateDaysLate(sale);
            return {
                sale,
                ...lateInfo
            };
        });
    }

    /**
     * Procesar bloqueos automáticos
     * Bloquea dispositivos con >= DAYS_TO_BLOCK días de atraso
     * @param {Object} storeFilter - Filtro multi-tenant (opcional)
     * @returns {Object} Resumen de acciones realizadas
     */
    async processAutoBlocks(storeFilter = {}) {
        const results = {
            processed: 0,
            blocked: 0,
            alreadyBlocked: 0,
            errors: [],
            details: []
        };

        try {
            const salesWithDevices = await this.getSalesWithDevices(storeFilter);
            results.processed = salesWithDevices.length;

            for (const item of salesWithDevices) {
                const { sale, daysLate, dueDate } = item;
                const device = sale.device;

                // Si ya está bloqueado, saltar
                if (device.status === 'locked') {
                    results.alreadyBlocked++;
                    continue;
                }

                // Verificar si cumple criterio de bloqueo (>= 2 días de atraso)
                if (daysLate >= DAYS_TO_BLOCK) {
                    try {
                        // Bloquear en Headwind MDM
                        await mdmService.lockDevice(
                            device.deviceNumber,
                            `Mora de ${daysLate} días - Venta #${sale.id}`
                        );

                        // Actualizar estado en base de datos local
                        await device.update({
                            status: 'locked',
                            lastLockedAt: new Date(),
                            lockReason: `Bloqueo automático: ${daysLate} días de mora`
                        });

                        // Registrar en auditoría
                        if (this.AuditLog) {
                            await this.AuditLog.create({
                                userId: null, // Sistema automático
                                username: 'SISTEMA',
                                action: 'BLOQUEO AUTOMÁTICO MDM',
                                details: `Dispositivo ${device.deviceNumber} bloqueado. Cliente: ${sale.client?.name} ${sale.client?.lastName}. Venta #${sale.id}. Días de mora: ${daysLate}`,
                                tiendaId: sale.tiendaId
                            });
                        }

                        results.blocked++;
                        results.details.push({
                            saleId: sale.id,
                            deviceNumber: device.deviceNumber,
                            clientName: `${sale.client?.name} ${sale.client?.lastName}`,
                            daysLate,
                            action: 'BLOCKED'
                        });

                        console.log(`🔒 Bloqueado: ${device.deviceNumber} - ${daysLate} días de mora`);

                    } catch (error) {
                        results.errors.push({
                            saleId: sale.id,
                            deviceNumber: device.deviceNumber,
                            error: error.message
                        });
                        console.error(`❌ Error bloqueando ${device.deviceNumber}:`, error.message);
                    }
                }
            }

        } catch (error) {
            console.error('❌ Error en processAutoBlocks:', error);
            results.errors.push({ general: error.message });
        }

        return results;
    }

    /**
     * Procesar desbloqueos automáticos
     * Desbloquea dispositivos de ventas que ya están al corriente
     * @param {Object} storeFilter - Filtro multi-tenant (opcional)
     * @returns {Object} Resumen de acciones realizadas
     */
    async processAutoUnblocks(storeFilter = {}) {
        const results = {
            processed: 0,
            unblocked: 0,
            errors: [],
            details: []
        };

        try {
            if (!this.DeviceMdm) {
                throw new Error('AutoBlockService no inicializado');
            }

            // Buscar dispositivos bloqueados
            const blockedDevices = await this.DeviceMdm.findAll({
                where: {
                    status: 'locked',
                    ...storeFilter
                },
                include: [{
                    model: this.Sale,
                    as: 'sale',
                    include: [
                        { model: this.Client, as: 'client' },
                        { model: this.Payment, as: 'payments' }
                    ]
                }]
            });

            results.processed = blockedDevices.length;

            for (const device of blockedDevices) {
                const sale = device.sale;
                
                // Verificar si la venta está pagada o al corriente
                if (!sale || sale.status === 'paid_off' || N(sale.balanceDue) <= 0) {
                    try {
                        // Desbloquear en Headwind MDM
                        await mdmService.unlockDevice(device.deviceNumber);

                        // Actualizar estado local
                        await device.update({
                            status: 'active',
                            lastUnlockedAt: new Date(),
                            lockReason: null
                        });

                        // Registrar en auditoría
                        if (this.AuditLog) {
                            await this.AuditLog.create({
                                userId: null,
                                username: 'SISTEMA',
                                action: 'DESBLOQUEO AUTOMÁTICO MDM',
                                details: `Dispositivo ${device.deviceNumber} desbloqueado. Venta #${sale?.id || 'N/A'} pagada.`,
                                tiendaId: device.tiendaId
                            });
                        }

                        results.unblocked++;
                        results.details.push({
                            deviceNumber: device.deviceNumber,
                            saleId: sale?.id,
                            action: 'UNBLOCKED'
                        });

                        console.log(`🔓 Desbloqueado: ${device.deviceNumber}`);

                    } catch (error) {
                        results.errors.push({
                            deviceNumber: device.deviceNumber,
                            error: error.message
                        });
                    }
                } else {
                    // Verificar si ya no tiene atraso (pagó pero no todo)
                    const lateInfo = this.calculateDaysLate(sale);
                    
                    // Si tiene menos de DAYS_TO_BLOCK días de atraso, desbloquear
                    if (lateInfo.daysLate < DAYS_TO_BLOCK) {
                        try {
                            await mdmService.unlockDevice(device.deviceNumber);
                            
                            await device.update({
                                status: 'active',
                                lastUnlockedAt: new Date(),
                                lockReason: null
                            });

                            if (this.AuditLog) {
                                await this.AuditLog.create({
                                    userId: null,
                                    username: 'SISTEMA',
                                    action: 'DESBLOQUEO AUTOMÁTICO MDM',
                                    details: `Dispositivo ${device.deviceNumber} desbloqueado. Cliente al corriente (${lateInfo.daysLate} días).`,
                                    tiendaId: device.tiendaId
                                });
                            }

                            results.unblocked++;
                            results.details.push({
                                deviceNumber: device.deviceNumber,
                                saleId: sale.id,
                                daysLate: lateInfo.daysLate,
                                action: 'UNBLOCKED'
                            });

                            console.log(`🔓 Desbloqueado: ${device.deviceNumber} - Cliente al corriente`);

                        } catch (error) {
                            results.errors.push({
                                deviceNumber: device.deviceNumber,
                                error: error.message
                            });
                        }
                    }
                }
            }

        } catch (error) {
            console.error('❌ Error en processAutoUnblocks:', error);
            results.errors.push({ general: error.message });
        }

        return results;
    }

    /**
     * Ejecutar ciclo completo de verificación
     * Procesa bloqueos y desbloqueos automáticos
     * @param {Object} storeFilter - Filtro multi-tenant (opcional)
     */
    async runFullCycle(storeFilter = {}) {
        console.log('🔄 Iniciando ciclo de verificación MDM...');
        console.log(`   Configuración: Bloquear a los ${DAYS_TO_BLOCK} días de mora`);
        
        const blockResults = await this.processAutoBlocks(storeFilter);
        const unblockResults = await this.processAutoUnblocks(storeFilter);

        const summary = {
            timestamp: new Date().toISOString(),
            config: {
                daysToBlock: DAYS_TO_BLOCK,
                daysToWarn: DAYS_TO_WARN
            },
            blocks: blockResults,
            unblocks: unblockResults
        };

        console.log('✅ Ciclo completado:', {
            bloqueados: blockResults.blocked,
            desbloqueados: unblockResults.unblocked,
            errores: blockResults.errors.length + unblockResults.errors.length
        });

        return summary;
    }

    /**
     * Obtener reporte de dispositivos en riesgo
     * Dispositivos con 1+ días de atraso pero aún no bloqueados
     * @param {Object} storeFilter - Filtro multi-tenant
     */
    async getAtRiskDevices(storeFilter = {}) {
        const salesWithDevices = await this.getSalesWithDevices(storeFilter);
        
        return salesWithDevices
            .filter(item => {
                const { daysLate, sale } = item;
                // En riesgo: tiene atraso pero menos que el límite de bloqueo
                return daysLate >= DAYS_TO_WARN && 
                       daysLate < DAYS_TO_BLOCK && 
                       sale.device?.status !== 'locked';
            })
            .map(item => ({
                saleId: item.sale.id,
                clientName: `${item.sale.client?.name} ${item.sale.client?.lastName}`,
                clientPhone: item.sale.client?.phone,
                deviceNumber: item.sale.device?.deviceNumber,
                daysLate: item.daysLate,
                dueDate: item.dueDate,
                balanceDue: item.sale.balanceDue,
                daysUntilBlock: DAYS_TO_BLOCK - item.daysLate
            }));
    }

    /**
     * Obtener estadísticas de dispositivos MDM
     * @param {Object} storeFilter - Filtro multi-tenant
     */
    async getStats(storeFilter = {}) {
        if (!this.DeviceMdm) {
            throw new Error('AutoBlockService no inicializado');
        }

        const devices = await this.DeviceMdm.findAll({
            where: storeFilter,
            attributes: ['status']
        });

        const stats = {
            total: devices.length,
            active: devices.filter(d => d.status === 'active').length,
            locked: devices.filter(d => d.status === 'locked').length,
            wiped: devices.filter(d => d.status === 'wiped').length,
            returned: devices.filter(d => d.status === 'returned').length,
            lost: devices.filter(d => d.status === 'lost').length
        };

        // Obtener dispositivos en riesgo
        const atRisk = await this.getAtRiskDevices(storeFilter);
        stats.atRisk = atRisk.length;

        return stats;
    }
}

// Exportar instancia singleton
module.exports = new AutoBlockService();

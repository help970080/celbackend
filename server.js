// server.js - CON INTEGRACIÓN MDM + TANDAS + LLAMADAS AUTOMÁTICAS TWILIO + IMEI LINK
const express = require('express');
const { Sequelize } = require('sequelize');
const cors = require('cors');
const authMiddleware = require('./middleware/authMiddleware');

require('dotenv').config();
const app = express();
const PORT = process.env.PORT || 5000;

const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres',
  protocol: 'postgres',
  dialectOptions: { ssl: { require: true, rejectUnauthorized: false } },
  logging: false
});

const models = require('./models')(sequelize);
let isRegistrationAllowed = false;

// ============================================================
// ⭐ HELPERS IMEI (usar en endpoints de venta)
// ============================================================
function normalizeImei(raw) {
    if (raw === null || raw === undefined) return null;
    const digits = String(raw).replace(/\D/g, '');
    if (digits.length < 14 || digits.length > 17) return null;
    return digits;
}

function isValidImeiLuhn(imei) {
    if (!imei || imei.length !== 15) return imei && imei.length >= 14;
    let sum = 0;
    for (let i = 0; i < 15; i++) {
        let d = parseInt(imei[i], 10);
        if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
        sum += d;
    }
    return sum % 10 === 0;
}

sequelize.authenticate()
  .then(() => {
    console.log('✅ Conexión exitosa a la base de datos.');
    return sequelize.sync({ force: false });
  })
  .then(async () => {
    console.log('✅ Modelos sincronizados con la base de datos.');
    const adminCount = await models.User.count();
    isRegistrationAllowed = (adminCount === 0);

    // ⭐ VER TODAS LAS TABLAS DE LA BASE DE DATOS
    try {
      console.log('🔍 Listando todas las tablas de la base de datos...');
      const [results] = await sequelize.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        ORDER BY table_name;
      `);
      
      console.log('📋 TABLAS ENCONTRADAS:');
      results.forEach(row => {
        console.log('  - ' + row.table_name);
      });
      console.log('📋 Total de tablas:', results.length);
    } catch (e) {
      console.error('❌ Error al listar tablas:', e.message);
    }

    // ⭐ CREAR TABLA COLLECTION_LOGS SIN FOREIGN KEYS
    try {
      console.log('🔄 Verificando tabla collection_logs...');
      
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS collection_logs (
          id SERIAL PRIMARY KEY,
          sale_id INTEGER NOT NULL,
          collector_id INTEGER NOT NULL,
          contact_type VARCHAR(50) NOT NULL,
          contact_result VARCHAR(100),
          notes TEXT,
          next_contact_date TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE INDEX IF NOT EXISTS idx_collection_logs_sale ON collection_logs(sale_id);
        CREATE INDEX IF NOT EXISTS idx_collection_logs_collector ON collection_logs(collector_id);
        CREATE INDEX IF NOT EXISTS idx_collection_logs_created ON collection_logs(created_at DESC);
      `);
      
      console.log('✅ Tabla collection_logs verificada');
    } catch (e) {
      console.error('❌ Error con tabla collection_logs:', e.message);
    }

    // ⭐ MDM: CREAR TABLA DEVICES_MDM
    try {
      console.log('🔄 Verificando tabla devices_mdm...');
      
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS devices_mdm (
          id SERIAL PRIMARY KEY,
          device_number VARCHAR(100) NOT NULL,
          imei VARCHAR(20),
          serial_number VARCHAR(50),
          brand VARCHAR(50),
          model VARCHAR(100),
          sale_id INTEGER,
          client_id INTEGER,
          status VARCHAR(20) DEFAULT 'active',
          last_locked_at TIMESTAMP,
          last_unlocked_at TIMESTAMP,
          lock_reason VARCHAR(255),
          mdm_configuration_id INTEGER,
          mdm_account_id INTEGER,
          last_latitude DECIMAL(10, 8),
          last_longitude DECIMAL(11, 8),
          last_location_at TIMESTAMP,
          notes TEXT,
          tienda_id INTEGER NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE INDEX IF NOT EXISTS idx_devices_mdm_device_number ON devices_mdm(device_number);
        CREATE INDEX IF NOT EXISTS idx_devices_mdm_imei ON devices_mdm(imei);
        CREATE INDEX IF NOT EXISTS idx_devices_mdm_sale ON devices_mdm(sale_id);
        CREATE INDEX IF NOT EXISTS idx_devices_mdm_client ON devices_mdm(client_id);
        CREATE INDEX IF NOT EXISTS idx_devices_mdm_tienda ON devices_mdm(tienda_id);
        CREATE INDEX IF NOT EXISTS idx_devices_mdm_status ON devices_mdm(status);
        CREATE INDEX IF NOT EXISTS idx_devices_mdm_account ON devices_mdm(mdm_account_id);
      `);
      
      console.log('✅ Tabla devices_mdm verificada');
    } catch (e) {
      console.error('❌ Error con tabla devices_mdm:', e.message);
    }

    // ⭐ FIX: Agregar columna mdm_account_id si no existe
    try {
      await sequelize.query(`
        ALTER TABLE devices_mdm 
        ADD COLUMN IF NOT EXISTS mdm_account_id INTEGER;
      `);
      console.log('✅ Columna mdm_account_id verificada');
    } catch (e) {
      // Ignorar si ya existe
    }

    // ⭐ MDM: CREAR TABLA MDM_ACCOUNTS (PANEL ADMIN)
    try {
      console.log('🔄 Verificando tabla mdm_accounts...');
      
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS mdm_accounts (
          id SERIAL PRIMARY KEY,
          nombre VARCHAR(100) NOT NULL,
          email VARCHAR(150),
          client_id TEXT NOT NULL,
          client_secret TEXT NOT NULL,
          refresh_token TEXT NOT NULL,
          access_token TEXT,
          token_expires_at TIMESTAMP,
          tienda_id INTEGER,
          activo BOOLEAN DEFAULT true,
          last_status VARCHAR(50),
          last_checked_at TIMESTAMP,
          device_count INTEGER DEFAULT 0,
          notas TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE INDEX IF NOT EXISTS idx_mdm_accounts_tienda ON mdm_accounts(tienda_id);
        CREATE INDEX IF NOT EXISTS idx_mdm_accounts_activo ON mdm_accounts(activo);
        CREATE INDEX IF NOT EXISTS idx_mdm_accounts_nombre ON mdm_accounts(nombre);
      `);
      
      console.log('✅ Tabla mdm_accounts verificada');
    } catch (e) {
      console.error('❌ Error con tabla mdm_accounts:', e.message);
    }

    // =========================================================
    // ⭐ TANDAS: CREAR TABLAS
    // =========================================================
    try {
      console.log('🔄 Verificando tablas de Tandas...');
      
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS tandas (
          id SERIAL PRIMARY KEY,
          nombre VARCHAR(100) NOT NULL,
          descripcion TEXT,
          monto_turno DECIMAL(10, 2) NOT NULL,
          aportacion DECIMAL(10, 2) NOT NULL,
          num_participantes INTEGER NOT NULL,
          frecuencia VARCHAR(20) DEFAULT 'quincenal',
          fecha_inicio DATE NOT NULL,
          fecha_fin DATE,
          estado VARCHAR(20) DEFAULT 'activa',
          periodo_actual INTEGER DEFAULT 1,
          notas TEXT,
          tienda_id INTEGER NOT NULL,
          creado_por INTEGER,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_tandas_tienda ON tandas(tienda_id);
        CREATE INDEX IF NOT EXISTS idx_tandas_estado ON tandas(estado);
      `);
      
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS tanda_participantes (
          id SERIAL PRIMARY KEY,
          tanda_id INTEGER NOT NULL,
          nombre VARCHAR(100) NOT NULL,
          telefono VARCHAR(20),
          email VARCHAR(100),
          user_id INTEGER,
          num_turno INTEGER NOT NULL,
          fecha_entrega_estimada DATE,
          entrega_realizada BOOLEAN DEFAULT false,
          fecha_entrega_real TIMESTAMP,
          monto_entregado DECIMAL(10, 2),
          total_aportado DECIMAL(10, 2) DEFAULT 0,
          estado VARCHAR(20) DEFAULT 'activo',
          notas TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_tanda_participantes_tanda ON tanda_participantes(tanda_id);
        CREATE INDEX IF NOT EXISTS idx_tanda_participantes_turno ON tanda_participantes(num_turno);
      `);
      
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS tanda_aportaciones (
          id SERIAL PRIMARY KEY,
          tanda_id INTEGER NOT NULL,
          participante_id INTEGER NOT NULL,
          monto DECIMAL(10, 2) NOT NULL,
          num_periodo INTEGER NOT NULL,
          fecha_pago TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          metodo_pago VARCHAR(30) DEFAULT 'efectivo',
          recibo_folio VARCHAR(50),
          comprobante VARCHAR(255),
          registrado_por INTEGER,
          notas TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_tanda_aportaciones_tanda ON tanda_aportaciones(tanda_id);
        CREATE INDEX IF NOT EXISTS idx_tanda_aportaciones_participante ON tanda_aportaciones(participante_id);
        CREATE INDEX IF NOT EXISTS idx_tanda_aportaciones_periodo ON tanda_aportaciones(num_periodo);
      `);
      
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS config_financiera (
          id SERIAL PRIMARY KEY,
          tienda_id INTEGER,
          ingreso_mensual_promedio DECIMAL(12, 2) DEFAULT 0,
          liquidez_disponible DECIMAL(12, 2) DEFAULT 0,
          porcentaje_techo DECIMAL(5, 2) DEFAULT 70,
          alerta_advertencia DECIMAL(5, 2) DEFAULT 70,
          alerta_critica DECIMAL(5, 2) DEFAULT 90,
          actualizado_por INTEGER,
          ultima_actualizacion TIMESTAMP,
          notas TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_config_financiera_tienda ON config_financiera(tienda_id);
      `);
      
      console.log('✅ Tablas de Tandas verificadas');
    } catch (e) {
      console.error('❌ Error con tablas de Tandas:', e.message);
    }

    // =========================================================
    // ⭐ LLAMADAS AUTOMÁTICAS: CREAR TABLA
    // =========================================================
    try {
      console.log('🔄 Verificando tabla llamadas_automaticas...');
      
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS llamadas_automaticas (
          id SERIAL PRIMARY KEY,
          sale_id INTEGER NOT NULL,
          client_id INTEGER NOT NULL,
          client_name VARCHAR(200),
          telefono VARCHAR(50),
          monto DECIMAL(10,2),
          tipo VARCHAR(20) NOT NULL,
          call_sid VARCHAR(100),
          status VARCHAR(50) DEFAULT 'initiated',
          duration INTEGER DEFAULT 0,
          answered_by VARCHAR(50),
          error_message TEXT,
          fecha_vencimiento DATE,
          tienda_id INTEGER,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE INDEX IF NOT EXISTS idx_llamadas_sale ON llamadas_automaticas(sale_id);
        CREATE INDEX IF NOT EXISTS idx_llamadas_client ON llamadas_automaticas(client_id);
        CREATE INDEX IF NOT EXISTS idx_llamadas_status ON llamadas_automaticas(status);
        CREATE INDEX IF NOT EXISTS idx_llamadas_tipo ON llamadas_automaticas(tipo);
        CREATE INDEX IF NOT EXISTS idx_llamadas_fecha ON llamadas_automaticas(created_at);
      `);
      
      console.log('✅ Tabla llamadas_automaticas verificada');
    } catch (e) {
      console.error('❌ Error con tabla llamadas_automaticas:', e.message);
    }

    // CORS - DEBE IR PRIMERO
    app.use(cors({
      origin: true,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization']
    }));

    // JSON parser
    app.use(express.json());
    
    // Parser para webhooks de Twilio (URL-encoded)
    app.use(express.urlencoded({ extended: true }));

    // Log de peticiones
    app.use((req, res, next) => {
      console.log(`--> Petición Recibida: ${req.method} ${req.originalUrl}`);
      next();
    });

    // ---------- Rutas públicas ----------
    const initAuthRoutes = require('./routes/authRoutes');
    app.use('/api/auth', initAuthRoutes(models, isRegistrationAllowed));

    const initClientAuthRoutes = require('./routes/clientAuthRoutes');
    app.use('/api/client-auth', initClientAuthRoutes(models));

    const initPortalRoutes = require('./routes/portalRoutes');
    app.use('/api/portal', initPortalRoutes(models));

    const initProductRoutes = require('./routes/productRoutes');
    app.use('/api/products', initProductRoutes(models));

    // Ruta pública de tiendas
    app.get('/api/stores/public', async (req, res) => {
      try {
        const stores = await models.Store.findAll({
          where: { isActive: true },
          attributes: ['id', 'name', 'address', 'phone', 'email'],
          order: [['name', 'ASC']]
        });
        res.json(stores);
      } catch (error) {
        console.error('Error al obtener tiendas públicas:', error);
        res.status(500).json({ message: 'Error al cargar tiendas.' });
      }
    });

    // ---------- Rutas protegidas ----------
    const initClientRoutes = require('./routes/clientRoutes');
    app.use('/api/clients', authMiddleware, initClientRoutes(models));

    const initClientDocumentsRoutes = require('./routes/clientDocumentsRoutes');
    app.use('/api/clients', authMiddleware, initClientDocumentsRoutes(models));

    const initSalePaymentRoutes = require('./routes/salePaymentRoutes');
    app.use('/api/sales', authMiddleware, initSalePaymentRoutes(models, sequelize));

    const initReportRoutes = require('./routes/reportRoutes');
    app.use('/api/reports', authMiddleware, initReportRoutes(models));

    const initUserRoutes = require('./routes/userRoutes');
    app.use('/api/users', authMiddleware, initUserRoutes(models));

    const initAuditRoutes = require('./routes/auditRoutes');
    app.use('/api/audit', authMiddleware, initAuditRoutes(models));

    const initDashboardRoutes = require('./routes/dashboardRoutes');
    app.use('/api/dashboard', authMiddleware, initDashboardRoutes(models));

    const initStoreRoutes = require('./routes/storeRoutes');
    app.use('/api/stores', authMiddleware, initStoreRoutes(models));

    const initRemindersRoutes = require('./routes/remindersRoutes');
    app.use('/api/reminders', authMiddleware, initRemindersRoutes(models));

    const initCollectionRoutes = require('./routes/collectionRoutes');
    app.use('/api/collections', authMiddleware, initCollectionRoutes(models, sequelize));

    // =========================================================
    // ⭐ RUTAS MDM - BLOQUEO DE DISPOSITIVOS
    // =========================================================
    const initMdmRoutes = require('./services/mdmRoutes');
    app.use('/api/mdm', authMiddleware, initMdmRoutes(models));

    const initMdmAutoBlockRoutes = require('./services/mdmAutoBlockRoutes');
    app.use('/api/mdm-auto', authMiddleware, initMdmAutoBlockRoutes(models));

    const initMdmAdminRoutes = require('./services/mdmAdminRoutes');
    app.use('/api/mdm-admin', authMiddleware, initMdmAdminRoutes(models));

    console.log('✅ Rutas MDM montadas (operativas + admin).');

    // =========================================================
    // ⭐ RUTAS TANDAS / CAJA DE AHORRO
    // =========================================================
    const initTandasRoutes = require('./routes/tandasRoutes');
    app.use('/api/tandas', initTandasRoutes(models, sequelize, authMiddleware));
    console.log('✅ Rutas de Tandas montadas.');

    // =========================================================
    // ⭐ RUTAS LLAMADAS AUTOMÁTICAS - TWILIO
    // =========================================================
    const initLlamadasRoutes = require('./routes/llamadasRoutes');
    app.use('/api/llamadas', authMiddleware, initLlamadasRoutes(models, sequelize));
    console.log('✅ Rutas de Llamadas Automáticas montadas.');

    // =========================================================
    // ⭐ RUTAS IMEI ↔ VENTA (NUEVO - vinculación automática para MDM)
    // =========================================================

    // GET /api/imei/check/:imei → verifica disponibilidad antes de cerrar venta
    app.get('/api/imei/check/:imei', authMiddleware, async (req, res) => {
        try {
            const imei = normalizeImei(req.params.imei);
            if (!imei) {
                return res.status(400).json({
                    available: false,
                    reason: 'INVALID_FORMAT',
                    message: 'IMEI debe tener 14-17 dígitos'
                });
            }
            if (!isValidImeiLuhn(imei)) {
                return res.status(400).json({
                    available: false,
                    reason: 'INVALID_LUHN',
                    message: 'IMEI inválido (verifica la captura)'
                });
            }

            const [rows] = await sequelize.query(
                `SELECT d.id, d.sale_id, d.client_id, d.status, d.brand, d.model,
                        s.status AS sale_status,
                        c."firstName" AS client_first, c."lastName" AS client_last
                 FROM devices_mdm d
                 LEFT JOIN sales s ON s.id = d.sale_id
                 LEFT JOIN clients c ON c.id = d.client_id
                 WHERE d.imei = :imei
                 LIMIT 1`,
                { replacements: { imei } }
            );

            if (rows.length === 0) {
                return res.json({ available: true, imei });
            }

            const r = rows[0];
            const ocupado = r.sale_id && ['completed', 'pending', 'overdue'].includes(r.sale_status);

            return res.json({
                available: !ocupado,
                imei,
                existing: {
                    deviceId: r.id,
                    saleId: r.sale_id,
                    clientId: r.client_id,
                    clientName: `${r.client_first || ''} ${r.client_last || ''}`.trim() || null,
                    brand: r.brand,
                    model: r.model,
                    saleStatus: r.sale_status
                },
                message: ocupado
                    ? `IMEI ya vendido a ${r.client_first || 'cliente #' + r.client_id}`
                    : 'IMEI pre-enrolado disponible'
            });
        } catch (err) {
            console.error('[IMEI check] error:', err);
            res.status(500).json({ available: false, error: err.message });
        }
    });

    // POST /api/sales/create-with-imei → crea venta + vincula IMEI atómicamente
    app.post('/api/sales/create-with-imei', authMiddleware, async (req, res) => {
        const t = await sequelize.transaction();
        try {
            const {
                clientId, totalAmount, isCredit, downPayment, interestRate,
                paymentFrequency, numberOfPayments, weeklyPaymentAmount,
                balanceDue, assignedCollectorId, status,
                imei, deviceBrand, deviceModel, serialNumber, mdmAccountId
            } = req.body;

            if (!clientId) {
                await t.rollback();
                return res.status(400).json({ error: 'clientId requerido' });
            }
            const imeiN = normalizeImei(imei);
            if (!imeiN) {
                await t.rollback();
                return res.status(400).json({ error: 'IMEI requerido (14-17 dígitos)' });
            }
            if (!isValidImeiLuhn(imeiN)) {
                await t.rollback();
                return res.status(400).json({ error: 'IMEI no pasa validación Luhn. Verifica captura.' });
            }

            const tiendaId = req.user?.tiendaId || req.user?.tienda_id || 1;

            // Pre-check: ¿IMEI ya vendido?
            const [existing] = await sequelize.query(
                `SELECT d.id, d.sale_id, d.client_id, s.status AS sale_status
                 FROM devices_mdm d
                 LEFT JOIN sales s ON s.id = d.sale_id
                 WHERE d.imei = :imei LIMIT 1`,
                { replacements: { imei: imeiN }, transaction: t }
            );

            if (existing.length > 0) {
                const e = existing[0];
                if (e.sale_id && ['completed', 'pending', 'overdue'].includes(e.sale_status)) {
                    await t.rollback();
                    return res.status(409).json({
                        error: 'IMEI_ALREADY_LINKED',
                        message: `IMEI ya vinculado a venta #${e.sale_id} (cliente #${e.client_id})`,
                        existingSaleId: e.sale_id,
                        existingClientId: e.client_id
                    });
                }
            }

            // 1) Crear venta
            const sale = await models.Sale.create({
                clientId,
                saleDate: new Date(),
                totalAmount,
                isCredit: !!isCredit,
                downPayment: downPayment || 0,
                interestRate: interestRate || 0,
                paymentFrequency: paymentFrequency || 'weekly',
                numberOfPayments,
                weeklyPaymentAmount,
                balanceDue: balanceDue !== undefined ? balanceDue : (totalAmount - (downPayment || 0)),
                status: status || 'completed',
                assignedCollectorId,
                tiendaId,
                paymentsMade: 0
            }, { transaction: t });

            // 2) Vincular IMEI: UPDATE si existe pre-enrolado, INSERT si no
            let action;
            if (existing.length > 0) {
                await sequelize.query(
                    `UPDATE devices_mdm
                     SET sale_id = :saleId, client_id = :clientId, tienda_id = :tiendaId,
                         brand = COALESCE(:brand, brand),
                         model = COALESCE(:model, model),
                         serial_number = COALESCE(:serial, serial_number),
                         mdm_account_id = COALESCE(:mdmAcc, mdm_account_id),
                         status = 'active',
                         notes = COALESCE(notes, '') || E'\n[' || NOW()::text || '] Vinculado a venta #' || :saleId,
                         updated_at = NOW()
                     WHERE imei = :imei`,
                    {
                        replacements: {
                            saleId: sale.id, clientId, tiendaId,
                            brand: deviceBrand || null,
                            model: deviceModel || null,
                            serial: serialNumber || null,
                            mdmAcc: mdmAccountId || null,
                            imei: imeiN
                        },
                        transaction: t
                    }
                );
                action = 'linked';
            } else {
                await sequelize.query(
                    `INSERT INTO devices_mdm
                        (device_number, imei, serial_number, brand, model,
                         sale_id, client_id, mdm_account_id, status, tienda_id, notes,
                         created_at, updated_at)
                     VALUES
                        (:imei, :imei, :serial, :brand, :model,
                         :saleId, :clientId, :mdmAcc, 'active', :tiendaId,
                         '[' || NOW()::text || '] Creado al cerrar venta #' || :saleId,
                         NOW(), NOW())`,
                    {
                        replacements: {
                            imei: imeiN,
                            serial: serialNumber || null,
                            brand: deviceBrand || null,
                            model: deviceModel || null,
                            saleId: sale.id, clientId,
                            mdmAcc: mdmAccountId || null,
                            tiendaId
                        },
                        transaction: t
                    }
                );
                action = 'created';
            }

            await t.commit();

            return res.status(201).json({
                success: true,
                sale,
                imei: imeiN,
                action,
                message: action === 'created'
                    ? 'Venta creada y dispositivo enrolado.'
                    : 'Venta creada y dispositivo pre-enrolado vinculado.'
            });

        } catch (err) {
            await t.rollback();
            console.error('[create-with-imei] error:', err);
            if (err.message && err.message.includes('idx_devices_mdm_imei_unique')) {
                return res.status(409).json({
                    error: 'IMEI_DUPLICATE',
                    message: 'IMEI duplicado (race condition). Reintenta.'
                });
            }
            return res.status(500).json({ error: err.message });
        }
    });

    // GET /api/imei/by-sale/:saleId → para mdmCronJob (recuperar IMEI por venta)
    app.get('/api/imei/by-sale/:saleId', authMiddleware, async (req, res) => {
        try {
            const [rows] = await sequelize.query(
                `SELECT id, imei, brand, model, status, mdm_account_id, client_id
                 FROM devices_mdm WHERE sale_id = :saleId`,
                { replacements: { saleId: req.params.saleId } }
            );
            res.json({ devices: rows });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    console.log('✅ Rutas IMEI-Venta montadas (/api/imei/check, /api/sales/create-with-imei).');

    // =========================================================
    // ⭐ CRON JOBS
    // =========================================================
    const { startCronJob } = require('./cron/mdmCronJob');
    startCronJob(models, 3600000);
    console.log('✅ Cron job MDM iniciado (verificación cada hora).');

    const { startLlamadasCronJob } = require('./cron/llamadasCronJob');
    startLlamadasCronJob(models, sequelize);
    console.log('✅ Cron job Llamadas Automáticas iniciado (9 AM - 6 PM).');

    // =========================================================
    // ⭐ RUTAS BACKUP - GOOGLE DRIVE
    // =========================================================
    const initBackupRoutes = require('./routes/backupRoutes');
    app.use('/api/backup', authMiddleware, initBackupRoutes());
    console.log('✅ Rutas de Backup montadas.');

    // =========================================================
    // ⭐ CRON JOB BACKUP - DIARIO 3:00 AM
    // =========================================================
    const { startBackupCronJob } = require('./cron/backupCronJob');
    startBackupCronJob();
    console.log('✅ Cron job Backup iniciado (diario 3:00 AM).');

    console.log('✅ Todas las rutas principales han sido montadas.');
    app.listen(PORT, () => console.log(`🚀 Servidor corriendo en el puerto ${PORT}`));
  })
  .catch(err => console.error('❌ Error fatal:', err));

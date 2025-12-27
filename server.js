// server.js - CON INTEGRACIÓN MDM COMPLETA Y PANEL ADMIN
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

    // CORS - DEBE IR PRIMERO
    app.use(cors({
      origin: true,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization']
    }));

    // JSON parser - DESPUÉS de CORS
    app.use(express.json());

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

    // Rutas de documentos de cliente (INE, selfie, verificación facial)
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

    // ⭐ RUTAS MDM ADMIN - PANEL DE CUENTAS (Solo Super Admin)
    const initMdmAdminRoutes = require('./services/mdmAdminRoutes');
    app.use('/api/mdm-admin', authMiddleware, initMdmAdminRoutes(models));

    console.log('✅ Rutas MDM montadas (operativas + admin).');

    // =========================================================
    // ⭐ CRON JOB MDM - VERIFICACIÓN AUTOMÁTICA (OPCIONAL)
    // =========================================================
    // Descomenta las siguientes líneas para activar el bloqueo automático
    // El cron verifica cada hora y bloquea dispositivos con 2+ días de mora
    
    // const { startCronJob } = require('./cron/mdmCronJob');
    // startCronJob(3600000); // Verificar cada hora (3600000 ms)
    // console.log('✅ Cron job MDM iniciado (verificación cada hora).');

    console.log('✅ Todas las rutas principales han sido montadas.');
    app.listen(PORT, () => console.log(`🚀 Servidor corriendo en el puerto ${PORT}`));
  })
  .catch(err => console.error('❌ Error fatal:', err));

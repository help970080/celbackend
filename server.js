// server.js - CON RUTAS DE DOCUMENTOS DE CLIENTE
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
      console.log('🔄 Creando tabla collection_logs...');
      
      await sequelize.query(`
        DROP TABLE IF EXISTS collection_logs CASCADE;
        
        CREATE TABLE collection_logs (
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
        
        CREATE INDEX idx_collection_logs_sale ON collection_logs(sale_id);
        CREATE INDEX idx_collection_logs_collector ON collection_logs(collector_id);
        CREATE INDEX idx_collection_logs_created ON collection_logs(created_at DESC);
      `);
      
      console.log('✅ Tabla collection_logs creada exitosamente');
    } catch (e) {
      console.error('❌ Error al crear tabla:', e.message);
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

    // ⭐ NUEVO: Rutas de documentos de cliente (INE, selfie, verificación facial)
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

    console.log('✅ Todas las rutas principales han sido montadas.');
    app.listen(PORT, () => console.log(`🚀 Servidor corriendo en el puerto ${PORT}`));
  })
  .catch(err => console.error('❌ Error fatal:', err));
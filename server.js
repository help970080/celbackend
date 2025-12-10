// server.js
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

    // --- CONFIGURACIÓN SEGURA PARA PRODUCCIÓN ---
    // 'force: false' asegura que las tablas existentes y sus datos no se borren.
    // Esta es la configuración que debes usar siempre en producción.
    return sequelize.sync({ force: false });
    // --- FIN DE LA CONFIGURACIÓN SEGURA ---
  })
  .then(async () => {
    console.log('✅ Modelos sincronizados con la base de datos.');
    const adminCount = await models.User.count();
    isRegistrationAllowed = (adminCount === 0);

    app.use(express.json());

    // CORS seguro: agrega tu dominio de frontend y localhost
    const defaultFrontend = 'https://celfrontend.onrender.com';
    const allowedOrigins = [
      process.env.FRONTEND_URL,
      defaultFrontend,
      'http://localhost:5173'
    ].filter(Boolean);

    app.use(cors({
      origin: (origin, callback) => {
        // Permitir herramientas como Postman (sin origin) y tus orígenes
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error('Acceso no permitido por CORS'));
        }
      }
    }));

    // Log de peticiones (útil para monitoreo)
    app.use((req, res, next) => {
      console.log(`--> Petición Recibida: ${req.method} ${req.originalUrl}`);
      next();
    });

    // ---------- Montaje de rutas públicas ----------
    const initAuthRoutes = require('./routes/authRoutes');
    app.use('/api/auth', initAuthRoutes(models, isRegistrationAllowed));

    const initClientAuthRoutes = require('./routes/clientAuthRoutes');
    app.use('/api/client-auth', initClientAuthRoutes(models));

    const initPortalRoutes = require('./routes/portalRoutes');
    app.use('/api/portal', initPortalRoutes(models));

    const initProductRoutes = require('./routes/productRoutes');
    app.use('/api/products', initProductRoutes(models));

    // ---------- Rutas protegidas (requieren token) ----------
    const initClientRoutes = require('./routes/clientRoutes');
    app.use('/api/clients', authMiddleware, initClientRoutes(models));

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

// ⭐ AGREGAR ESTAS 2 LÍNEAS AQUÍ:
        const initStoreRoutes = require('./routes/storeRoutes');
        app.use('/api/stores', authMiddleware, initStoreRoutes(models));
        
        console.log('✅ Todas las rutas principales han sido montadas.');

    // ---------- NUEVA RUTA: Recordatorios ----------
    const initRemindersRoutes = require('./routes/remindersRoutes');
    app.use('/api/reminders', authMiddleware, initRemindersRoutes(models));
    
    // ---------- NUEVA RUTA AÑADIDA: Gestión de Cobranza (CollectionLog) ----------
    const initCollectionRoutes = require('./routes/collectionRoutes');
    // Le pasamos 'sequelize' y 'models' para que pueda acceder y/o definir el modelo CollectionLog
    app.use('/api/collections', authMiddleware, initCollectionRoutes(models, sequelize)); 

    console.log('✅ Todas las rutas principales han sido montadas.');
    app.listen(PORT, () => console.log(`🚀 Servidor corriendo en el puerto ${PORT}`));
  })
  .catch(err => console.error('❌ Error fatal:', err));
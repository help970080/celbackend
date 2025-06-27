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
        // Usar { alter: true } en desarrollo si quieres que se actualicen las tablas sin borrarlas.
        // Usar { force: false } en producción.
        return sequelize.sync({ force: false }); 
    })
    .then(async () => {
        console.log('✅ Modelos sincronizados con la base de datos.');
        const adminCount = await models.User.count();
        isRegistrationAllowed = (adminCount === 0);
        
        app.use(express.json());
        const allowedOrigins = [process.env.FRONTEND_URL, 'http://localhost:5173'];
        app.use(cors({
            origin: (origin, callback) => {
                if (!origin || allowedOrigins.includes(origin)) {
                    callback(null, true);
                } else {
                    callback(new Error('Acceso no permitido por CORS'));
                }
            }
        }));
        
        app.use((req, res, next) => {
          console.log(`--> Petición Recibida: ${req.method} ${req.originalUrl}`);
          next();
        });

        // --- Montaje de rutas ---

        // Rutas de Autenticación de Administradores
        const initAuthRoutes = require('./routes/authRoutes');
        app.use('/api/auth', initAuthRoutes(models, isRegistrationAllowed));
        
        // Rutas de Módulos de Administración (Protegidas por authMiddleware)
        const initProductRoutes = require('./routes/productRoutes');
        app.use('/api/products', authMiddleware, initProductRoutes(models));
        
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

        // --- INICIO: NUEVAS RUTAS PARA EL PORTAL DE CLIENTES ---
        const initClientAuthRoutes = require('./routes/clientAuthRoutes');
        app.use('/api/client-auth', initClientAuthRoutes(models));

        const initPortalRoutes = require('./routes/portalRoutes');
        app.use('/api/portal', initPortalRoutes(models));
        // --- FIN: NUEVAS RUTAS PARA EL PORTAL DE CLIENTES ---
        
        console.log('✅ Todas las rutas principales han sido montadas.');
        app.listen(PORT, () => console.log(`🚀 Servidor corriendo en el puerto ${PORT}`));
    })
    .catch(err => console.error('❌ Error fatal:', err));
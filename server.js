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
    logging: true // Habilitamos el logging para ver qué hace
});

const models = require('./models')(sequelize);
let isRegistrationAllowed = false; 

sequelize.authenticate()
    .then(() => {
        console.log('✅ Conexión exitosa a la base de datos.');
        
        // --- CAMBIO CLAVE PARA EL REINICIO ---
        // force: true BORRARÁ TODAS TUS TABLAS y las creará de nuevo desde cero.
        console.log('⚠️ INICIANDO SINCRONIZACIÓN CON { force: true }. ESTO BORRARÁ LOS DATOS.');
        return sequelize.sync({ force: false });
    })
    .then(async () => {
        console.log('✅ BASE DE DATOS REINICIADA Y MODELOS SINCRONIZADOS.');
        isRegistrationAllowed = true;
        console.log('✨ Registro HABILITADO para el primer super_admin.');
        
        // El resto de la configuración del servidor...
        app.use(express.json());
        const allowedOrigins = [process.env.FRONTEND_URL, 'http://localhost:5173'];
        app.use(cors({
            origin: (origin, callback) => {
                if (!origin || allowedOrigins.includes(origin)) {
                    callback(null, true);
                } else {
                    callback(new Error('CORS policy violation'));
                }
            }
        }));
        
        app.use((req, res, next) => {
          console.log(`--> Petición Recibida: ${req.method} ${req.originalUrl}`);
          next();
        });

        // Montaje de rutas...
        const initAuthRoutes = require('./routes/authRoutes');
        app.use('/api/auth', initAuthRoutes(models, isRegistrationAllowed));
        const initProductRoutes = require('./routes/productRoutes');
        app.use('/api/products', initProductRoutes(models));
        const initClientRoutes = require('./routes/clientRoutes');
        app.use('/api/clients', authMiddleware, initClientRoutes(models));
        const initSalePaymentRoutes = require('./routes/salePaymentRoutes');
        app.use('/api/sales', authMiddleware, initSalePaymentRoutes(models, sequelize));
        const initReportRoutes = require('./routes/reportRoutes');
        app.use('/api/reports', authMiddleware, initReportRoutes(models));
        const initUserRoutes = require('./routes/userRoutes');
        app.use('/api/users', authMiddleware, initUserRoutes(models));
        
        console.log('✅ Todas las rutas han sido montadas.');
        app.listen(PORT, () => console.log(`🚀 Servidor corriendo en el puerto ${PORT}`));
    })
    .catch(err => console.error('❌ Error fatal durante el reinicio:', err));
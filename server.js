const express = require('express');
const { Sequelize } = require('sequelize');
const cors = require('cors');
const authMiddleware = require('./middleware/authMiddleware');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Configuración de Sequelize para PostgreSQL en Render
const sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: 'postgres',
    protocol: 'postgres',
    dialectOptions: {
        ssl: {
            require: true,
            rejectUnauthorized: false
        }
    },
    logging: false // Deshabilita el logging de SQL en producción para un log más limpio
});

// Inicializa los modelos y sus asociaciones desde el archivo index.js
const models = require('./models')(sequelize);

let isRegistrationAllowed = false; 

sequelize.authenticate()
    .then(() => {
        console.log('✅ Conexión exitosa a la base de datos (PostgreSQL).');
        
        // --- CONFIGURACIÓN DE SEGURIDAD FINAL ---
        // Para la operación normal y segura, siempre se debe usar { force: false }.
        // Esto previene la pérdida accidental de datos.
        return sequelize.sync({ force: false }); 
    })
    .then(async () => {
        console.log('✅ Modelos sincronizados con la base de datos.');

        // Lógica para permitir el registro del primer administrador
        try {
            const adminCount = await models.User.count();
            isRegistrationAllowed = (adminCount === 0);
            if (isRegistrationAllowed) {
                console.log('✨ No se encontraron usuarios. El registro está HABILITADO para crear el primer super_admin.');
            } else {
                console.log(`🔒 Se encontraron ${adminCount} usuarios. El registro está DESHABILITADO.`);
            }
        } catch (dbErr) {
            console.error('❌ Error al verificar usuarios existentes:', dbErr);
        }

        // Middlewares generales
        app.use(express.json());

        const allowedOrigins = [
            'http://localhost:5173', // Para desarrollo local
            process.env.FRONTEND_URL  // Para tu frontend en Render
        ];
        app.use(cors({
            origin: function (origin, callback) {
                if (!origin || allowedOrigins.indexOf(origin) !== -1) {
                    callback(null, true);
                } else {
                    callback(new Error(`La política CORS no permite acceso desde: ${origin}`), false);
                }
            }
        }));
        
        // Middleware para registrar cada petición entrante (muy útil para depurar)
        app.use((req, res, next) => {
          console.log(`--> Petición Recibida: ${req.method} ${req.originalUrl}`);
          next();
        });

        // --- Montaje de todas las rutas de la API ---
        const initAuthRoutes = require('./routes/authRoutes');
        app.use('/api/auth', initAuthRoutes(models, isRegistrationAllowed));

        const initProductRoutes = require('./routes/productRoutes');
        app.use('/api/products', initProductRoutes(models));

        const initClientRoutes = require('./routes/clientRoutes');
        app.use('/api/clients', authMiddleware, initClientRoutes(models));

        // Se pasa la instancia de 'sequelize' a las rutas de ventas para las transacciones
        const initSalePaymentRoutes = require('./routes/salePaymentRoutes');
        app.use('/api/sales', authMiddleware, initSalePaymentRoutes(models, sequelize));

        const initReportRoutes = require('./routes/reportRoutes');
        app.use('/api/reports', authMiddleware, initReportRoutes(models));
        
        const initUserRoutes = require('./routes/userRoutes');
        app.use('/api/users', authMiddleware, initUserRoutes(models));
        
        console.log('✅ Todas las rutas principales han sido montadas.');

        // Ruta raíz de prueba
        app.get('/', (req, res) => {
            res.send('🎉 ¡Servidor de CelExpress Pro funcionando correctamente!');
        });

        // Iniciar el servidor
        app.listen(PORT, () => {
            console.log(`🚀 Servidor de CelExpress Pro corriendo en el puerto ${PORT}`);
        });

    })
    .catch(err => console.error('❌ Error al conectar o sincronizar:', err));
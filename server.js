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
    dialectOptions: {
        ssl: {
            require: true,
            rejectUnauthorized: false
        }
    },
    logging: false
});

const models = require('./models')(sequelize);

let isRegistrationAllowed = false; 

sequelize.authenticate()
    .then(() => {
        console.log('✅ Conexión exitosa a la base de datos (PostgreSQL).');
        // NOTA: Para producción, siempre usa { force: false }.
        // Si necesitas hacer más cambios en la estructura de la base de datos en el futuro,
        // puedes cambiarlo temporalmente a { alter: true } para un solo despliegue.
        return sequelize.sync({ force: false }); 
    })
    .then(async () => {
        console.log('✅ Modelos sincronizados con la base de datos.');

        try {
            const adminCount = await models.User.count();
            if (adminCount === 0) {
                isRegistrationAllowed = true;
                console.log('✨ No se encontraron administradores. El registro está HABILITADO para crear el primero.');
            } else {
                isRegistrationAllowed = false;
                console.log(`🔒 Se encontraron ${adminCount} administradores. El registro está DESHABILITADO.`);
            }
        } catch (dbErr) {
            console.error('❌ Error al verificar administradores existentes:', dbErr);
        }

        app.use(express.json());

        const allowedOrigins = ['http://localhost:5173', process.env.FRONTEND_URL];
        app.use(cors({
            origin: function (origin, callback) {
                if (!origin || allowedOrigins.indexOf(origin) !== -1) {
                    callback(null, true);
                } else {
                    callback(new Error(`La política CORS no permite acceso desde: ${origin}`), false);
                }
            }
        }));
        
        app.use((req, res, next) => {
          console.log(`--> Petición Recibida: ${req.method} ${req.originalUrl}`);
          next();
        });

        // Montaje de todas las rutas
        const initAuthRoutes = require('./routes/authRoutes');
        app.use('/api/auth', initAuthRoutes(models, isRegistrationAllowed));

        const initProductRoutes = require('./routes/productRoutes');
        app.use('/api/products', initProductRoutes(models));

        const initClientRoutes = require('./routes/clientRoutes');
        app.use('/api/clients', authMiddleware, initClientRoutes(models));

        const initSalePaymentRoutes = require('./routes/salePaymentRoutes');
        app.use('/api/sales', authMiddleware, initSalePaymentRoutes(models, sequelize)); // Pasamos sequelize aquí

        const initReportRoutes = require('./routes/reportRoutes');
        app.use('/api/reports', authMiddleware, initReportRoutes(models));
        
        const initUserRoutes = require('./routes/userRoutes');
        app.use('/api/users', authMiddleware, initUserRoutes(models));
        
        console.log('✅ Todas las rutas principales han sido montadas.');

        app.get('/', (req, res) => {
            res.send('🎉 ¡Servidor de CelExpress Pro funcionando correctamente!');
        });

        app.listen(PORT, () => {
            console.log(`🚀 Servidor de CelExpress Pro corriendo en el puerto ${PORT}`);
        });

    })
    .catch(err => console.error('❌ Error al conectar a la base de datos o sincronizar modelos:', err));
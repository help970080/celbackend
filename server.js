const express = require('express');
const { Sequelize, DataTypes } = require('sequelize');
const cors = require('cors');
const authMiddleware = require('./middleware/authMiddleware');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET;

// --- CAMBIO CLAVE AQUÍ: Configuración de Sequelize para PostgreSQL ---
const sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: 'postgres', // Especifica el dialecto como PostgreSQL
    protocol: 'postgres',
    dialectOptions: {
        ssl: {
            require: true, // Requerir SSL
            rejectUnauthorized: false // Importante para Render, si no usas un certificado específico
        }
    },
    logging: false // Deshabilita el logging de SQL para producción
});
// --- FIN DEL CAMBIO ---

const models = require('./models')(sequelize);

let isRegistrationAllowed = false; 

sequelize.authenticate()
    .then(() => {
        console.log('✅ Conexión exitosa a la base de datos (PostgreSQL).'); // Mensaje actualizado
        // En producción, no uses {force: true}. Usa {alter: true} con precaución
        // para aplicar pequeños cambios de esquema, o mejor aún, usa migraciones.
        // Para la primera vez en un DB vacío, `force: false` intentará crear tablas si no existen.
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
            isRegistrationAllowed = false; 
        }

        app.use(express.json());
        // --- CORS MÁS SEGURO PARA PRODUCCIÓN ---
        const allowedOrigins = [
            'http://localhost:5173', // Para desarrollo local
            process.env.FRONTEND_URL // <-- Variable de entorno para la URL de tu frontend en Render
        ];
        app.use(cors({
            origin: function (origin, callback) {
                if (!origin || allowedOrigins.indexOf(origin) !== -1) {
                    callback(null, true);
                } else {
                    const msg = `La política CORS para este sitio no permite acceso desde el origen especificado: ${origin}`;
                    callback(new Error(msg), false);
                }
            }
        }));
        // --- FIN CORS MÁS SEGURO ---

        app.get('/api/auth/is-registration-allowed', (req, res) => {
            if (isRegistrationAllowed) {
                res.json({ isRegistrationAllowed: true });
            } else {
                res.json({ isRegistrationAllowed: false });
            }
        });

        const initAuthRoutes = require('./routes/authRoutes');
        app.use('/api/auth', initAuthRoutes(models, isRegistrationAllowed)); 
        console.log('✅ Rutas de autenticación montadas en /api/auth');

        const initProductRoutes = require('./routes/productRoutes');
        app.use('/api/products', initProductRoutes(models));

        const initClientRoutes = require('./routes/clientRoutes');
        app.use('/api/clients', authMiddleware, initClientRoutes(models));

        const initSalePaymentRoutes = require('./routes/salePaymentRoutes');
        app.use('/api/sales', authMiddleware, initSalePaymentRoutes(models));

        const initReportRoutes = require('./routes/reportRoutes');
        app.use('/api/reports', authMiddleware, initReportRoutes(models));
        console.log('✅ Rutas de reportes montadas en /api/reports');
        
        // --- NUEVO: Montar las rutas de gestión de usuarios ---
        const initUserRoutes = require('./routes/userRoutes');
        app.use('/api/users', authMiddleware, initUserRoutes(models)); // Protegido por authMiddleware por defecto, y luego por roleMiddleware en userRoutes
        console.log('✅ Rutas de gestión de usuarios montadas en /api/users');


        app.get('/', (req, res) => {
            res.send('🎉 ¡Servidor de CelExpress Pro funcionando correctamente!');
        });

        app.listen(PORT, () => {
            console.log(`🚀 Servidor de CelExpress Pro corriendo en el puerto ${PORT}`);
        });

    })
    .catch(err => console.error('❌ Error al conectar a la base de datos o sincronizar modelos:', err));
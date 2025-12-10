const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    const JWT_SECRET = process.env.JWT_SECRET;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Acceso denegado. No se proporcionó token de autenticación.' });
    }

    const token = authHeader.split(' ')[1];

    if (!JWT_SECRET) {
        console.error("JWT_SECRET no está definido en el entorno.");
        return res.status(500).json({ message: "Error de configuración del servidor. JWT_SECRET no encontrado." });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        
        // Adjuntamos userId, username, role Y tiendaId al request
        req.user = { 
            userId: decoded.userId,
            username: decoded.username,
            role: decoded.role,
            tiendaId: decoded.tiendaId // NUEVO: ID de la tienda del usuario
        };
        
        next();
    } catch (error) {
        console.error('Error de verificación de token:', error);
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ message: 'Token expirado. Por favor, inicia sesión de nuevo.' });
        }
        return res.status(401).json({ message: 'Token inválido o corrupto.' });
    }
};

module.exports = authMiddleware;
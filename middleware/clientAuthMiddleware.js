const jwt = require('jsonwebtoken');

const clientAuthMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    const JWT_SECRET = process.env.JWT_SECRET;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Acceso denegado. No se proporcionó token.' });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        // Verificamos que sea un token de cliente
        if (decoded.role !== 'client') {
            return res.status(403).json({ message: 'Acceso denegado. Permisos insuficientes.' });
        }
        
        req.client = { clientId: decoded.clientId, name: decoded.name };
        next();
    } catch (error) {
        return res.status(401).json({ message: 'Token inválido o expirado.' });
    }
};

module.exports = clientAuthMiddleware;
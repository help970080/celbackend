// src/backend/middleware/roleMiddleware.js
const authorizeRoles = (allowedRoles) => {
    return (req, res, next) => {
        // req.user.role debería estar disponible aquí gracias a authMiddleware
        if (!req.user || !req.user.role) {
            return res.status(403).json({ message: 'Acceso denegado. Rol de usuario no disponible.' });
        }

        const userRole = req.user.role;

        // Verificar si el rol del usuario está incluido en los roles permitidos
        if (allowedRoles.includes(userRole)) {
            next(); // El usuario tiene el rol permitido, continuar
        } else {
            console.warn(`Intento de acceso no autorizado: Usuario '${req.user.username}' con rol '${userRole}' intentó acceder a una ruta que requiere roles: ${allowedRoles.join(', ')}`);
            return res.status(403).json({ message: 'Acceso denegado. No tienes los permisos necesarios para realizar esta acción.' });
        }
    };
};

module.exports = authorizeRoles;
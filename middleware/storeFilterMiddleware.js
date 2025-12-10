/**
 * Middleware de Filtro por Tienda
 * 
 * Este middleware automáticamente filtra los queries por tienda según el rol del usuario:
 * - super_admin: Ve TODAS las tiendas (no aplica filtro)
 * - Otros roles: Solo ven datos de SU tienda
 * 
 * Se debe aplicar DESPUÉS de authMiddleware
 */

const applyStoreFilter = (req, res, next) => {
    // Si no hay usuario autenticado, el authMiddleware debería haberlo bloqueado
    if (!req.user) {
        return res.status(401).json({ message: 'Usuario no autenticado.' });
    }

    // Si es super_admin, puede ver todas las tiendas (no aplicamos filtro automático)
    if (req.user.role === 'super_admin') {
        // El super_admin puede filtrar por tienda si quiere usando query params
        // Ejemplo: ?tiendaId=2 para ver solo la tienda 2
        if (req.query.tiendaId) {
            req.storeFilter = { tiendaId: parseInt(req.query.tiendaId, 10) };
        } else {
            // Sin filtro = ve todas las tiendas
            req.storeFilter = {};
        }
    } else {
        // Usuarios normales SOLO ven su propia tienda
        req.storeFilter = { tiendaId: req.user.tiendaId };
    }

    next();
};

module.exports = applyStoreFilter;
-- ============================================
-- SCRIPT DE MIGRACIÓN MULTI-TENANT - SQLite
-- Agrega soporte para múltiples tiendas
-- ============================================

-- PASO 1: Crear tabla de tiendas
CREATE TABLE IF NOT EXISTS stores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(255) NOT NULL,
    address TEXT,
    phone VARCHAR(50),
    email VARCHAR(255),
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- PASO 2: Insertar tiendas iniciales (ajusta según tus necesidades)
INSERT INTO stores (name, address, phone, email) VALUES
('Tienda Principal', 'Dirección tienda 1', '5551234567', 'tienda1@example.com'),
('Tienda Sucursal', 'Dirección tienda 2', '5559876543', 'tienda2@example.com');

-- PASO 3: Agregar columna tienda_id a Usuarios
-- SQLite no permite agregar columnas con NOT NULL directamente, 
-- así que primero agregamos como nullable y luego actualizamos
ALTER TABLE Usuarios ADD COLUMN tienda_id INTEGER;

-- PASO 4: Asignar tienda por defecto (la primera tienda)
UPDATE Usuarios SET tienda_id = 1 WHERE tienda_id IS NULL;

-- PASO 5: Agregar columna tienda_id a Clientes
ALTER TABLE Clientes ADD COLUMN tienda_id INTEGER;
UPDATE Clientes SET tienda_id = 1 WHERE tienda_id IS NULL;

-- PASO 6: Agregar columna tienda_id a products
ALTER TABLE products ADD COLUMN tienda_id INTEGER;
UPDATE products SET tienda_id = 1 WHERE tienda_id IS NULL;

-- PASO 7: Agregar columna tienda_id a sales
ALTER TABLE sales ADD COLUMN tienda_id INTEGER;
UPDATE sales SET tienda_id = 1 WHERE tienda_id IS NULL;

-- PASO 8: Agregar columna tienda_id a payments
ALTER TABLE payments ADD COLUMN tienda_id INTEGER;
UPDATE payments SET tienda_id = 1 WHERE tienda_id IS NULL;

-- PASO 9: Agregar columna tienda_id a audit_logs
ALTER TABLE audit_logs ADD COLUMN tienda_id INTEGER;
UPDATE audit_logs SET tienda_id = 1 WHERE tienda_id IS NULL;

-- PASO 10: Crear índices para mejorar performance
CREATE INDEX IF NOT EXISTS idx_usuarios_tienda ON Usuarios(tienda_id);
CREATE INDEX IF NOT EXISTS idx_clientes_tienda ON Clientes(tienda_id);
CREATE INDEX IF NOT EXISTS idx_products_tienda ON products(tienda_id);
CREATE INDEX IF NOT EXISTS idx_sales_tienda ON sales(tienda_id);
CREATE INDEX IF NOT EXISTS idx_payments_tienda ON payments(tienda_id);
CREATE INDEX IF NOT EXISTS idx_auditlogs_tienda ON audit_logs(tienda_id);

-- NOTA: En SQLite las foreign keys y constraints NOT NULL 
-- se manejarán en el nivel de aplicación (Sequelize)

-- ============================================
-- FIN DE LA MIGRACIÓN
-- ============================================

-- VERIFICACIÓN: Consultar datos actualizados
SELECT 'Usuarios' as tabla, COUNT(*) as registros FROM Usuarios;
SELECT 'Clientes' as tabla, COUNT(*) as registros FROM Clientes;
SELECT 'Products' as tabla, COUNT(*) as registros FROM products;
SELECT 'Sales' as tabla, COUNT(*) as registros FROM sales;
SELECT 'Stores' as tabla, COUNT(*) as registros FROM stores;

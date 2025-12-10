ALTER TABLE Users ADD COLUMN tienda_id INTEGER DEFAULT 1;
UPDATE Users SET tienda_id = 1 WHERE tienda_id IS NULL;

ALTER TABLE clients ADD COLUMN tienda_id INTEGER DEFAULT 1;
UPDATE clients SET tienda_id = 1 WHERE tienda_id IS NULL;

ALTER TABLE products ADD COLUMN tienda_id INTEGER DEFAULT 1;
UPDATE products SET tienda_id = 1 WHERE tienda_id IS NULL;

ALTER TABLE sales ADD COLUMN tienda_id INTEGER DEFAULT 1;
UPDATE sales SET tienda_id = 1 WHERE tienda_id IS NULL;

ALTER TABLE payments ADD COLUMN tienda_id INTEGER DEFAULT 1;
UPDATE payments SET tienda_id = 1 WHERE tienda_id IS NULL;

CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER,
    username VARCHAR(255),
    action VARCHAR(255) NOT NULL,
    details TEXT,
    tienda_id INTEGER DEFAULT 1,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_tienda ON Users(tienda_id);
CREATE INDEX IF NOT EXISTS idx_clients_tienda ON clients(tienda_id);
CREATE INDEX IF NOT EXISTS idx_products_tienda ON products(tienda_id);
CREATE INDEX IF NOT EXISTS idx_sales_tienda ON sales(tienda_id);
CREATE INDEX IF NOT EXISTS idx_payments_tienda ON payments(tienda_id);

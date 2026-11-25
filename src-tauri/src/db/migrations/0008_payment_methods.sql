CREATE TABLE payment_methods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL UNIQUE,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')),
    created_by INTEGER REFERENCES users(id),
    updated_by INTEGER REFERENCES users(id)
);

INSERT INTO payment_methods (id, name, name_key, active) VALUES
    (1, 'Efectivo', 'efectivo', 1),
    (2, 'Pago móvil', 'pago móvil', 1),
    (3, 'Zelle', 'zelle', 1),
    (4, 'Transferencia', 'transferencia', 1),
    (5, 'Punto de venta', 'punto de venta', 1);

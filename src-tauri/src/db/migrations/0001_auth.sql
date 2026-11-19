CREATE TABLE roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE permissions (
    key TEXT PRIMARY KEY
);

CREATE TABLE role_permissions (
    role_id INTEGER NOT NULL REFERENCES roles(id),
    permission_key TEXT NOT NULL REFERENCES permissions(key),
    PRIMARY KEY (role_id, permission_key)
);

CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role_id INTEGER NOT NULL REFERENCES roles(id),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    recovery_code_hash TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')),
    created_by INTEGER REFERENCES users(id),
    updated_by INTEGER REFERENCES users(id)
);

INSERT INTO permissions (key) VALUES
    ('clients.read'),
    ('clients.write'),
    ('catalog.read'),
    ('catalog.write'),
    ('resources.manage'),
    ('appointments.read'),
    ('appointments.write'),
    ('appointments.reopen'),
    ('payments.read'),
    ('payments.write'),
    ('rates.manage'),
    ('metrics.read'),
    ('audit.read'),
    ('users.manage'),
    ('backup.manage');

INSERT INTO roles (id, name) VALUES
    (1, 'Propietaria'),
    (2, 'Recepción'),
    (3, 'Solo lectura');

INSERT INTO role_permissions (role_id, permission_key)
SELECT 1, key FROM permissions;

INSERT INTO role_permissions (role_id, permission_key) VALUES
    (2, 'clients.read'),
    (2, 'clients.write'),
    (2, 'catalog.read'),
    (2, 'appointments.read'),
    (2, 'appointments.write'),
    (2, 'payments.read'),
    (2, 'payments.write'),
    (2, 'rates.manage'),
    (3, 'clients.read'),
    (3, 'catalog.read'),
    (3, 'appointments.read'),
    (3, 'payments.read');

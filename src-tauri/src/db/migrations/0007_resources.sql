CREATE TABLE resources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK (kind IN ('cabin', 'manicure')),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')),
    created_by INTEGER REFERENCES users(id),
    updated_by INTEGER REFERENCES users(id)
);

INSERT INTO resources (id, name, name_key, kind, active) VALUES
    (1, 'Cabina 1', 'cabina 1', 'cabin', 1),
    (2, 'Cabina 2', 'cabina 2', 'cabin', 1),
    (3, 'Manicure (Rosa)', 'manicure (rosa)', 'manicure', 0);

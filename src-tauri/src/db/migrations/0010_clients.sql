CREATE TABLE clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL CHECK (length(trim(first_name)) > 0),
    last_name TEXT NOT NULL CHECK (length(trim(last_name)) > 0),
    national_id TEXT NOT NULL UNIQUE CHECK (
        national_id GLOB '[VEJ]-[0-9]*'
        AND substr(national_id, 3) NOT GLOB '*[^0-9]*'
        AND length(national_id) BETWEEN 8 AND 11
    ),
    phone TEXT NOT NULL CHECK (length(trim(phone)) > 0 AND length(phone) <= 32),
    search_key TEXT NOT NULL,
    deleted_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')),
    created_by INTEGER REFERENCES users(id),
    updated_by INTEGER REFERENCES users(id)
);

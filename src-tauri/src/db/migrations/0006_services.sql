CREATE TABLE services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL UNIQUE,
    price_cents INTEGER NOT NULL CHECK (price_cents BETWEEN 1 AND 100000000000),
    currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
    duration_min INTEGER NOT NULL
        CHECK (duration_min > 0 AND duration_min % 5 = 0 AND duration_min <= 1440),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')),
    created_by INTEGER REFERENCES users(id),
    updated_by INTEGER REFERENCES users(id)
);

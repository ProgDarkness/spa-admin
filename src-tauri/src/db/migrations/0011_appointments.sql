CREATE TABLE appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL REFERENCES clients(id),
    service_id INTEGER NOT NULL REFERENCES services(id),
    resource_id INTEGER NOT NULL REFERENCES resources(id),
    starts_at TEXT NOT NULL
        CHECK (strftime('%Y-%m-%dT%H:%M', starts_at) IS starts_at),
    ends_at TEXT NOT NULL
        CHECK (strftime('%Y-%m-%dT%H:%M', ends_at) IS ends_at),
    status TEXT NOT NULL
        CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show')),
    price_cents_snapshot INTEGER NOT NULL CHECK (price_cents_snapshot >= 0),
    duration_min_snapshot INTEGER NOT NULL
        CHECK (duration_min_snapshot BETWEEN 1 AND 1440),
    notes TEXT CHECK (notes IS NULL OR length(notes) <= 500),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')),
    created_by INTEGER REFERENCES users(id),
    updated_by INTEGER REFERENCES users(id),
    CHECK (
        ends_at IS strftime(
            '%Y-%m-%dT%H:%M', starts_at, '+' || duration_min_snapshot || ' minutes'
        )
    ),
    CHECK (
        substr(ends_at, 1, 10) = substr(starts_at, 1, 10)
        OR ends_at IS strftime('%Y-%m-%dT00:00', substr(starts_at, 1, 10), '+1 day')
    )
);

CREATE INDEX appointments_resource_starts_at ON appointments (resource_id, starts_at);
CREATE INDEX appointments_client_starts_at ON appointments (client_id, starts_at);
CREATE INDEX appointments_starts_at ON appointments (starts_at);

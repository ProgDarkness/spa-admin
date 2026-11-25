CREATE TABLE exchange_rates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL UNIQUE
        CHECK (
            date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
            AND date(date) IS date
            AND substr(date, 1, 4) BETWEEN '2000' AND '2099'
        ),
    rate_bs_per_usd_e4 INTEGER NOT NULL
        CHECK (rate_bs_per_usd_e4 > 0 AND rate_bs_per_usd_e4 <= 100000000000),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')),
    created_by INTEGER REFERENCES users(id),
    updated_by INTEGER REFERENCES users(id)
);

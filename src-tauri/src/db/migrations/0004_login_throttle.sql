CREATE TABLE login_throttle (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    failures INTEGER NOT NULL CHECK (failures BETWEEN 1 AND 5),
    last_failure_at_utc TEXT NOT NULL CHECK (last_failure_at_utc GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
    locked_until_utc TEXT CHECK (locked_until_utc IS NULL OR locked_until_utc GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
    CHECK ((failures = 5) = (locked_until_utc IS NOT NULL))
);

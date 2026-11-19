CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime'))
        CHECK (length(occurred_at) = 19),
    occurred_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        CHECK (occurred_at_utc GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
    actor_user_id INTEGER REFERENCES users(id),
    action TEXT NOT NULL CHECK (action IN (
        'login_succeeded',
        'login_failed',
        'login_locked_out',
        'logout',
        'session_locked',
        'session_unlocked',
        'unlock_failed',
        'owner_created',
        'recovery_used',
        'recovery_failed',
        'user_created',
        'user_updated',
        'password_reset',
        'role_created',
        'role_permissions_changed',
        'clock_rollback'
    )),
    entity TEXT NOT NULL CHECK (entity IN ('user', 'role', 'system')),
    entity_id INTEGER,
    diff TEXT CHECK (diff IS NULL OR json_valid(diff))
);

CREATE INDEX audit_log_occurred_at_utc ON audit_log (occurred_at_utc);

CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN
    SELECT RAISE(ABORT, 'audit_log is append-only');
END;

CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN
    SELECT RAISE(ABORT, 'audit_log is append-only');
END;

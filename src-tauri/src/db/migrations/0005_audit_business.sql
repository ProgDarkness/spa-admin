DROP TRIGGER audit_log_no_update;
DROP TRIGGER audit_log_no_delete;

ALTER TABLE audit_log RENAME TO audit_log_v1;
DROP INDEX audit_log_occurred_at_utc;

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
        'clock_rollback',
        'create',
        'update',
        'deactivate',
        'soft_delete',
        'reactivate',
        'void',
        'backup_created',
        'backup_restored'
    )),
    entity TEXT NOT NULL CHECK (entity IN (
        'user',
        'role',
        'system',
        'client',
        'service',
        'resource',
        'appointment',
        'payment',
        'payment_method',
        'exchange_rate'
    )),
    entity_id INTEGER,
    diff TEXT CHECK (diff IS NULL OR json_valid(diff))
);

INSERT INTO audit_log (id, occurred_at, occurred_at_utc, actor_user_id, action, entity, entity_id, diff)
SELECT id, occurred_at, occurred_at_utc, actor_user_id, action, entity, entity_id, diff
FROM audit_log_v1
ORDER BY id;

DROP TABLE audit_log_v1;

CREATE INDEX audit_log_occurred_at_utc ON audit_log (occurred_at_utc);

CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN
    SELECT RAISE(ABORT, 'audit_log is append-only');
END;

CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN
    SELECT RAISE(ABORT, 'audit_log is append-only');
END;

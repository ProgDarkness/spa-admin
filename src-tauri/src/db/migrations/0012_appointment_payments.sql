CREATE TABLE appointment_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    appointment_id INTEGER NOT NULL REFERENCES appointments(id),
    method_id INTEGER NOT NULL REFERENCES payment_methods(id),
    currency TEXT NOT NULL CHECK (currency IN ('USD', 'VES')),
    amount_cents INTEGER NOT NULL
        CHECK (amount_cents > 0 AND amount_cents <= 100000000000),
    rate_bs_per_usd_e4 INTEGER,
    usd_equivalent_cents INTEGER NOT NULL
        CHECK (usd_equivalent_cents BETWEEN 1 AND 9007199254740991),
    paid_at TEXT NOT NULL
        CHECK (strftime('%Y-%m-%dT%H:%M', paid_at) IS paid_at),
    voided_at TEXT
        CHECK (
            voided_at IS NULL
            OR (strftime('%Y-%m-%dT%H:%M', voided_at) IS voided_at AND voided_at >= paid_at)
        ),
    voided_by INTEGER REFERENCES users(id),
    void_reason TEXT
        CHECK (void_reason IS NULL OR length(void_reason) BETWEEN 1 AND 200),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')),
    created_by INTEGER REFERENCES users(id),
    updated_by INTEGER REFERENCES users(id),
    CHECK (
        (currency = 'USD'
            AND rate_bs_per_usd_e4 IS NULL
            AND usd_equivalent_cents = amount_cents)
        OR (currency = 'VES'
            AND rate_bs_per_usd_e4 IS NOT NULL
            AND rate_bs_per_usd_e4 BETWEEN 1 AND 100000000000
            AND usd_equivalent_cents
                = (amount_cents * 20000 + rate_bs_per_usd_e4) / (2 * rate_bs_per_usd_e4))
    ),
    CHECK (
        (voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL)
        OR (voided_at IS NOT NULL AND voided_by IS NOT NULL AND void_reason IS NOT NULL)
    )
);

CREATE INDEX appointment_payments_appointment ON appointment_payments (appointment_id);
CREATE INDEX appointment_payments_paid_at ON appointment_payments (paid_at);

CREATE TRIGGER appointment_payments_no_delete
BEFORE DELETE ON appointment_payments
BEGIN
    SELECT RAISE(ABORT, 'payments cannot be deleted');
END;

CREATE TRIGGER appointment_payments_immutable
BEFORE UPDATE ON appointment_payments
WHEN OLD.voided_at IS NOT NULL
    OR NEW.id IS NOT OLD.id
    OR NEW.created_at IS NOT OLD.created_at
    OR NEW.created_by IS NOT OLD.created_by
    OR NEW.appointment_id IS NOT OLD.appointment_id
    OR NEW.method_id IS NOT OLD.method_id
    OR NEW.currency IS NOT OLD.currency
    OR NEW.amount_cents IS NOT OLD.amount_cents
    OR NEW.rate_bs_per_usd_e4 IS NOT OLD.rate_bs_per_usd_e4
    OR NEW.usd_equivalent_cents IS NOT OLD.usd_equivalent_cents
    OR NEW.paid_at IS NOT OLD.paid_at
BEGIN
    SELECT RAISE(ABORT, 'payment is immutable');
END;

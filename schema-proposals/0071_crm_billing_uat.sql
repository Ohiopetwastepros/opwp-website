-- UNAPPLIED UAT-ONLY PROPOSAL. Requires separately reviewed 0070 first.
-- No payment tokens, PAN, CVV, bank account or routing numbers are columns.
PRAGMA foreign_keys=ON;
CREATE TABLE crm_billing_settings (
  organization_id TEXT PRIMARY KEY, revision INTEGER NOT NULL,
  settings_json TEXT NOT NULL CHECK(json_valid(settings_json)),
  updated_by TEXT NOT NULL, reason TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE crm_billing_methods (
  id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, organization_id TEXT NOT NULL,
  revision INTEGER NOT NULL, is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN(0,1)),
  method_json TEXT NOT NULL CHECK(json_valid(method_json)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY(organization_id,customer_id) REFERENCES crm_subscription_customers(organization_id,id),
  CHECK(json_type(method_json,'$.token') IS NULL), CHECK(json_type(method_json,'$.account') IS NULL),
  CHECK(json_type(method_json,'$.routing') IS NULL), CHECK(json_type(method_json,'$.cvv') IS NULL)
);
CREATE UNIQUE INDEX crm_billing_default_method ON crm_billing_methods(customer_id,organization_id) WHERE is_default=1;
CREATE TABLE crm_billing_invoices (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, customer_id TEXT NOT NULL,
  invoice_key TEXT NOT NULL UNIQUE, invoice_type TEXT NOT NULL, period_start TEXT NOT NULL, period_end TEXT NOT NULL,
  revision INTEGER NOT NULL, status TEXT NOT NULL, state_json TEXT NOT NULL CHECK(json_valid(state_json)),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY(organization_id,customer_id) REFERENCES crm_subscription_customers(organization_id,id),
  CHECK(json_extract(state_json,'$.id')=id), CHECK(json_extract(state_json,'$.customerId')=customer_id),
  CHECK(json_extract(state_json,'$.revision')=revision), CHECK(json_extract(state_json,'$.status')=status)
);
CREATE INDEX crm_billing_period ON crm_billing_invoices(organization_id,period_start,id);
CREATE TABLE crm_billing_coverage (
  invoice_id TEXT NOT NULL REFERENCES crm_billing_invoices(id), subscription_id TEXT NOT NULL REFERENCES crm_subscriptions(id),
  start_date TEXT NOT NULL, end_date TEXT NOT NULL, released_at TEXT,
  PRIMARY KEY(invoice_id,subscription_id,start_date,end_date), CHECK(start_date<end_date)
);
CREATE TRIGGER crm_billing_coverage_overlap BEFORE INSERT ON crm_billing_coverage
WHEN NEW.released_at IS NULL BEGIN
  SELECT RAISE(ABORT,'BILLING_COVERAGE_OVERLAP') WHERE EXISTS(
    SELECT 1 FROM crm_billing_coverage c WHERE c.subscription_id=NEW.subscription_id AND c.released_at IS NULL
    AND c.start_date<NEW.end_date AND NEW.start_date<c.end_date AND c.invoice_id<>NEW.invoice_id
  );
END;
CREATE TABLE crm_billing_credit_reservations (
  invoice_id TEXT NOT NULL REFERENCES crm_billing_invoices(id), subscription_id TEXT NOT NULL REFERENCES crm_subscriptions(id),
  credit_id TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
  available_cents INTEGER NOT NULL CHECK(available_cents>=amount_cents),
  status TEXT NOT NULL CHECK(status IN('reserved','applied','released')),
  PRIMARY KEY(invoice_id,subscription_id,credit_id)
);
CREATE TRIGGER crm_billing_credit_capacity BEFORE INSERT ON crm_billing_credit_reservations
WHEN NEW.status='reserved' BEGIN
  SELECT RAISE(ABORT,'BILLING_CREDIT_CAPACITY') WHERE NEW.amount_cents+COALESCE((
    SELECT SUM(r.amount_cents) FROM crm_billing_credit_reservations r
    WHERE r.subscription_id=NEW.subscription_id AND r.credit_id=NEW.credit_id AND r.status='reserved'
  ),0)>NEW.available_cents;
END;
CREATE TABLE crm_billing_attempts (
  idempotency_key TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES crm_billing_invoices(id), attempt INTEGER NOT NULL,
  method_id TEXT NOT NULL REFERENCES crm_billing_methods(id), provider_order_id TEXT NOT NULL UNIQUE,
  amount_cents INTEGER NOT NULL CHECK(amount_cents>=0), method_json TEXT NOT NULL CHECK(json_valid(method_json)),
  status TEXT NOT NULL, result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(invoice_id,attempt)
);
CREATE TABLE crm_billing_adjustments (
  idempotency_key TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES crm_billing_invoices(id),
  kind TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents>0), status TEXT NOT NULL,
  result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)), actor TEXT NOT NULL, reason TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX crm_billing_one_open_adjustment ON crm_billing_adjustments(invoice_id) WHERE status IN('requested','unknown');
CREATE TABLE crm_billing_commands (
  id TEXT PRIMARY KEY, actor TEXT NOT NULL, body_hash TEXT NOT NULL,
  status TEXT NOT NULL, result_json TEXT NOT NULL CHECK(json_valid(result_json)), created_at TEXT NOT NULL
);
CREATE TABLE crm_billing_webhook_hints (
  event_id TEXT PRIMARY KEY, provider TEXT NOT NULL, invoice_id TEXT REFERENCES crm_billing_invoices(id),
  order_id TEXT, transaction_id TEXT, received_at TEXT NOT NULL
);
CREATE TABLE crm_billing_qbo_outbox (
  id TEXT PRIMARY KEY, source_key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, invoice_id TEXT REFERENCES crm_billing_invoices(id),
  status TEXT NOT NULL, job_json TEXT NOT NULL CHECK(json_valid(job_json)), qbo_id TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE crm_billing_audit (
  id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, action TEXT NOT NULL,
  actor TEXT NOT NULL, occurred_at TEXT NOT NULL, old_json TEXT, new_json TEXT, reason TEXT NOT NULL
);
CREATE TABLE crm_billing_deposit_links (
  qbo_payment_id TEXT PRIMARY KEY, source_key TEXT NOT NULL REFERENCES crm_billing_qbo_outbox(source_key)
);
CREATE TABLE crm_billing_fee_statements (
  statement_id TEXT PRIMARY KEY, recognition_mode TEXT NOT NULL CHECK(recognition_mode IN('direct','accrual'))
);
CREATE TABLE crm_billing_runner_cursors (
  id TEXT PRIMARY KEY, cursor TEXT NOT NULL
);
CREATE TABLE crm_billing_write_guards (
  id TEXT PRIMARY KEY, expected_revision INTEGER NOT NULL, actual_revision INTEGER NOT NULL,
  CONSTRAINT crm_billing_revision_conflict CHECK(expected_revision=actual_revision)
);

CREATE TABLE IF NOT EXISTS sng_invoices (
  invoice_id TEXT PRIMARY KEY,
  invoice_number TEXT,
  sng_user_id TEXT,
  client_ref TEXT,
  client_name TEXT,
  invoice_type TEXT,
  category TEXT,
  billing_interval TEXT,
  total REAL NOT NULL DEFAULT 0,
  subtotal REAL NOT NULL DEFAULT 0,
  tax REAL NOT NULL DEFAULT 0,
  tip_amount REAL NOT NULL DEFAULT 0,
  paid TEXT,
  remaining REAL NOT NULL DEFAULT 0,
  invoice_created_at TEXT,
  period_start TEXT,
  period_end TEXT,
  due_date TEXT,
  source_event_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sng_invoices_type_created
  ON sng_invoices(invoice_type, invoice_created_at);

CREATE INDEX IF NOT EXISTS idx_sng_invoices_user
  ON sng_invoices(sng_user_id);

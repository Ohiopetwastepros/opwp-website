CREATE TABLE IF NOT EXISTS financial_management_settings (
  id TEXT PRIMARY KEY,
  books_status TEXT NOT NULL DEFAULT 'rectifying'
    CHECK (books_status IN ('verified', 'rectifying', 'provisional')),
  verified_cash_balance REAL,
  verified_cash_as_of TEXT,
  owner_monthly_pay REAL NOT NULL DEFAULT 8500,
  minimum_monthly_retained_cash REAL NOT NULL DEFAULT 3000,
  protected_cash_floor REAL NOT NULL DEFAULT 65000,
  monthly_tax_reserve REAL NOT NULL DEFAULT 2500,
  payroll_burden_percent REAL NOT NULL DEFAULT 12,
  tony_current_rate REAL NOT NULL DEFAULT 30,
  tony_current_weekly_hours REAL NOT NULL DEFAULT 40,
  tony_target_rate REAL NOT NULL DEFAULT 30,
  tony_target_weekly_hours REAL NOT NULL DEFAULT 40,
  bria_current_rate REAL NOT NULL DEFAULT 21,
  bria_current_weekly_hours REAL NOT NULL DEFAULT 0,
  bria_target_weekly_hours REAL NOT NULL DEFAULT 0,
  truck_purchase_price REAL NOT NULL DEFAULT 35000,
  truck_down_payment REAL NOT NULL DEFAULT 10000,
  truck_apr_percent REAL NOT NULL DEFAULT 9,
  truck_term_months INTEGER NOT NULL DEFAULT 48,
  truck_monthly_insurance REAL NOT NULL DEFAULT 300,
  truck_monthly_maintenance REAL NOT NULL DEFAULT 200,
  notes TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO financial_management_settings
  (id, books_status, verified_cash_balance, verified_cash_as_of, notes)
VALUES
  ('primary', 'rectifying', 78197.37, '2026-07-23', 'Tony full-time at $30/hour and Bria off payroll; books remain under rectification.');

CREATE TABLE IF NOT EXISTS financial_management_audit (
  id TEXT PRIMARY KEY,
  settings_id TEXT NOT NULL REFERENCES financial_management_settings(id),
  actor_email TEXT,
  prior_values TEXT,
  next_values TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_financial_management_audit_created
  ON financial_management_audit(created_at DESC);

CREATE TABLE IF NOT EXISTS financial_daily_snapshots (
  id TEXT PRIMARY KEY,
  snapshot_date TEXT NOT NULL UNIQUE,
  source_status TEXT NOT NULL,
  books_status TEXT NOT NULL,
  qbo_cash REAL,
  verified_cash REAL,
  revenue_mtd REAL,
  expenses_mtd REAL,
  net_income_mtd REAL,
  accounts_receivable REAL,
  current_liabilities REAL,
  payload TEXT NOT NULL DEFAULT '{}',
  captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_financial_daily_snapshots_date
  ON financial_daily_snapshots(snapshot_date DESC);

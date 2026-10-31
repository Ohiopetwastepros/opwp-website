CREATE TABLE IF NOT EXISTS quickbooks_metadata_cache (
  id TEXT PRIMARY KEY,
  environment TEXT NOT NULL,
  classes_json TEXT NOT NULL DEFAULT '[]',
  locations_json TEXT NOT NULL DEFAULT '[]',
  accounts_json TEXT NOT NULL DEFAULT '[]',
  products_json TEXT NOT NULL DEFAULT '[]',
  warnings_json TEXT NOT NULL DEFAULT '[]',
  refreshed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

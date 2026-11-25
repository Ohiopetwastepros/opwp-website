-- PROPOSAL ONLY. Separate production schema authorization is required.
-- Default state preserves current operation until a verified, explicit cutover.
CREATE TABLE dog_food_store_settings (
  id TEXT PRIMARY KEY CHECK(id='org-opwp'),
  backend TEXT NOT NULL DEFAULT 'airtable' CHECK(backend IN('airtable','website')),
  writes_paused INTEGER NOT NULL DEFAULT 0 CHECK(writes_paused IN(0,1)),
  revision INTEGER NOT NULL DEFAULT 1,
  import_id TEXT, source_hash TEXT, source_captured_at TEXT,
  activated_by TEXT, activated_at TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO dog_food_store_settings(id) VALUES('org-opwp');
CREATE TABLE dog_food_business_imports (
  id TEXT PRIMARY KEY, source_hash TEXT NOT NULL, manifest TEXT NOT NULL CHECK(json_valid(manifest)),
  reconciliation TEXT NOT NULL CHECK(json_valid(reconciliation)),
  imported_by TEXT NOT NULL, imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE dog_food_business_records (
  table_name TEXT NOT NULL CHECK(table_name IN('Products','Customers','Sales','Subscriptions','Deliveries','Restock Log','Bag Delivery Map','Stock Locations','Purchase Orders','Purchase Order Lines','Inventory Adjustments','Payment Receipts','Supplier Payments')),
  id TEXT NOT NULL, fields TEXT NOT NULL CHECK(json_valid(fields) AND json_type(fields)='object'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  source_provider TEXT NOT NULL CHECK(source_provider IN('airtable','website')),
  source_record_id TEXT, import_id TEXT REFERENCES dog_food_business_imports(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(table_name,id)
);
CREATE TABLE dog_food_business_events (
  id TEXT PRIMARY KEY, command_id TEXT NOT NULL, table_name TEXT NOT NULL, record_id TEXT NOT NULL,
  actor TEXT NOT NULL, before_fields TEXT CHECK(before_fields IS NULL OR json_valid(before_fields)),
  after_fields TEXT NOT NULL CHECK(json_valid(after_fields)), revision INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(command_id,table_name,record_id)
);
CREATE INDEX idx_food_business_events_record ON dog_food_business_events(table_name,record_id,created_at);
CREATE TRIGGER food_business_events_no_update BEFORE UPDATE ON dog_food_business_events BEGIN
  SELECT RAISE(ABORT,'Operating events are immutable');
END;
CREATE TRIGGER food_business_events_no_delete BEFORE DELETE ON dog_food_business_events BEGIN
  SELECT RAISE(ABORT,'Operating events are retained');
END;
CREATE TRIGGER food_business_records_no_delete BEFORE DELETE ON dog_food_business_records BEGIN
  SELECT RAISE(ABORT,'Archive operating records instead of deleting history');
END;
CREATE TABLE dog_food_route_confirmations (
  customer_id TEXT PRIMARY KEY REFERENCES dog_food_customers(id),
  profile_revision INTEGER NOT NULL, relationship TEXT NOT NULL CHECK(relationship IN('food_only','linked')),
  evidence TEXT NOT NULL CHECK(json_valid(evidence)), reviewed_by TEXT NOT NULL,
  reviewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE dog_food_business_assets (
  id TEXT PRIMARY KEY, storage_key TEXT NOT NULL UNIQUE, content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK(byte_size BETWEEN 1 AND 10485760), sha256 TEXT NOT NULL,
  original_filename TEXT NOT NULL, source_record_id TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE dog_food_legacy_plan_requests (
  id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES dog_food_customers(id), plan_id TEXT NOT NULL,
  request_type TEXT NOT NULL CHECK(request_type IN('pause','resume','cancel','change')),
  details TEXT NOT NULL CHECK(json_valid(details)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','completed','rejected')),
  office_note TEXT NOT NULL DEFAULT '', reviewed_by TEXT, reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE dog_food_backup_runs (
  id TEXT PRIMARY KEY, status TEXT NOT NULL CHECK(status IN('running','verified','failed')),
  storage_key TEXT, sha256 TEXT, byte_size INTEGER, manifest TEXT CHECK(manifest IS NULL OR json_valid(manifest)),
  error TEXT, started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, verified_at TEXT
);

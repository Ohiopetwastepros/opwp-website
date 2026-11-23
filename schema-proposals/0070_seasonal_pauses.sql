-- Proposal only. Apply separately after the owner's migration approval.
-- No production records, seeds, triggers, or changes to existing tables.
CREATE TABLE seasonal_pause_events (
  id TEXT PRIMARY KEY,
  sng_client_id TEXT NOT NULL,
  sng_subscription_id TEXT,
  subscription_key TEXT NOT NULL,
  subscription_descriptor TEXT NOT NULL,
  subscription_kind TEXT NOT NULL CHECK (subscription_kind IN ('residential', 'commercial')),
  client_name TEXT,
  email TEXT,
  phone TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN ('paused', 'unpaused', 'canceled_seasonal')),
  event_at TEXT NOT NULL,
  pause_start_date TEXT,
  pause_end_date TEXT,
  planned_restart_date TEXT,
  pause_reason TEXT,
  seasonal_pattern TEXT NOT NULL DEFAULT 'unknown'
    CHECK (seasonal_pattern IN ('winter', 'spring_fall', 'summer', 'other', 'unknown', 'year_round')),
  source TEXT NOT NULL CHECK (source IN ('webhook', 'subscription_sync', 'manual')),
  period_key TEXT NOT NULL,
  raw_payload TEXT NOT NULL CHECK (json_valid(raw_payload)),
  airtable_record_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_seasonal_pause_events_client
  ON seasonal_pause_events(sng_client_id, event_at);
CREATE INDEX idx_seasonal_pause_events_period
  ON seasonal_pause_events(period_key, event_type);
CREATE TABLE seasonal_pause_clients (
  sng_client_id TEXT PRIMARY KEY,
  client_name TEXT,
  email TEXT,
  phone TEXT,
  seasonal_pattern TEXT NOT NULL DEFAULT 'unknown'
    CHECK (seasonal_pattern IN ('winter', 'spring_fall', 'summer', 'other', 'unknown', 'year_round')),
  pause_start_date TEXT,
  pause_end_date TEXT,
  planned_restart_date TEXT,
  pause_reason TEXT,
  pause_count INTEGER NOT NULL DEFAULT 0 CHECK (pause_count >= 0),
  next_action_date TEXT,
  is_paused INTEGER NOT NULL DEFAULT 0 CHECK (is_paused IN (0, 1)),
  last_event_at TEXT,
  pause_history TEXT NOT NULL DEFAULT '',
  baseline_pause_count INTEGER,
  baseline_period_keys TEXT CHECK (baseline_period_keys IS NULL OR json_valid(baseline_period_keys)),
  baseline_review_period_keys TEXT CHECK (baseline_review_period_keys IS NULL OR json_valid(baseline_review_period_keys)),
  airtable_record_id TEXT,
  airtable_synced_at TEXT,
  airtable_sync_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (airtable_sync_status IN ('pending', 'synced', 'unmatched', 'failed')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_seasonal_pause_clients_action
  ON seasonal_pause_clients(next_action_date);

CREATE TABLE IF NOT EXISTS route_geocode_cache (
  address_hash TEXT PRIMARY KEY,
  normalized_address TEXT NOT NULL,
  formatted_address TEXT,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  confidence REAL,
  match_type TEXT,
  provider TEXT NOT NULL DEFAULT 'geoapify',
  provider_place_id TEXT,
  geocoded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_route_geocode_cache_updated
  ON route_geocode_cache(updated_at);

CREATE TABLE IF NOT EXISTS route_analysis_runs (
  id TEXT PRIMARY KEY,
  service_date TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'sweep_and_go',
  status TEXT NOT NULL CHECK (status IN ('running', 'complete', 'partial', 'failed')),
  source_job_count INTEGER NOT NULL DEFAULT 0,
  normalized_stop_count INTEGER NOT NULL DEFAULT 0,
  geocoded_stop_count INTEGER NOT NULL DEFAULT 0,
  route_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_route_analysis_runs_date
  ON route_analysis_runs(service_date, started_at);

CREATE TABLE IF NOT EXISTS route_day_metrics (
  id TEXT PRIMARY KEY,
  analysis_run_id TEXT NOT NULL REFERENCES route_analysis_runs(id),
  service_date TEXT NOT NULL,
  technician_id TEXT NOT NULL DEFAULT '',
  technician_name TEXT NOT NULL DEFAULT 'Unassigned',
  route_id TEXT NOT NULL DEFAULT '',
  stop_count INTEGER NOT NULL DEFAULT 0,
  geocoded_stop_count INTEGER NOT NULL DEFAULT 0,
  service_minutes REAL NOT NULL DEFAULT 0,
  drive_minutes REAL,
  distance_miles REAL,
  planned_minutes REAL,
  remaining_to_target_minutes REAL,
  planning_target_minutes REAL NOT NULL DEFAULT 480,
  service_time_coverage REAL NOT NULL DEFAULT 0,
  route_status TEXT NOT NULL DEFAULT 'incomplete',
  calculated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (analysis_run_id, technician_id, route_id)
);

CREATE INDEX IF NOT EXISTS idx_route_day_metrics_date
  ON route_day_metrics(service_date, technician_id);

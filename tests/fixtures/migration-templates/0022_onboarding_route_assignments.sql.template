CREATE TABLE IF NOT EXISTS onboarding_route_assignments (
  id TEXT PRIMARY KEY,
  submission_id TEXT UNIQUE REFERENCES submissions(id),
  customer_name TEXT,
  address TEXT NOT NULL,
  frequency TEXT NOT NULL,
  recommended_day TEXT,
  recommended_pair TEXT,
  recommended_technician TEXT,
  confidence TEXT NOT NULL DEFAULT 'review',
  status TEXT NOT NULL DEFAULT 'recommended',
  reason TEXT,
  analysis_payload TEXT NOT NULL,
  approved_at TEXT,
  applied_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_onboarding_route_assignments_created
  ON onboarding_route_assignments(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_onboarding_route_assignments_status
  ON onboarding_route_assignments(status, created_at DESC);

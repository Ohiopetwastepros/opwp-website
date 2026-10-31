CREATE TABLE IF NOT EXISTS route_subscription_plans (
  id TEXT PRIMARY KEY,
  source_snapshot_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('complete', 'partial', 'failed')),
  active_customers INTEGER NOT NULL DEFAULT 0,
  scheduled_visits INTEGER NOT NULL DEFAULT 0,
  geocoded_customers INTEGER NOT NULL DEFAULT 0,
  fixed_twice_weekly INTEGER NOT NULL DEFAULT 0,
  route_count INTEGER NOT NULL DEFAULT 0,
  recommendation_count INTEGER NOT NULL DEFAULT 0,
  payload TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_route_subscription_plans_created
  ON route_subscription_plans(created_at);

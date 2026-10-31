CREATE TABLE IF NOT EXISTS growth_leads (
  submission_id TEXT PRIMARY KEY REFERENCES submissions(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'new'
    CHECK (stage IN ('new','contacted','qualified','quoted','won','lost')),
  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('normal','high','urgent')),
  owner_email TEXT,
  next_action TEXT,
  next_action_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_growth_leads_work_queue
  ON growth_leads(organization_id, stage, next_action_at, priority);

CREATE TABLE IF NOT EXISTS growth_lead_events (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('note','state_changed','assigned','system')),
  summary TEXT NOT NULL,
  details TEXT,
  actor_email TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_growth_lead_events_timeline
  ON growth_lead_events(organization_id, submission_id, created_at DESC);

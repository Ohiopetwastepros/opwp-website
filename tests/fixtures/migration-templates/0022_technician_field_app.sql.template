PRAGMA foreign_keys = ON;

ALTER TABLE route_partner_route_plans ADD COLUMN assigned_member_id TEXT;
ALTER TABLE route_partner_route_plans ADD COLUMN released_to_field_at TEXT;

CREATE INDEX IF NOT EXISTS idx_route_partner_plans_assignment
  ON route_partner_route_plans(organization_id, assigned_member_id, service_date, status);

CREATE TABLE IF NOT EXISTS route_partner_field_credentials (
  member_id TEXT PRIMARY KEY REFERENCES route_partner_members(id) ON DELETE CASCADE,
  pin_salt TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS route_partner_field_sessions (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES route_partner_members(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_route_partner_field_sessions_member
  ON route_partner_field_sessions(member_id, expires_at, revoked_at);

CREATE TABLE IF NOT EXISTS route_partner_field_shifts (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES route_partner_organizations(id),
  route_plan_id TEXT NOT NULL UNIQUE REFERENCES route_partner_route_plans(id),
  technician_member_id TEXT NOT NULL REFERENCES route_partner_members(id),
  vehicle_id TEXT REFERENCES route_partner_vehicles(id),
  service_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_load'
    CHECK (status IN ('pending_load', 'ready', 'in_progress', 'blocked', 'completed', 'cancelled')),
  starting_mileage REAL,
  ending_mileage REAL,
  checked_in_at TEXT,
  departed_at TEXT,
  completed_at TEXT,
  technician_notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_route_partner_field_shifts_day
  ON route_partner_field_shifts(organization_id, service_date, technician_member_id, status);

CREATE TABLE IF NOT EXISTS route_partner_shift_inventory (
  id TEXT PRIMARY KEY,
  shift_id TEXT NOT NULL REFERENCES route_partner_field_shifts(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES dog_food_products(id),
  required_quantity INTEGER NOT NULL DEFAULT 0 CHECK (required_quantity >= 0),
  loaded_quantity INTEGER NOT NULL DEFAULT 0 CHECK (loaded_quantity >= 0),
  delivered_quantity INTEGER NOT NULL DEFAULT 0 CHECK (delivered_quantity >= 0),
  returned_quantity INTEGER NOT NULL DEFAULT 0 CHECK (returned_quantity >= 0),
  damaged_quantity INTEGER NOT NULL DEFAULT 0 CHECK (damaged_quantity >= 0),
  confirmed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (shift_id, product_id)
);

CREATE TABLE IF NOT EXISTS route_partner_field_breaks (
  id TEXT PRIMARY KEY,
  shift_id TEXT NOT NULL REFERENCES route_partner_field_shifts(id) ON DELETE CASCADE,
  break_type TEXT NOT NULL CHECK (break_type IN ('paid_break', 'lunch', 'drive', 'other')),
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS route_partner_field_proofs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES route_partner_organizations(id),
  task_id TEXT NOT NULL REFERENCES route_partner_tasks(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  captured_latitude REAL,
  captured_longitude REAL,
  uploaded_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_route_partner_field_proofs_task
  ON route_partner_field_proofs(task_id, created_at DESC);

CREATE TABLE IF NOT EXISTS route_partner_notification_outbox (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES route_partner_organizations(id),
  route_plan_id TEXT NOT NULL REFERENCES route_partner_route_plans(id),
  task_id TEXT NOT NULL REFERENCES route_partner_tasks(id),
  notification_type TEXT NOT NULL CHECK (notification_type IN ('on_the_way', 'delivery_exception', 'route_change')),
  recommended_lead_minutes INTEGER,
  selected_lead_minutes INTEGER,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'cancelled')),
  provider_message_id TEXT,
  sent_at TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_route_partner_notification_queue
  ON route_partner_notification_outbox(status, created_at);

CREATE TABLE IF NOT EXISTS route_partner_field_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES route_partner_organizations(id),
  shift_id TEXT REFERENCES route_partner_field_shifts(id),
  route_plan_id TEXT REFERENCES route_partner_route_plans(id),
  location_id TEXT REFERENCES route_partner_locations(id),
  task_id TEXT REFERENCES route_partner_tasks(id),
  event_type TEXT NOT NULL,
  actor_member_id TEXT NOT NULL REFERENCES route_partner_members(id),
  latitude REAL,
  longitude REAL,
  details TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_route_partner_field_events_shift
  ON route_partner_field_events(shift_id, occurred_at);

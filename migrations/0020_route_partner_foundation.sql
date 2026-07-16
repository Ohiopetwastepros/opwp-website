PRAGMA foreign_keys = ON;

-- A route partner is the tenant boundary. OPWP is the first operating company,
-- but every imported CRM record and native delivery is scoped to an organization.
CREATE TABLE IF NOT EXISTS route_partner_organizations (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  route_review_time TEXT NOT NULL DEFAULT '06:15',
  general_finalize_time TEXT NOT NULL DEFAULT '07:00',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS route_partner_members (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES route_partner_organizations(id),
  email TEXT NOT NULL,
  display_name TEXT,
  role TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'dispatcher', 'technician', 'viewer')),
  external_employee_id TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, email)
);

CREATE INDEX IF NOT EXISTS idx_route_partner_members_employee
  ON route_partner_members(organization_id, external_employee_id);

CREATE TABLE IF NOT EXISTS route_partner_crm_connections (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES route_partner_organizations(id),
  provider TEXT NOT NULL,
  display_name TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'read_only' CHECK (mode IN ('read_only', 'read_write')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'error')),
  capabilities TEXT NOT NULL DEFAULT '{}',
  last_import_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, provider)
);

-- Route plans are immutable versions. Re-importing a dispatched day creates a
-- new draft; a finalized version remains available for audit and comparison.
CREATE TABLE IF NOT EXISTS route_partner_route_plans (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES route_partner_organizations(id),
  service_date TEXT NOT NULL,
  technician_external_id TEXT NOT NULL DEFAULT '',
  technician_name TEXT NOT NULL DEFAULT 'Unassigned',
  source_provider TEXT NOT NULL,
  source_route_id TEXT NOT NULL DEFAULT '',
  source_fingerprint TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'finalized', 'in_progress', 'completed', 'superseded', 'cancelled')),
  source_job_count INTEGER NOT NULL DEFAULT 0,
  food_task_count INTEGER NOT NULL DEFAULT 0,
  location_count INTEGER NOT NULL DEFAULT 0,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  imported_by TEXT,
  finalized_at TEXT,
  finalized_by TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, service_date, technician_external_id, source_route_id, version)
);

CREATE INDEX IF NOT EXISTS idx_route_partner_plans_day
  ON route_partner_route_plans(organization_id, service_date, status, technician_name);

CREATE TABLE IF NOT EXISTS route_partner_locations (
  id TEXT PRIMARY KEY,
  route_plan_id TEXT NOT NULL REFERENCES route_partner_route_plans(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES route_partner_organizations(id),
  location_key TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  address TEXT NOT NULL,
  latitude REAL,
  longitude REAL,
  customer_display_name TEXT,
  arrival_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (arrival_status IN ('pending', 'arrived', 'completed', 'skipped')),
  estimated_service_minutes REAL NOT NULL DEFAULT 0,
  estimated_drive_minutes REAL,
  actual_arrived_at TEXT,
  actual_completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (route_plan_id, location_key)
);

CREATE INDEX IF NOT EXISTS idx_route_partner_locations_sequence
  ON route_partner_locations(route_plan_id, sequence);

CREATE TABLE IF NOT EXISTS route_partner_tasks (
  id TEXT PRIMARY KEY,
  route_plan_id TEXT NOT NULL REFERENCES route_partner_route_plans(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL REFERENCES route_partner_locations(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES route_partner_organizations(id),
  task_type TEXT NOT NULL CHECK (task_type IN ('scoop', 'dog_food', 'other')),
  source_provider TEXT NOT NULL,
  external_task_id TEXT,
  dog_food_delivery_id TEXT REFERENCES dog_food_deliveries(id),
  customer_external_id TEXT,
  customer_display_name TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'ready', 'in_progress', 'completed', 'failed', 'cancelled', 'validation_pending')),
  estimated_minutes REAL NOT NULL DEFAULT 0,
  placement_note TEXT,
  product_summary TEXT,
  crm_completion_status TEXT NOT NULL DEFAULT 'not_required'
    CHECK (crm_completion_status IN ('not_required', 'pending', 'validated', 'mismatch')),
  completed_at TEXT,
  completion_latitude REAL,
  completion_longitude REAL,
  proof_photo_url TEXT,
  failure_reason TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (route_plan_id, source_provider, external_task_id)
);

CREATE INDEX IF NOT EXISTS idx_route_partner_tasks_location
  ON route_partner_tasks(location_id, task_type, status);
CREATE INDEX IF NOT EXISTS idx_route_partner_tasks_validation
  ON route_partner_tasks(organization_id, crm_completion_status, completed_at);

CREATE TABLE IF NOT EXISTS route_partner_plan_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES route_partner_organizations(id),
  route_plan_id TEXT REFERENCES route_partner_route_plans(id),
  event_type TEXT NOT NULL,
  actor_email TEXT,
  details TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_route_partner_plan_events_plan
  ON route_partner_plan_events(route_plan_id, occurred_at);

CREATE TABLE IF NOT EXISTS route_partner_vehicles (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES route_partner_organizations(id),
  name TEXT NOT NULL,
  inventory_location_id TEXT REFERENCES dog_food_inventory_locations(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'maintenance')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS route_partner_load_checks (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES route_partner_organizations(id),
  route_plan_id TEXT NOT NULL REFERENCES route_partner_route_plans(id),
  vehicle_id TEXT REFERENCES route_partner_vehicles(id),
  technician_member_id TEXT REFERENCES route_partner_members(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'blocked', 'waived')),
  required_items TEXT NOT NULL DEFAULT '[]',
  confirmed_items TEXT NOT NULL DEFAULT '[]',
  buffer_items TEXT NOT NULL DEFAULT '[]',
  payment_validation_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (payment_validation_status IN ('pending', 'passed', 'failed', 'not_required')),
  confirmed_at TEXT,
  confirmed_by TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (route_plan_id)
);

CREATE TABLE IF NOT EXISTS route_partner_change_requests (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES route_partner_organizations(id),
  route_plan_id TEXT REFERENCES route_partner_route_plans(id),
  task_id TEXT REFERENCES route_partner_tasks(id),
  request_type TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  customer_message TEXT,
  details TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'cancelled')),
  inventory_disposition TEXT
    CHECK (inventory_disposition IS NULL OR inventory_disposition IN ('not_applicable', 'return_to_vehicle', 'return_to_warehouse', 'damaged', 'missing')),
  requested_by TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  denial_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_route_partner_change_queue
  ON route_partner_change_requests(organization_id, status, created_at);

INSERT OR IGNORE INTO route_partner_organizations
  (id, slug, name, timezone, route_review_time, general_finalize_time)
VALUES
  ('org-opwp', 'opwp', 'Ohio Pet Waste Pros', 'America/New_York', '06:15', '07:00');

INSERT OR IGNORE INTO route_partner_crm_connections
  (id, organization_id, provider, display_name, mode, capabilities)
VALUES
  ('crm-opwp-sng', 'org-opwp', 'sweep_and_go', 'Sweep & Go', 'read_only',
   '{"routeImport":true,"completionValidation":true,"foodSubscriptions":false,"foodCustomers":false}');

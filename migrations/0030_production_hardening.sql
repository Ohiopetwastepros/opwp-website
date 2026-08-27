-- The two historical 0022 files are intentionally preserved because D1 records
-- applied migrations by filename. All migrations after that collision are unique.

ALTER TABLE route_partner_members ADD COLUMN airtable_identity TEXT;
ALTER TABLE route_partner_members ADD COLUMN route_eligible INTEGER NOT NULL DEFAULT 1 CHECK (route_eligible IN (0, 1));

CREATE TABLE staff_integration_mappings (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL DEFAULT 'org-opwp',
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'technician',
  sng_employee_id TEXT,
  airtable_identity TEXT,
  route_eligible INTEGER NOT NULL DEFAULT 1 CHECK (route_eligible IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, sng_employee_id)
);
INSERT OR IGNORE INTO staff_integration_mappings (id,display_name,role,sng_employee_id,route_eligible,status) VALUES
  ('staff-map-craig-sng','Craig Bridgman','owner','7630',1,'active'),
  ('staff-map-tony-sng','Tony Bridgman','technician','9881',1,'active'),
  ('staff-map-bria-sng','Bria Mahaney','technician','10080',0,'inactive');

CREATE TABLE dog_food_notifications_hardened (
  id TEXT PRIMARY KEY,
  customer_id TEXT REFERENCES dog_food_customers(id),
  order_id TEXT REFERENCES dog_food_orders(id),
  subscription_id TEXT REFERENCES dog_food_subscriptions(id),
  channel TEXT NOT NULL CHECK (channel IN ('email', 'sms')),
  template_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'cancelled')),
  recipient TEXT NOT NULL,
  provider_message_id TEXT,
  error_message TEXT,
  scheduled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sending_at TEXT,
  sent_at TEXT,
  failed_at TEXT,
  cancelled_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO dog_food_notifications_hardened
  (id,customer_id,order_id,subscription_id,channel,template_key,status,recipient,provider_message_id,error_message,scheduled_at,sent_at,created_at)
SELECT id,customer_id,order_id,subscription_id,channel,template_key,status,recipient,provider_message_id,error_message,scheduled_at,sent_at,created_at
FROM dog_food_notifications;
DROP TABLE dog_food_notifications;
ALTER TABLE dog_food_notifications_hardened RENAME TO dog_food_notifications;
CREATE INDEX idx_dog_food_notifications_queue ON dog_food_notifications(status, scheduled_at);

CREATE TABLE route_partner_notification_outbox_hardened (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES route_partner_organizations(id),
  route_plan_id TEXT NOT NULL REFERENCES route_partner_route_plans(id),
  task_id TEXT NOT NULL REFERENCES route_partner_tasks(id),
  notification_type TEXT NOT NULL CHECK (notification_type IN ('on_the_way', 'delivery_exception', 'route_change')),
  recommended_lead_minutes INTEGER,
  selected_lead_minutes INTEGER,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'cancelled')),
  provider_message_id TEXT,
  sending_at TEXT,
  sent_at TEXT,
  failed_at TEXT,
  cancelled_at TEXT,
  error TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO route_partner_notification_outbox_hardened
  (id,organization_id,route_plan_id,task_id,notification_type,recommended_lead_minutes,selected_lead_minutes,message,status,provider_message_id,sent_at,error,created_at)
SELECT id,organization_id,route_plan_id,task_id,notification_type,recommended_lead_minutes,selected_lead_minutes,message,status,provider_message_id,sent_at,error,created_at
FROM route_partner_notification_outbox;
DROP TABLE route_partner_notification_outbox;
ALTER TABLE route_partner_notification_outbox_hardened RENAME TO route_partner_notification_outbox;
CREATE INDEX idx_route_partner_notification_queue ON route_partner_notification_outbox(status, created_at);

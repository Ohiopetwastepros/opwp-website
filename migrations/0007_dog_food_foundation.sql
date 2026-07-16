PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS dog_food_products (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  airtable_record_id TEXT UNIQUE,
  formula_code TEXT NOT NULL,
  color TEXT NOT NULL,
  name TEXT NOT NULL,
  bag_weight_lb INTEGER NOT NULL CHECK (bag_weight_lb IN (20, 40, 50)),
  description TEXT,
  image_path TEXT,
  retail_price_cents INTEGER CHECK (retail_price_cents IS NULL OR retail_price_cents >= 0),
  unit_cost_cents INTEGER CHECK (unit_cost_cents IS NULL OR unit_cost_cents >= 0),
  reorder_point INTEGER CHECK (reorder_point IS NULL OR reorder_point >= 0),
  is_customer_visible INTEGER NOT NULL DEFAULT 0 CHECK (is_customer_visible IN (0, 1)),
  is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dog_food_products_formula_weight
  ON dog_food_products(formula_code, bag_weight_lb);
CREATE INDEX IF NOT EXISTS idx_dog_food_products_active
  ON dog_food_products(is_active, is_customer_visible);

CREATE TABLE IF NOT EXISTS dog_food_customers (
  id TEXT PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  customer_type TEXT NOT NULL DEFAULT 'route_partner'
    CHECK (customer_type IN ('scoop', 'route_partner', 'on_demand')),
  sng_client_id TEXT,
  airtable_record_id TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'inactive')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dog_food_customers_email
  ON dog_food_customers(email);
CREATE INDEX IF NOT EXISTS idx_dog_food_customers_sng_client
  ON dog_food_customers(sng_client_id);

CREATE TABLE IF NOT EXISTS dog_food_addresses (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES dog_food_customers(id),
  line1 TEXT NOT NULL,
  line2 TEXT,
  city TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'OH',
  postal_code TEXT NOT NULL,
  route_zone TEXT,
  route_day TEXT,
  latitude REAL,
  longitude REAL,
  placement_preference TEXT,
  placement_other TEXT,
  is_primary INTEGER NOT NULL DEFAULT 1 CHECK (is_primary IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dog_food_addresses_customer
  ON dog_food_addresses(customer_id);
CREATE INDEX IF NOT EXISTS idx_dog_food_addresses_route
  ON dog_food_addresses(route_zone, route_day);

CREATE TABLE IF NOT EXISTS dog_food_dogs (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES dog_food_customers(id),
  name TEXT,
  weight_lb REAL NOT NULL CHECK (weight_lb > 0),
  age_years REAL CHECK (age_years IS NULL OR age_years >= 0),
  life_stage TEXT,
  activity_level TEXT,
  body_condition TEXT,
  sensitivities TEXT,
  current_food TEXT,
  cups_per_day REAL CHECK (cups_per_day IS NULL OR cups_per_day > 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dog_food_dogs_customer
  ON dog_food_dogs(customer_id, is_active);

CREATE TABLE IF NOT EXISTS dog_food_recommendations (
  id TEXT PRIMARY KEY,
  dog_id TEXT NOT NULL REFERENCES dog_food_dogs(id),
  product_id TEXT NOT NULL REFERENCES dog_food_products(id),
  recommended_cups_per_day REAL,
  recommended_bag_weight_lb INTEGER CHECK (recommended_bag_weight_lb IN (20, 40)),
  estimated_days_per_bag REAL,
  explanation TEXT,
  rules_version TEXT NOT NULL,
  accepted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dog_food_recommendations_dog
  ON dog_food_recommendations(dog_id, created_at DESC);

CREATE TABLE IF NOT EXISTS dog_food_orders (
  id TEXT PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  customer_id TEXT NOT NULL REFERENCES dog_food_customers(id),
  address_id TEXT NOT NULL REFERENCES dog_food_addresses(id),
  order_type TEXT NOT NULL CHECK (order_type IN ('subscription', 'on_demand')),
  status TEXT NOT NULL DEFAULT 'pending_payment'
    CHECK (status IN ('draft', 'pending_payment', 'paid', 'scheduled', 'fulfilled', 'cancelled', 'payment_failed', 'refunded')),
  subtotal_cents INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  delivery_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK (delivery_fee_cents >= 0),
  tax_rate_basis_points INTEGER NOT NULL DEFAULT 775 CHECK (tax_rate_basis_points >= 0),
  tax_cents INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  requested_delivery_speed TEXT
    CHECK (requested_delivery_speed IS NULL OR requested_delivery_speed IN ('route_day', 'next_day', 'same_day')),
  source TEXT NOT NULL DEFAULT 'website',
  notes TEXT,
  placed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dog_food_orders_customer
  ON dog_food_orders(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dog_food_orders_status
  ON dog_food_orders(status, created_at);

CREATE TABLE IF NOT EXISTS dog_food_order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES dog_food_orders(id),
  product_id TEXT NOT NULL REFERENCES dog_food_products(id),
  dog_id TEXT REFERENCES dog_food_dogs(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  line_total_cents INTEGER NOT NULL CHECK (line_total_cents >= 0),
  substitution_product_id TEXT REFERENCES dog_food_products(id),
  substitution_policy TEXT NOT NULL DEFAULT 'same_formula_weight'
    CHECK (substitution_policy IN ('none', 'same_formula_weight', 'preauthorized_alternate')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dog_food_order_items_order
  ON dog_food_order_items(order_id);

CREATE TABLE IF NOT EXISTS dog_food_subscriptions (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES dog_food_customers(id),
  address_id TEXT NOT NULL REFERENCES dog_food_addresses(id),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'past_due', 'cancelled')),
  frequency_weeks INTEGER NOT NULL DEFAULT 4 CHECK (frequency_weeks > 0),
  next_charge_at TEXT NOT NULL,
  next_delivery_date TEXT NOT NULL,
  payment_method_token TEXT,
  card_brand TEXT,
  card_last_four TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dog_food_subscriptions_due
  ON dog_food_subscriptions(status, next_charge_at);

CREATE TABLE IF NOT EXISTS dog_food_subscription_items (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES dog_food_subscriptions(id),
  product_id TEXT NOT NULL REFERENCES dog_food_products(id),
  dog_id TEXT REFERENCES dog_food_dogs(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  substitution_product_id TEXT REFERENCES dog_food_products(id),
  substitution_policy TEXT NOT NULL DEFAULT 'same_formula_weight'
    CHECK (substitution_policy IN ('none', 'same_formula_weight', 'preauthorized_alternate')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dog_food_subscription_items_subscription
  ON dog_food_subscription_items(subscription_id, is_active);

CREATE TABLE IF NOT EXISTS dog_food_payments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES dog_food_orders(id),
  subscription_id TEXT REFERENCES dog_food_subscriptions(id),
  provider TEXT NOT NULL DEFAULT 'cardpointe',
  provider_transaction_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  status TEXT NOT NULL
    CHECK (status IN ('pending', 'authorized', 'captured', 'failed', 'voided', 'refunded')),
  failure_code TEXT,
  failure_message TEXT,
  processed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dog_food_payments_order
  ON dog_food_payments(order_id, created_at DESC);

CREATE TABLE IF NOT EXISTS dog_food_inventory_locations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  location_type TEXT NOT NULL DEFAULT 'warehouse'
    CHECK (location_type IN ('warehouse', 'vehicle', 'partner')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dog_food_inventory_movements (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES dog_food_products(id),
  location_id TEXT NOT NULL REFERENCES dog_food_inventory_locations(id),
  movement_type TEXT NOT NULL
    CHECK (movement_type IN ('opening_count', 'purchase_receipt', 'sale', 'adjustment', 'transfer_in', 'transfer_out', 'return', 'damage')),
  quantity_delta INTEGER NOT NULL CHECK (quantity_delta <> 0),
  unit_cost_cents INTEGER CHECK (unit_cost_cents IS NULL OR unit_cost_cents >= 0),
  reference_type TEXT,
  reference_id TEXT,
  notes TEXT,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dog_food_inventory_movements_balance
  ON dog_food_inventory_movements(product_id, location_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_dog_food_inventory_movements_reference
  ON dog_food_inventory_movements(reference_type, reference_id);

CREATE VIEW IF NOT EXISTS dog_food_inventory_balances AS
SELECT
  product_id,
  location_id,
  COALESCE(SUM(quantity_delta), 0) AS quantity_on_hand,
  MAX(occurred_at) AS last_movement_at
FROM dog_food_inventory_movements
GROUP BY product_id, location_id;

CREATE TABLE IF NOT EXISTS dog_food_suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  pickup_address TEXT,
  lead_time_days INTEGER CHECK (lead_time_days IS NULL OR lead_time_days >= 0),
  minimum_order_bags INTEGER CHECK (minimum_order_bags IS NULL OR minimum_order_bags >= 0),
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dog_food_purchase_orders (
  id TEXT PRIMARY KEY,
  po_number TEXT NOT NULL UNIQUE,
  supplier_id TEXT NOT NULL REFERENCES dog_food_suppliers(id),
  destination_location_id TEXT NOT NULL REFERENCES dog_food_inventory_locations(id),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'ready_for_pickup', 'partially_received', 'received', 'cancelled')),
  ordered_at TEXT,
  expected_at TEXT,
  received_at TEXT,
  pickup_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (pickup_cost_cents >= 0),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dog_food_purchase_orders_status
  ON dog_food_purchase_orders(status, expected_at);

CREATE TABLE IF NOT EXISTS dog_food_purchase_order_items (
  id TEXT PRIMARY KEY,
  purchase_order_id TEXT NOT NULL REFERENCES dog_food_purchase_orders(id),
  product_id TEXT NOT NULL REFERENCES dog_food_products(id),
  quantity_ordered INTEGER NOT NULL CHECK (quantity_ordered > 0),
  quantity_received INTEGER NOT NULL DEFAULT 0 CHECK (quantity_received >= 0),
  unit_cost_cents INTEGER NOT NULL CHECK (unit_cost_cents >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (purchase_order_id, product_id)
);

CREATE TABLE IF NOT EXISTS dog_food_deliveries (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE REFERENCES dog_food_orders(id),
  customer_id TEXT NOT NULL REFERENCES dog_food_customers(id),
  address_id TEXT NOT NULL REFERENCES dog_food_addresses(id),
  scheduled_date TEXT NOT NULL,
  delivery_window TEXT,
  delivery_type TEXT NOT NULL
    CHECK (delivery_type IN ('scoop_route', 'route_partner', 'on_demand')),
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'assigned', 'out_for_delivery', 'delivered', 'failed', 'cancelled')),
  sng_job_id TEXT,
  technician_id TEXT,
  route_id TEXT,
  route_sequence INTEGER,
  proof_photo_url TEXT,
  placement_note TEXT,
  delivered_at TEXT,
  failure_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dog_food_deliveries_manifest
  ON dog_food_deliveries(scheduled_date, technician_id, route_sequence);
CREATE INDEX IF NOT EXISTS idx_dog_food_deliveries_status
  ON dog_food_deliveries(status, scheduled_date);

CREATE TABLE IF NOT EXISTS dog_food_route_snapshots (
  id TEXT PRIMARY KEY,
  service_date TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'sweep_and_go',
  technician_id TEXT,
  route_id TEXT,
  source_payload TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dog_food_route_snapshots_date
  ON dog_food_route_snapshots(service_date, technician_id);

CREATE TABLE IF NOT EXISTS dog_food_notifications (
  id TEXT PRIMARY KEY,
  customer_id TEXT REFERENCES dog_food_customers(id),
  order_id TEXT REFERENCES dog_food_orders(id),
  subscription_id TEXT REFERENCES dog_food_subscriptions(id),
  channel TEXT NOT NULL CHECK (channel IN ('email', 'sms')),
  template_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sent', 'failed', 'cancelled')),
  recipient TEXT NOT NULL,
  provider_message_id TEXT,
  error_message TEXT,
  scheduled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dog_food_notifications_queue
  ON dog_food_notifications(status, scheduled_at);

INSERT OR IGNORE INTO dog_food_inventory_locations (id, name, location_type)
VALUES ('opwp-main', 'OPWP Main Inventory', 'warehouse');

INSERT OR IGNORE INTO dog_food_products
  (id, sku, formula_code, color, name, bag_weight_lb, description, image_path, retail_price_cents, is_customer_visible, is_active)
VALUES
  ('edf-22-12-pink-40', 'EDF-22-12-PINK-40', '22-12', 'Pink', 'Chicken and Brown Rice', 40, 'For less-active and senior dogs.', '/assets/edf/22-12.png', 6000, 1, 1),
  ('edf-26-14-blue-40', 'EDF-26-14-BLUE-40', '26-14', 'Blue', 'For Puppies and Active Dogs', 40, 'For puppies and active dogs.', '/assets/edf/26-14.png', 6000, 1, 1),
  ('edf-26-18-green-40', 'EDF-26-18-GREEN-40', '26-18', 'Green', 'Active Dogs', 40, 'For active dogs with joint, skin, and coat support.', '/assets/edf/26-18.png', 6000, 1, 1),
  ('edf-30-20-red-40', 'EDF-30-20-RED-40', '30-20', 'Red', 'Pro Athlete', 40, 'For high-energy and working dogs.', '/assets/edf/30-20.png', 6000, 1, 1),
  ('edf-22-12-pink-20', 'EDF-22-12-PINK-20', '22-12', 'Pink', 'Chicken and Brown Rice', 20, 'For less-active and senior dogs.', '/assets/edf/22-12.png', NULL, 0, 0),
  ('edf-26-14-blue-20', 'EDF-26-14-BLUE-20', '26-14', 'Blue', 'For Puppies and Active Dogs', 20, 'For puppies and active dogs.', '/assets/edf/26-14.png', NULL, 0, 0),
  ('edf-26-18-green-20', 'EDF-26-18-GREEN-20', '26-18', 'Green', 'Active Dogs', 20, 'For active dogs with joint, skin, and coat support.', '/assets/edf/26-18.png', NULL, 0, 0),
  ('edf-30-20-red-20', 'EDF-30-20-RED-20', '30-20', 'Red', 'Pro Athlete', 20, 'For high-energy and working dogs.', '/assets/edf/30-20.png', NULL, 0, 0);

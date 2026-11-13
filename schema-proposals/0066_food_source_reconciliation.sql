-- PROPOSAL ONLY: source reconciliation is internal only; no provider charges or writes.
CREATE TABLE dog_food_launch_readiness (
  id TEXT PRIMARY KEY CHECK(id='org-opwp'), public_ordering_enabled INTEGER NOT NULL DEFAULT 0 CHECK(public_ordering_enabled IN(0,1)),
  inventory_opening_verified_at TEXT, sources_reviewed_at TEXT, checkout_test_verified_at TEXT,
  saved_card_test_verified_at TEXT, email_verified_at TEXT, security_reviewed_source_hash TEXT,
  approved_by TEXT, approved_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO dog_food_launch_readiness(id) VALUES('org-opwp');
CREATE TABLE dog_food_source_customer_links (
  provider TEXT NOT NULL CHECK(provider IN('sweep_and_go','stripe')), external_id TEXT NOT NULL,
  customer_id TEXT NOT NULL REFERENCES dog_food_customers(id), evidence TEXT NOT NULL CHECK(json_valid(evidence)),
  linked_by TEXT NOT NULL, linked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(provider,external_id)
);
CREATE TABLE dog_food_source_line_reviews (
  provider TEXT NOT NULL CHECK(provider='sweep_and_go'), document_id TEXT NOT NULL, line_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN('confirmed','linked','excluded')),
  source_hash TEXT NOT NULL, source_snapshot TEXT NOT NULL CHECK(json_valid(source_snapshot)),
  customer_id TEXT REFERENCES dog_food_customers(id), product_id TEXT REFERENCES dog_food_products(id),
  linked_sale_id TEXT, fulfillment_state TEXT NOT NULL DEFAULT 'unknown' CHECK(fulfillment_state IN('unknown','delivery_pending','pickup_pending','complete')),
  note TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, reviewed_by TEXT NOT NULL,
  reviewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(provider,document_id,line_id)
);
CREATE UNIQUE INDEX idx_food_source_sale_link ON dog_food_source_line_reviews(linked_sale_id) WHERE linked_sale_id IS NOT NULL AND status='linked';
CREATE TABLE dog_food_source_movements (
  id TEXT PRIMARY KEY, command_id TEXT NOT NULL UNIQUE, provider TEXT NOT NULL, document_id TEXT NOT NULL, line_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity>0), occurred_on TEXT NOT NULL, handoff TEXT NOT NULL CHECK(handoff IN('delivery','pickup')),
  evidence TEXT NOT NULL, recorded_by TEXT NOT NULL, recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(provider,document_id,line_id) REFERENCES dog_food_source_line_reviews(provider,document_id,line_id)
);
CREATE TABLE dog_food_external_stripe_reviews (
  payment_intent_id TEXT PRIMARY KEY, stripe_customer_id TEXT, currency TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK(amount_cents>=0), refunded_cents INTEGER NOT NULL DEFAULT 0 CHECK(refunded_cents>=0),
  livemode INTEGER NOT NULL CHECK(livemode IN(0,1)), provider_status TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unmatched' CHECK(status IN('unmatched','linked','excluded','conflict')),
  order_id TEXT REFERENCES dog_food_orders(id), payment_id TEXT REFERENCES dog_food_payments(id),
  source_event_id TEXT NOT NULL, evidence TEXT NOT NULL CHECK(json_valid(evidence)),
  note TEXT, reviewed_by TEXT, reviewed_at TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE dog_food_source_review_events (
  id TEXT PRIMARY KEY, command_id TEXT NOT NULL UNIQUE, actor TEXT NOT NULL, action TEXT NOT NULL,
  source_key TEXT NOT NULL, before_state TEXT CHECK(before_state IS NULL OR json_valid(before_state)),
  after_state TEXT NOT NULL CHECK(json_valid(after_state)), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER food_source_review_events_no_update BEFORE UPDATE ON dog_food_source_review_events BEGIN SELECT RAISE(ABORT,'Source review history is retained'); END;
CREATE TRIGGER food_source_review_events_no_delete BEFORE DELETE ON dog_food_source_review_events BEGIN SELECT RAISE(ABORT,'Source review history is retained'); END;
CREATE TRIGGER food_source_movements_no_update BEFORE UPDATE ON dog_food_source_movements BEGIN SELECT RAISE(ABORT,'Physical evidence is retained'); END;
CREATE TRIGGER food_source_movements_no_delete BEFORE DELETE ON dog_food_source_movements BEGIN SELECT RAISE(ABORT,'Physical evidence is retained'); END;

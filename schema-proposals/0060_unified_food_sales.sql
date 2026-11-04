-- PROPOSAL ONLY. No historical data. Not a production migration archive member.
-- Review against the deployed schema and separately authorize application.
PRAGMA foreign_keys=ON;

CREATE TABLE dog_food_sales_settings (
  id TEXT PRIMARY KEY CHECK(id='org-opwp'), enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN(0,1)),
  pricing_policy TEXT CHECK(pricing_policy='catalog_lucas_775'), approved_by TEXT, approved_at TEXT,
  sng_enabled INTEGER NOT NULL DEFAULT 0 CHECK(sng_enabled IN(0,1)),
  projection_enabled INTEGER NOT NULL DEFAULT 0 CHECK(projection_enabled IN(0,1)),
  CHECK(enabled=0 OR (pricing_policy IS NOT NULL AND length(approved_by)>0 AND approved_at IS NOT NULL))
);
INSERT INTO dog_food_sales_settings(id) VALUES('org-opwp');
CREATE TABLE dog_food_sales_grants (
  member_id TEXT PRIMARY KEY REFERENCES route_partner_members(id), organization_id TEXT NOT NULL CHECK(organization_id='org-opwp'),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN(0,1)), revision INTEGER NOT NULL DEFAULT 1,
  approved_by TEXT NOT NULL, approved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE dog_food_sales_sessions (
  id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES route_partner_members(id), token_hash TEXT NOT NULL UNIQUE,
  grant_revision INTEGER NOT NULL, credential_version INTEGER NOT NULL,
  expires_at TEXT NOT NULL, last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, revoked_at TEXT
);
CREATE INDEX idx_food_sales_session_member ON dog_food_sales_sessions(member_id);
CREATE TABLE dog_food_sales_credentials (
  member_id TEXT PRIMARY KEY REFERENCES route_partner_members(id), password_hash TEXT,
  password_version INTEGER NOT NULL DEFAULT 1, failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT, last_login_at TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE dog_food_sales_invitations (
  token_hash TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES route_partner_members(id),
  credential_version INTEGER NOT NULL, expires_at TEXT NOT NULL, used_at TEXT,
  issued_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE dog_food_sales_commands (
  id TEXT PRIMARY KEY, actor TEXT NOT NULL, payload_hash TEXT NOT NULL, result TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE dog_food_sales_write_guards(id TEXT PRIMARY KEY,valid INTEGER NOT NULL CHECK(valid=1));
CREATE TABLE dog_food_sales_order_metadata (
  order_id TEXT PRIMARY KEY REFERENCES dog_food_orders(id), recorded_by TEXT NOT NULL,
  billing_provider TEXT NOT NULL CHECK(billing_provider IN('manual','sweep_and_go')),
  pricing_policy TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE dog_food_sales_payment_evidence (
  payment_id TEXT PRIMARY KEY REFERENCES dog_food_payments(id), actor TEXT NOT NULL,
  method TEXT NOT NULL CHECK(method IN('cash','check','venmo','sweep_and_go')),
  reference TEXT, received_at TEXT NOT NULL, source_event_id TEXT, evidence TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE dog_food_sales_review (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN('correction','sng','migration')),
  order_id TEXT REFERENCES dog_food_orders(id), source_key TEXT NOT NULL UNIQUE, actor TEXT NOT NULL,
  reason TEXT NOT NULL, evidence TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','resolved','dismissed')),
  office_note TEXT, reviewed_by TEXT, reviewed_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE dog_food_sales_external_links (
  provider TEXT NOT NULL CHECK(provider='sweep_and_go'), entity_type TEXT NOT NULL CHECK(entity_type IN('invoice','line','payment','job','customer')),
  external_id TEXT NOT NULL, order_id TEXT REFERENCES dog_food_orders(id), payment_id TEXT REFERENCES dog_food_payments(id),
  customer_id TEXT REFERENCES dog_food_customers(id), evidence TEXT NOT NULL, linked_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(provider,entity_type,external_id)
);
CREATE TABLE dog_food_sales_sng_events (
  event_id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, evidence TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'review' CHECK(status IN('review','linked')), result TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE dog_food_sales_handoffs (
  order_id TEXT PRIMARY KEY REFERENCES dog_food_orders(id), actor TEXT NOT NULL, received_by TEXT NOT NULL,
  method TEXT NOT NULL CHECK(method IN('pickup','delivery')), completed_at TEXT NOT NULL, local_date TEXT NOT NULL,
  note TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE dog_food_sales_refunds (
  id TEXT PRIMARY KEY, payment_id TEXT NOT NULL REFERENCES dog_food_payments(id), amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
  reference TEXT NOT NULL UNIQUE, actor TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE dog_food_sales_returns (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES dog_food_orders(id), lot_id TEXT NOT NULL REFERENCES dog_food_stock_lots(id),
  quantity INTEGER NOT NULL CHECK(quantity>0), reference TEXT NOT NULL UNIQUE, actor TEXT NOT NULL, reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Multiple recorded receipts may coexist; electronic checkout retains one capture.
DROP INDEX idx_food_one_capture;
CREATE UNIQUE INDEX idx_food_one_capture ON dog_food_payments(order_id)
  WHERE status='captured' AND provider NOT IN('staff_cash','staff_check','staff_venmo','sng_verified');
CREATE TRIGGER food_receipt_balance_guard BEFORE INSERT ON dog_food_payments WHEN NEW.status='captured' BEGIN
  SELECT RAISE(ABORT,'Receipt exceeds remaining balance') WHERE NEW.amount_cents<=0 OR
    NEW.amount_cents+COALESCE((SELECT SUM(amount_cents-CASE WHEN (SELECT source FROM dog_food_orders WHERE id=NEW.order_id)='staff_sales' THEN 0 ELSE refunded_amount_cents END) FROM dog_food_payments
    WHERE order_id=NEW.order_id AND status IN('captured','refunded')),0)>(SELECT total_cents FROM dog_food_orders WHERE id=NEW.order_id);
END;
CREATE TRIGGER food_receipt_update_guard BEFORE UPDATE OF amount_cents,order_id,provider,provider_transaction_id,idempotency_key ON dog_food_payments
WHEN EXISTS(SELECT 1 FROM dog_food_sales_payment_evidence WHERE payment_id=OLD.id) BEGIN
  SELECT RAISE(ABORT,'Recorded receipts are immutable; request office correction');
END;
CREATE TRIGGER food_sales_receipt_no_delete BEFORE DELETE ON dog_food_payments
WHEN EXISTS(SELECT 1 FROM dog_food_sales_payment_evidence WHERE payment_id=OLD.id) BEGIN
  SELECT RAISE(ABORT,'Recorded receipts cannot be deleted');
END;
CREATE TRIGGER food_sales_price_lock BEFORE UPDATE OF total_cents,subtotal_cents,tax_cents,tax_rate_basis_points,customer_id,address_id,fulfillment_method ON dog_food_orders
WHEN EXISTS(SELECT 1 FROM dog_food_sales_order_metadata WHERE order_id=OLD.id) BEGIN
  SELECT RAISE(ABORT,'Staff sale history is locked; request office correction');
END;
CREATE TRIGGER food_sales_line_lock BEFORE UPDATE ON dog_food_order_items
WHEN EXISTS(SELECT 1 FROM dog_food_sales_order_metadata WHERE order_id=OLD.order_id) BEGIN
  SELECT RAISE(ABORT,'Staff sale prices are historical');
END;
CREATE TRIGGER food_sales_line_no_delete BEFORE DELETE ON dog_food_order_items
WHEN EXISTS(SELECT 1 FROM dog_food_sales_order_metadata WHERE order_id=OLD.order_id) BEGIN
  SELECT RAISE(ABORT,'Staff sale lines are retained');
END;

-- A recorded staff handoff is distinct evidence from the driver's private photo.
-- Existing online/driver paths retain their payment and proof requirements.
DROP TRIGGER food_delivery_completion_guard;
CREATE TRIGGER food_delivery_completion_guard BEFORE UPDATE OF status ON dog_food_deliveries
WHEN NEW.status='delivered' AND OLD.status<>'delivered' BEGIN
  SELECT RAISE(ABORT,'Actual delivery evidence required') WHERE NOT EXISTS(
    SELECT 1 FROM dog_food_sales_handoffs h JOIN dog_food_sales_order_metadata m ON m.order_id=h.order_id
    JOIN dog_food_orders o ON o.id=m.order_id WHERE h.order_id=NEW.order_id AND h.method='delivery'
    AND o.source='staff_sales' AND o.deleted_at IS NULL AND o.status NOT IN('cancelled','refunded') AND NEW.delivered_at=h.completed_at
  ) AND (NOT EXISTS(SELECT 1 FROM dog_food_orders o JOIN dog_food_payments p ON p.order_id=o.id
    WHERE o.id=NEW.order_id AND o.deleted_at IS NULL AND o.status NOT IN('cancelled','refunded') AND p.status='captured')
    OR NEW.proof_photo_url IS NULL OR NEW.delivered_at IS NULL OR NOT EXISTS(
      SELECT 1 FROM route_partner_field_proofs p JOIN route_partner_tasks t ON t.id=p.task_id
      WHERE t.dog_food_delivery_id=NEW.id AND p.organization_id='org-opwp' AND t.organization_id='org-opwp'
      AND NEW.proof_photo_url='/api/field/photo/'||p.id||'/'));
END;
DROP TRIGGER food_pickup_insert_guard;
CREATE TRIGGER food_pickup_insert_guard BEFORE INSERT ON dog_food_pickups BEGIN
  SELECT RAISE(ABORT,'Authorized pickup order required') WHERE NEW.status<>'ready' OR NOT EXISTS(
    SELECT 1 FROM dog_food_orders o WHERE o.id=NEW.order_id AND o.fulfillment_method='pickup' AND o.deleted_at IS NULL
    AND o.status NOT IN('cancelled','refunded') AND (EXISTS(SELECT 1 FROM dog_food_sales_order_metadata m WHERE m.order_id=o.id AND o.source='staff_sales')
    OR (o.status IN('paid','scheduled') AND EXISTS(SELECT 1 FROM dog_food_payments p WHERE p.order_id=o.id AND p.status='captured'))));
END;
DROP TRIGGER food_pickup_collect_guard;
CREATE TRIGGER food_pickup_collect_guard BEFORE UPDATE OF status ON dog_food_pickups WHEN NEW.status='collected' AND OLD.status<>'collected' BEGIN
  SELECT RAISE(ABORT,'Actual pickup and valid allocated bags required') WHERE OLD.status<>'ready' OR NEW.collected_at IS NULL
    OR length(trim(COALESCE(NEW.collected_by,'')))=0 OR length(trim(COALESCE(NEW.received_by,'')))=0
    OR NOT EXISTS(SELECT 1 FROM dog_food_orders o WHERE o.id=NEW.order_id AND o.fulfillment_method='pickup' AND o.deleted_at IS NULL
      AND o.status NOT IN('cancelled','refunded') AND (EXISTS(SELECT 1 FROM dog_food_sales_handoffs h JOIN dog_food_sales_order_metadata m ON m.order_id=h.order_id
        WHERE h.order_id=o.id AND h.method='pickup' AND o.source='staff_sales' AND NEW.collected_at=h.completed_at)
      OR (o.status IN('paid','scheduled') AND EXISTS(SELECT 1 FROM dog_food_payments p WHERE p.order_id=o.id AND p.status='captured'))))
    OR EXISTS(SELECT 1 FROM dog_food_order_items i WHERE i.order_id=NEW.order_id AND i.quantity<>COALESCE((SELECT SUM(a.quantity)
      FROM dog_food_lot_allocations a JOIN dog_food_stock_lots l ON l.id=a.lot_id WHERE a.order_id=i.order_id AND l.product_id=i.product_id
      AND a.released_at IS NULL AND a.consumed_at IS NULL AND l.best_before>=COALESCE((SELECT local_date FROM dog_food_sales_handoffs WHERE order_id=NEW.order_id),substr(NEW.collected_at,1,10)) AND l.quarantined=0 AND l.expiry_assumed=0),0));
END;
-- Do not announce a partial receipt as paid. No customer messages for staff sales.
DROP TRIGGER food_paid_email;
CREATE TRIGGER food_paid_email AFTER INSERT ON dog_food_payments WHEN NEW.status='captured' BEGIN
  INSERT OR IGNORE INTO dog_food_transactional_outbox(event_key,customer_id,order_id,template)
    SELECT 'paid:'||o.id,o.customer_id,o.id,'paid' FROM dog_food_orders o WHERE o.id=NEW.order_id AND o.source<>'staff_sales'
    AND (SELECT SUM(amount_cents-refunded_amount_cents) FROM dog_food_payments WHERE order_id=o.id AND status IN('captured','refunded'))>=o.total_cents;
END;
CREATE TRIGGER food_staff_messages_suppress AFTER INSERT ON dog_food_transactional_outbox
WHEN EXISTS(SELECT 1 FROM dog_food_orders WHERE id=NEW.order_id AND source='staff_sales') BEGIN
  UPDATE dog_food_transactional_outbox SET status='cancelled' WHERE event_key=NEW.event_key;
END;
-- Initial inserts must be projected as well as later payment changes.
CREATE TRIGGER food_sales_receipt_order AFTER INSERT ON dog_food_payments BEGIN
  INSERT INTO dog_food_sync_outbox(entity_key,kind,entity_id) VALUES('order:'||NEW.order_id,'order',NEW.order_id)
    ON CONFLICT(entity_key) DO UPDATE SET revision=revision+1,attempts=0,next_attempt_at=CURRENT_TIMESTAMP;
END;
CREATE TRIGGER food_sales_handoff_no_update BEFORE UPDATE ON dog_food_sales_handoffs BEGIN SELECT RAISE(ABORT,'Handoff evidence is immutable'); END;
CREATE TRIGGER food_sales_handoff_no_delete BEFORE DELETE ON dog_food_sales_handoffs BEGIN SELECT RAISE(ABORT,'Handoff evidence is retained'); END;
CREATE TRIGGER food_sales_evidence_no_update BEFORE UPDATE ON dog_food_sales_payment_evidence BEGIN SELECT RAISE(ABORT,'Payment evidence is immutable'); END;
CREATE TRIGGER food_sales_evidence_no_delete BEFORE DELETE ON dog_food_sales_payment_evidence BEGIN SELECT RAISE(ABORT,'Payment evidence is retained'); END;
CREATE TRIGGER food_staff_delivery_lots BEFORE UPDATE OF status ON dog_food_deliveries
WHEN NEW.status='delivered' AND OLD.status<>'delivered' AND EXISTS(SELECT 1 FROM dog_food_sales_order_metadata WHERE order_id=NEW.order_id) BEGIN
  SELECT RAISE(ABORT,'Staff delivery requires valid allocated bags') WHERE EXISTS(
    SELECT 1 FROM dog_food_order_items i WHERE i.order_id=NEW.order_id AND i.quantity<>COALESCE((SELECT SUM(a.quantity)
      FROM dog_food_lot_allocations a JOIN dog_food_stock_lots l ON l.id=a.lot_id WHERE a.order_id=i.order_id AND l.product_id=i.product_id
      AND a.released_at IS NULL AND a.consumed_at IS NULL AND l.best_before>=COALESCE((SELECT local_date FROM dog_food_sales_handoffs WHERE order_id=NEW.order_id),substr(NEW.delivered_at,1,10)) AND l.quarantined=0 AND l.expiry_assumed=0),0));
END;

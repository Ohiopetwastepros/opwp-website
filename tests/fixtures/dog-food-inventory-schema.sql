-- Synthetic test database only. Never apply to production.
CREATE TABLE dog_food_cost_annotations (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL DEFAULT 'org-opwp' CHECK(organization_id='org-opwp'),
  product_id TEXT NOT NULL, category TEXT NOT NULL CHECK(category IN ('personal_family','animal_damage','expiration','other')),
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 100000), unit_cost_cents INTEGER CHECK(unit_cost_cents BETWEEN 0 AND 100000000),
  actual_date TEXT, checkpoint_id TEXT, movement_id TEXT,
  source_reference TEXT NOT NULL, note TEXT NOT NULL, actor TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'confirmed' CHECK(review_status IN ('confirmed','needs_review')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK((checkpoint_id IS NOT NULL AND movement_id IS NULL) OR (movement_id IS NOT NULL AND checkpoint_id IS NULL)),
  UNIQUE(organization_id,source_reference)
);

CREATE UNIQUE INDEX idx_food_cost_movement ON dog_food_cost_annotations(movement_id) WHERE movement_id IS NOT NULL;

CREATE TRIGGER food_cost_no_update BEFORE UPDATE ON dog_food_cost_annotations BEGIN   SELECT RAISE(ABORT,'Cost annotations are immutable. Retain the evidence and add a reviewed reversal');

END;

CREATE TRIGGER food_cost_no_delete BEFORE DELETE ON dog_food_cost_annotations BEGIN   SELECT RAISE(ABORT,'Cost annotations are immutable');

END;

INSERT INTO dog_food_cost_annotations(id,product_id,category,quantity,unit_cost_cents,checkpoint_id,source_reference,note,actor)
VALUES ('fixture-value-001','rec00000000000002','personal_family',3,4000,'rec00000000000003',
 'fixture-value-004',
 'Synthetic fixture annotation; no real customer or operational history.', 'fixture-value-006');

INSERT INTO dog_food_cost_annotations(id,product_id,category,quantity,unit_cost_cents,actual_date,movement_id,source_reference,note,actor,review_status)
VALUES ('fixture-value-007','rec00000000000002','personal_family',2,4000,'2026-03-15','rec00000000000008',
 'fixture-value-009',
 'Synthetic fixture annotation; no real customer or operational history.', 'fixture-value-006','needs_review');

ALTER TABLE dog_food_stock_lots ADD COLUMN supplier TEXT;

ALTER TABLE dog_food_stock_lots ADD COLUMN purchase_date TEXT;

ALTER TABLE dog_food_stock_lots ADD COLUMN received_date TEXT;

ALTER TABLE dog_food_stock_lots ADD COLUMN unit_cost_cents INTEGER CHECK(unit_cost_cents>=0);

ALTER TABLE dog_food_stock_lots ADD COLUMN source_reference TEXT;

ALTER TABLE dog_food_stock_lots ADD COLUMN quarantined INTEGER NOT NULL DEFAULT 0 CHECK(quarantined IN (0,1));

ALTER TABLE dog_food_stock_lots ADD COLUMN expiry_assumed INTEGER NOT NULL DEFAULT 0 CHECK(expiry_assumed IN (0,1));

CREATE TRIGGER food_lot_allocation_sellable BEFORE INSERT ON dog_food_lot_allocations BEGIN   SELECT RAISE(ABORT,'Insufficient confirmed sellable lot stock') WHERE NOT EXISTS(SELECT 1 FROM dog_food_stock_lots l WHERE l.id=NEW.lot_id AND l.quarantined=0 AND l.expiry_assumed=0     AND l.usable_bags-COALESCE((SELECT SUM(a.quantity) FROM dog_food_lot_allocations a WHERE a.lot_id=l.id AND a.consumed_at IS NULL AND a.released_at IS NULL),0)>=NEW.quantity);

END;

CREATE TRIGGER food_lot_quarantine_allocated BEFORE UPDATE OF quarantined,expiry_assumed ON dog_food_stock_lots WHEN (NEW.quarantined=1 OR NEW.expiry_assumed=1) AND EXISTS(SELECT 1 FROM dog_food_lot_allocations a WHERE a.lot_id=NEW.id AND a.consumed_at IS NULL AND a.released_at IS NULL) BEGIN SELECT RAISE(ABORT,'Review allocated orders before quarantining this lot');

END;

INSERT INTO dog_food_ops_audit(id,actor,action,entity_id,details) VALUES
 ('fixture-value-011','fixture-value-006','cost_evidence','fixture-value-001',
 '{"source":"synthetic fixture","note":"Synthetic cost evidence."}');

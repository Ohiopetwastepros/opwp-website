-- PROPOSAL ONLY. Production application requires separate owner approval.
-- Staff sales may use owner-confirmed shared counts without inventing lot/expiry data.
ALTER TABLE dog_food_sales_settings ADD COLUMN stock_basis TEXT NOT NULL DEFAULT 'lots' CHECK(stock_basis IN('lots','confirmed_count'));
ALTER TABLE dog_food_sales_order_metadata ADD COLUMN stock_basis TEXT NOT NULL DEFAULT 'lots' CHECK(stock_basis IN('lots','confirmed_count'));
-- Contacts with unknown email remain blank; real emails retain their existing uniqueness.
DROP INDEX idx_dog_food_customers_email;
CREATE UNIQUE INDEX idx_dog_food_customers_email ON dog_food_customers(email) WHERE email<>'';
CREATE TABLE dog_food_sales_customer_sources (
  source_table TEXT NOT NULL CHECK(source_table IN('Customers','Sales')), source_record_id TEXT NOT NULL,
  customer_id TEXT NOT NULL REFERENCES dog_food_customers(id), source_hash TEXT NOT NULL,
  imported_by TEXT NOT NULL, imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(source_table,source_record_id)
);
CREATE INDEX idx_food_sales_customer_sources_customer ON dog_food_sales_customer_sources(customer_id);
CREATE TABLE dog_food_sales_count_allocations (
  order_id TEXT NOT NULL REFERENCES dog_food_orders(id), product_id TEXT NOT NULL REFERENCES dog_food_products(id),
  quantity INTEGER NOT NULL CHECK(quantity>0), available_before INTEGER NOT NULL CHECK(available_before>=quantity),
  source_snapshot_id TEXT NOT NULL REFERENCES dog_food_ops_snapshots(id), count_reference TEXT NOT NULL, count_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(order_id,product_id)
);
CREATE TRIGGER food_sales_count_allocation_guard BEFORE INSERT ON dog_food_sales_count_allocations BEGIN
  SELECT RAISE(ABORT,'Confirmed-count allocation requires exact staff order lines and current source') WHERE NOT EXISTS(
    SELECT 1 FROM dog_food_orders o JOIN dog_food_sales_order_metadata m ON m.order_id=o.id
    JOIN dog_food_order_items i ON i.order_id=o.id AND i.product_id=NEW.product_id
    JOIN dog_food_ops_state s ON s.id='org-opwp' AND s.snapshot_id=NEW.source_snapshot_id
    WHERE o.id=NEW.order_id AND o.source='staff_sales' AND m.stock_basis='confirmed_count' AND i.quantity=NEW.quantity
    AND s.command_token IS NOT NULL AND s.command_until>CURRENT_TIMESTAMP);
END;
CREATE TRIGGER food_sales_count_allocation_no_update BEFORE UPDATE ON dog_food_sales_count_allocations BEGIN SELECT RAISE(ABORT,'Count allocation evidence is immutable'); END;
CREATE TRIGGER food_sales_count_allocation_no_delete BEFORE DELETE ON dog_food_sales_count_allocations BEGIN SELECT RAISE(ABORT,'Count allocation evidence is retained'); END;
CREATE TRIGGER food_sales_stock_basis_lock BEFORE UPDATE OF stock_basis ON dog_food_sales_order_metadata BEGIN SELECT RAISE(ABORT,'Historical stock basis is immutable'); END;

DROP TRIGGER food_pickup_collect_guard;
CREATE TRIGGER food_pickup_collect_guard BEFORE UPDATE OF status ON dog_food_pickups WHEN NEW.status='collected' AND OLD.status<>'collected' BEGIN
  SELECT RAISE(ABORT,'Actual pickup and valid allocated bags required') WHERE OLD.status<>'ready' OR NEW.collected_at IS NULL
    OR length(trim(COALESCE(NEW.collected_by,'')))=0 OR length(trim(COALESCE(NEW.received_by,'')))=0
    OR NOT EXISTS(SELECT 1 FROM dog_food_orders o WHERE o.id=NEW.order_id AND o.fulfillment_method='pickup' AND o.deleted_at IS NULL
      AND o.status NOT IN('cancelled','refunded') AND (EXISTS(SELECT 1 FROM dog_food_sales_handoffs h JOIN dog_food_sales_order_metadata m ON m.order_id=h.order_id
        WHERE h.order_id=o.id AND h.method='pickup' AND o.source='staff_sales' AND NEW.collected_at=h.completed_at)
      OR (o.status IN('paid','scheduled') AND EXISTS(SELECT 1 FROM dog_food_payments p WHERE p.order_id=o.id AND p.status='captured'))))
    OR EXISTS(SELECT 1 FROM dog_food_order_items i WHERE i.order_id=NEW.order_id AND i.quantity<>CASE WHEN EXISTS(SELECT 1 FROM dog_food_sales_order_metadata m JOIN dog_food_orders o ON o.id=m.order_id WHERE m.order_id=NEW.order_id AND m.stock_basis='confirmed_count' AND o.source='staff_sales') THEN COALESCE((SELECT a.quantity FROM dog_food_sales_count_allocations a WHERE a.order_id=i.order_id AND a.product_id=i.product_id),0) ELSE COALESCE((SELECT SUM(a.quantity)
      FROM dog_food_lot_allocations a JOIN dog_food_stock_lots l ON l.id=a.lot_id WHERE a.order_id=i.order_id AND l.product_id=i.product_id
      AND a.released_at IS NULL AND a.consumed_at IS NULL AND l.best_before>=COALESCE((SELECT local_date FROM dog_food_sales_handoffs WHERE order_id=NEW.order_id),substr(NEW.collected_at,1,10)) AND l.quarantined=0 AND l.expiry_assumed=0),0) END);
END;

DROP TRIGGER food_staff_delivery_lots;
CREATE TRIGGER food_staff_delivery_lots BEFORE UPDATE OF status ON dog_food_deliveries
WHEN NEW.status='delivered' AND OLD.status<>'delivered' AND EXISTS(SELECT 1 FROM dog_food_sales_order_metadata WHERE order_id=NEW.order_id) BEGIN
  SELECT RAISE(ABORT,'Staff delivery requires valid allocated bags') WHERE EXISTS(
    SELECT 1 FROM dog_food_order_items i WHERE i.order_id=NEW.order_id AND i.quantity<>CASE WHEN EXISTS(SELECT 1 FROM dog_food_sales_order_metadata m JOIN dog_food_orders o ON o.id=m.order_id WHERE m.order_id=NEW.order_id AND m.stock_basis='confirmed_count' AND o.source='staff_sales') THEN COALESCE((SELECT a.quantity FROM dog_food_sales_count_allocations a WHERE a.order_id=i.order_id AND a.product_id=i.product_id),0) ELSE COALESCE((SELECT SUM(a.quantity)
      FROM dog_food_lot_allocations a JOIN dog_food_stock_lots l ON l.id=a.lot_id WHERE a.order_id=i.order_id AND l.product_id=i.product_id
      AND a.released_at IS NULL AND a.consumed_at IS NULL AND l.best_before>=COALESCE((SELECT local_date FROM dog_food_sales_handoffs WHERE order_id=NEW.order_id),substr(NEW.delivered_at,1,10)) AND l.quarantined=0 AND l.expiry_assumed=0),0) END);
END;

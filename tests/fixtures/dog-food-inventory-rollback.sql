-- Synthetic test database only.


DROP TRIGGER food_lot_allocation_sellable;
DROP TRIGGER food_lot_quarantine_allocated;
DROP TRIGGER food_cost_no_update;
DROP TRIGGER food_cost_no_delete;
DROP TABLE dog_food_cost_annotations;
ALTER TABLE dog_food_stock_lots DROP COLUMN supplier;
ALTER TABLE dog_food_stock_lots DROP COLUMN purchase_date;
ALTER TABLE dog_food_stock_lots DROP COLUMN received_date;
ALTER TABLE dog_food_stock_lots DROP COLUMN unit_cost_cents;
ALTER TABLE dog_food_stock_lots DROP COLUMN source_reference;
ALTER TABLE dog_food_stock_lots DROP COLUMN quarantined;
ALTER TABLE dog_food_stock_lots DROP COLUMN expiry_assumed;

DELETE FROM d1_migrations WHERE name='0056_dog_food_inventory_costs.sql';

-- PROPOSAL ONLY. Requires separate production schema authorization.
-- Retains all existing orders, receipts, customer links and inventory quantities.
ALTER TABLE dog_food_sales_order_metadata ADD COLUMN sale_date TEXT;
ALTER TABLE dog_food_sales_order_metadata ADD COLUMN customer_type TEXT CHECK(customer_type IN('individual','dealer','route_partner'));
ALTER TABLE dog_food_sales_order_metadata ADD COLUMN payment_status_entered TEXT CHECK(payment_status_entered IN('paid','partial','unpaid'));
ALTER TABLE dog_food_sales_order_metadata ADD COLUMN payment_method_entered TEXT CHECK(payment_method_entered IN('cash','check','venmo','zelle','paypal','card'));
ALTER TABLE dog_food_sales_order_metadata ADD COLUMN sale_notes TEXT NOT NULL DEFAULT '';

-- Rebuild only the evidence table to expand its method CHECK. Copy every row.
DROP TRIGGER food_receipt_update_guard;
DROP TRIGGER food_sales_receipt_no_delete;
CREATE TABLE dog_food_sales_payment_evidence_next (
  payment_id TEXT PRIMARY KEY REFERENCES dog_food_payments(id), actor TEXT NOT NULL,
  method TEXT NOT NULL CHECK(method IN('cash','check','venmo','zelle','paypal','card','sweep_and_go')),
  reference TEXT, received_at TEXT NOT NULL, source_event_id TEXT, evidence TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO dog_food_sales_payment_evidence_next SELECT * FROM dog_food_sales_payment_evidence;
DROP TABLE dog_food_sales_payment_evidence;
ALTER TABLE dog_food_sales_payment_evidence_next RENAME TO dog_food_sales_payment_evidence;
CREATE TRIGGER food_receipt_update_guard BEFORE UPDATE OF amount_cents,order_id,provider,provider_transaction_id,idempotency_key ON dog_food_payments
WHEN EXISTS(SELECT 1 FROM dog_food_sales_payment_evidence WHERE payment_id=OLD.id) BEGIN
  SELECT RAISE(ABORT,'Recorded receipts are immutable; request office correction');
END;
CREATE TRIGGER food_sales_receipt_no_delete BEFORE DELETE ON dog_food_payments
WHEN EXISTS(SELECT 1 FROM dog_food_sales_payment_evidence WHERE payment_id=OLD.id) BEGIN
  SELECT RAISE(ABORT,'Recorded receipts cannot be deleted');
END;
DROP INDEX idx_food_one_capture;
CREATE UNIQUE INDEX idx_food_one_capture ON dog_food_payments(order_id)
  WHERE status='captured' AND provider NOT IN('staff_cash','staff_check','staff_venmo','staff_zelle','staff_paypal','staff_card','sng_verified');
-- The same Stripe transaction cannot also be entered as a manual card receipt.
CREATE UNIQUE INDEX idx_food_card_receipt_reference ON dog_food_payments(provider_transaction_id)
  WHERE provider IN('stripe','staff_card') AND status IN('captured','refunded');

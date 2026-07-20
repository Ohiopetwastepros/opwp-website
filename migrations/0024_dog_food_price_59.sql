-- Current Extreme Dog Fuel 40 lb retail rate is $59 before Lucas County tax.
UPDATE dog_food_products
SET retail_price_cents = 5900,
    updated_at = CURRENT_TIMESTAMP
WHERE bag_weight_lb = 40
  AND formula_code IN ('22-12', '26-14', '26-18', '30-20');

-- Reprice only orders that have not been paid. Captured financial history is immutable.
UPDATE dog_food_order_items
SET unit_price_cents = 5900,
    line_total_cents = quantity * 5900
WHERE order_id IN (
  SELECT id FROM dog_food_orders
  WHERE status IN ('draft', 'pending_payment', 'payment_failed')
)
AND product_id IN (
  SELECT id FROM dog_food_products
  WHERE bag_weight_lb = 40
    AND formula_code IN ('22-12', '26-14', '26-18', '30-20')
);

UPDATE dog_food_subscription_items
SET unit_price_cents = 5900,
    updated_at = CURRENT_TIMESTAMP
WHERE is_active = 1
  AND product_id IN (
    SELECT id FROM dog_food_products
    WHERE bag_weight_lb = 40
      AND formula_code IN ('22-12', '26-14', '26-18', '30-20')
  );

UPDATE dog_food_orders
SET subtotal_cents = COALESCE((
      SELECT SUM(line_total_cents)
      FROM dog_food_order_items
      WHERE order_id = dog_food_orders.id
    ), 0),
    tax_cents = COALESCE((
      SELECT SUM(CAST(ROUND(unit_price_cents * 0.0775) AS INTEGER) * quantity)
      FROM dog_food_order_items
      WHERE order_id = dog_food_orders.id
    ), 0) + CAST(ROUND(delivery_fee_cents * 0.0775) AS INTEGER),
    updated_at = CURRENT_TIMESTAMP
WHERE status IN ('draft', 'pending_payment', 'payment_failed');

UPDATE dog_food_orders
SET total_cents = subtotal_cents + delivery_fee_cents + tax_cents,
    updated_at = CURRENT_TIMESTAMP
WHERE status IN ('draft', 'pending_payment', 'payment_failed');

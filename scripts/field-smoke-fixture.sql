DELETE FROM route_partner_notification_outbox WHERE route_plan_id='qa-field-plan';
DELETE FROM route_partner_field_proofs WHERE task_id IN ('qa-scoop-task','qa-food-task');
DELETE FROM route_partner_field_events WHERE route_plan_id='qa-field-plan';
DELETE FROM route_partner_field_breaks WHERE shift_id IN (SELECT id FROM route_partner_field_shifts WHERE route_plan_id='qa-field-plan');
DELETE FROM route_partner_shift_inventory WHERE shift_id IN (SELECT id FROM route_partner_field_shifts WHERE route_plan_id='qa-field-plan');
DELETE FROM route_partner_field_shifts WHERE route_plan_id='qa-field-plan';
DELETE FROM route_partner_load_checks WHERE route_plan_id='qa-field-plan';
DELETE FROM route_partner_change_requests WHERE route_plan_id='qa-field-plan';
DELETE FROM route_partner_plan_events WHERE route_plan_id='qa-field-plan';
DELETE FROM route_partner_tasks WHERE route_plan_id='qa-field-plan';
DELETE FROM route_partner_locations WHERE route_plan_id='qa-field-plan';
DELETE FROM route_partner_route_plans WHERE id='qa-field-plan';
DELETE FROM dog_food_deliveries WHERE id='qa-food-delivery';
DELETE FROM dog_food_subscription_items WHERE subscription_id IN (SELECT id FROM dog_food_subscriptions WHERE customer_id='qa-food-customer');
DELETE FROM dog_food_subscriptions WHERE customer_id='qa-food-customer';
DELETE FROM dog_food_payments WHERE order_id IN (SELECT id FROM dog_food_orders WHERE customer_id='qa-food-customer' AND source='admin_manual');
DELETE FROM dog_food_deliveries WHERE order_id IN (SELECT id FROM dog_food_orders WHERE customer_id='qa-food-customer' AND source='admin_manual');
DELETE FROM dog_food_order_items WHERE order_id IN (SELECT id FROM dog_food_orders WHERE customer_id='qa-food-customer' AND source='admin_manual');
DELETE FROM dog_food_orders WHERE customer_id='qa-food-customer' AND source='admin_manual';
-- The smoke Worker must run with FIELD_AUTH_SECRET=field-smoke-local-secret.
INSERT INTO route_partner_members (id,organization_id,email,display_name,role,external_employee_id,status)
VALUES ('qa-field-member','org-opwp','field.qa@opwp.local','Field QA','technician','qa-tech','active')
ON CONFLICT(organization_id,email) DO UPDATE SET display_name='Field QA',role='technician',external_employee_id='qa-tech',status='active';
INSERT INTO route_partner_field_credentials (member_id,pin_salt,pin_hash,failed_attempts,locked_until)
VALUES ((SELECT id FROM route_partner_members WHERE email='field.qa@opwp.local'),'opwp-field-smoke-fixture','kmHfvGzzNlCZELS1Q3ddE3Vhkqcuv4H3m8Fn0iavGc8',0,NULL)
ON CONFLICT(member_id) DO UPDATE SET pin_salt=excluded.pin_salt,pin_hash=excluded.pin_hash,failed_attempts=0,locked_until=NULL;
INSERT OR REPLACE INTO dog_food_customers (id,first_name,last_name,email,phone,customer_type,status) VALUES ('qa-food-customer','Test','Customer','qa-food@example.invalid','4190000000','route_partner','active');
INSERT OR REPLACE INTO dog_food_addresses (id,customer_id,line1,city,state,postal_code) VALUES ('qa-food-address','qa-food-customer','123 Test Lane','Holland','OH','43528');
INSERT OR REPLACE INTO dog_food_orders (id,order_number,customer_id,address_id,order_type,status,subtotal_cents,tax_cents,total_cents) VALUES ('qa-food-order','QA-FIELD-001','qa-food-customer','qa-food-address','subscription','scheduled',6000,465,6465);
DELETE FROM dog_food_order_items WHERE id='qa-food-item';
INSERT INTO dog_food_order_items (id,order_id,product_id,quantity,unit_price_cents,line_total_cents) VALUES ('qa-food-item','qa-food-order','edf-22-12-pink-40',1,6000,6000);
INSERT OR REPLACE INTO dog_food_deliveries (id,order_id,customer_id,address_id,scheduled_date,delivery_type,status,technician_id,route_id,route_sequence,placement_note) VALUES ('qa-food-delivery','qa-food-order','qa-food-customer','qa-food-address','2026-07-15','route_partner','assigned','qa-tech','qa-route',2,'Place beside the garage service door.');
INSERT OR REPLACE INTO route_partner_route_plans (id,organization_id,service_date,technician_external_id,technician_name,source_provider,source_route_id,source_fingerprint,version,status,source_job_count,food_task_count,location_count,assigned_member_id,finalized_at,finalized_by) VALUES ('qa-field-plan','org-opwp','2026-07-15','qa-tech','Field QA','sweep_and_go','qa-route','qa-fingerprint',1,'finalized',1,1,2,(SELECT id FROM route_partner_members WHERE email='field.qa@opwp.local'),'2026-07-15 10:00:00','qa');
INSERT OR REPLACE INTO route_partner_locations (id,route_plan_id,organization_id,location_key,sequence,address,customer_display_name,arrival_status,estimated_service_minutes) VALUES ('qa-location-1','qa-field-plan','org-opwp','qa-loc-1',1,'100 Main Street, Holland, OH 43528','Scoop Customer','pending',8);
INSERT OR REPLACE INTO route_partner_locations (id,route_plan_id,organization_id,location_key,sequence,address,customer_display_name,arrival_status,estimated_service_minutes) VALUES ('qa-location-2','qa-field-plan','org-opwp','qa-loc-2',2,'123 Test Lane, Holland, OH 43528','Test Customer','pending',4);
INSERT OR REPLACE INTO route_partner_tasks (id,route_plan_id,location_id,organization_id,task_type,source_provider,external_task_id,customer_display_name,status,estimated_minutes,crm_completion_status) VALUES ('qa-scoop-task','qa-field-plan','qa-location-1','org-opwp','scoop','sweep_and_go','qa-sng-job','Scoop Customer','scheduled',8,'pending');
INSERT OR REPLACE INTO route_partner_tasks (id,route_plan_id,location_id,organization_id,task_type,source_provider,external_task_id,dog_food_delivery_id,customer_display_name,status,estimated_minutes,placement_note,product_summary,crm_completion_status) VALUES ('qa-food-task','qa-field-plan','qa-location-2','org-opwp','dog_food','route_partner','qa-food-delivery','qa-food-delivery','Test Customer','ready',4,'Place beside the garage service door.','1x 22-12 40 lb','not_required');
INSERT INTO route_partner_field_shifts (id,organization_id,route_plan_id,technician_member_id,service_date,status) VALUES ('qa-field-shift','org-opwp','qa-field-plan',(SELECT id FROM route_partner_members WHERE email='field.qa@opwp.local'),'2026-07-15','pending_load');
INSERT INTO route_partner_shift_inventory (id,shift_id,product_id,required_quantity) VALUES ('qa-field-inventory','qa-field-shift','edf-22-12-pink-40',1);
INSERT INTO route_partner_load_checks (id,organization_id,route_plan_id,technician_member_id,status,required_items,payment_validation_status) VALUES ('qa-field-load','org-opwp','qa-field-plan',(SELECT id FROM route_partner_members WHERE email='field.qa@opwp.local'),'pending','[{"productId":"edf-22-12-pink-40","quantity":1}]','passed');

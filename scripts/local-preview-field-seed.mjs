// LOCAL PREVIEW ONLY. This module generates fabricated SQL; it never opens a
// database, reads credentials, calls a provider or applies a migration.
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { operatingDate } from '../lib/field-policy.mjs';
import { localPreviewCustomers } from './local-preview-fixtures.mjs';

export const LOCAL_PREVIEW_FIELD_SECRET = 'local-preview-field-secret-only-2026-11-21';
export const LOCAL_PREVIEW_TECHNICIANS = Object.freeze([
  { id: 'local-tech-1', email: 'tech1@example.test', name: 'Alex Turner', pin: '246810', routeName: 'Holland and Sylvania', customerOffset: 0 },
  { id: 'local-tech-2', email: 'tech2@example.test', name: 'Jamie Miller', pin: '135790', routeName: 'Maumee and Perrysburg', customerOffset: 6 },
]);
const literal = value => value == null ? 'NULL' : typeof value === 'number' ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
const insert = (table, values, suffix = 'ON CONFLICT DO NOTHING') => `INSERT INTO ${table} (${Object.keys(values).join(',')}) VALUES (${Object.values(values).map(literal).join(',')}) ${suffix};`;

export function createLocalPreviewFieldSeed({ today = operatingDate(), fieldSecret = LOCAL_PREVIEW_FIELD_SECRET, customers = localPreviewCustomers() } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || new Date(`${today}T12:00:00Z`).toISOString().slice(0, 10) !== today) throw new Error('Choose a valid local preview service date.');
  if (typeof fieldSecret !== 'string' || fieldSecret.length < 24) throw new Error('Set a dedicated local-preview field signing secret.');
  if (!Array.isArray(customers) || customers.length < 12 || customers.some(customer => !String(customer.id).startsWith('local-customer-'))) throw new Error('Use the fabricated local-preview customer manifest.');
  const sql = ['-- FABRICATED LOCAL PREVIEW ONLY. Do not execute against a remote database.', 'PRAGMA foreign_keys=ON;'];
  sql.push(insert('route_partner_organizations', { id: 'org-opwp', slug: 'opwp-local-preview', name: 'Ohio Pet Waste Pros', timezone: 'America/New_York', status: 'active' }));
  const manifest = { date: today, techs: [], stops: [], taskCount: 0, routes: [], fieldUrl: '/field/app/', loginUrl: '/field/login/' };
  for (const tech of LOCAL_PREVIEW_TECHNICIANS) {
    const number = tech.id.at(-1), planId = `local-field-plan-${number}-${today}`, shiftId = `local-field-shift-${number}-${today}`;
    const salt = `local-preview-pin-salt-${tech.id}`, hash = createHmac('sha256', fieldSecret).update(`${salt}:${tech.pin}`).digest('base64url');
    sql.push(insert('route_partner_members', { id: tech.id, organization_id: 'org-opwp', email: tech.email, display_name: tech.name, role: 'technician', external_employee_id: tech.id, status: 'active' }));
    sql.push(insert('route_partner_field_credentials', { member_id: tech.id, pin_salt: salt, pin_hash: hash, failed_attempts: 0, locked_until: null }));
    const routeCustomers = customers.slice(tech.customerOffset, tech.customerOffset + 6);
    const services = routeCustomers.map(customer => {
      const items = [{ id: 'scoop', title: `${customer.frequency === 'every_other_week' ? 'Biweekly' : 'Weekly'} yard cleanup`, quantity: 1, minutes: 10 + customer.dogCount * 2 }];
      for (const addon of customer.addOnIds || []) {
        const serviceId = ({ kitty_litter: 'litter', kitty_litter_extra_box: 'litter', kitty_litter_changeout: 'litter', deodorize: 'deodorize', haul_away: 'haul', sani_monthly: 'sanitize' })[addon];
        if (!serviceId) continue;
        if (serviceId === 'litter' && items.some(item => item.id === 'litter')) { items.find(item => item.id === 'litter').quantity++; continue; }
        items.push({ id: serviceId, title: serviceId === 'litter' ? addon === 'kitty_litter_changeout' ? 'Kitty litter change-out' : 'Kitty litter box service' : ({ deodorize: 'Yard deodorization', haul: 'Waste haul-away', sanitize: 'Yard sanitization' })[serviceId], quantity: 1, minutes: serviceId === 'haul' ? 0 : serviceId === 'litter' ? 6 : 5 });
      }
      if (customer.foodDelivery) items.push({ id: 'food', title: `${customer.foodDelivery.name}, ${customer.foodDelivery.weightLb} lb`, quantity: customer.foodDelivery.quantity, minutes: 4 });
      return items;
    });
    sql.push(insert('route_partner_route_plans', { id: planId, organization_id: 'org-opwp', service_date: today, technician_external_id: tech.id, technician_name: tech.name, source_provider: 'opwp', source_route_id: tech.routeName, source_fingerprint: `local-preview-${today}-${number}-v2`, version: 1, status: 'finalized', source_job_count: services.flat().filter(item => item.id !== 'food').length, food_task_count: services.flat().filter(item => item.id === 'food').length, location_count: routeCustomers.length, assigned_member_id: tech.id, finalized_at: `${today}T00:00:00Z`, finalized_by: 'local-preview-seed', released_to_field_at: `${today}T00:00:00Z` }));
    sql.push(insert('route_partner_field_shifts', { id: shiftId, organization_id: 'org-opwp', route_plan_id: planId, technician_member_id: tech.id, service_date: today, status: 'pending_load' }));
    sql.push(insert('route_partner_load_checks', { id: `local-field-load-${number}-${today}`, organization_id: 'org-opwp', route_plan_id: planId, technician_member_id: tech.id, status: 'pending', required_items: JSON.stringify(routeCustomers.filter(customer => customer.foodDelivery).map(customer => ({ productId: customer.foodDelivery.productId, quantity: customer.foodDelivery.quantity }))), confirmed_items: '[]', payment_validation_status: 'not_required', notes: 'Service supplies and scheduled food inventory must be checked before departure.' }));
    routeCustomers.forEach((customer, index) => {
      const stopId = `local-field-stop-${number}-${index + 1}-${today}`;
      const address = `${customer.street}, ${customer.city}, OH ${customer.zip}`;
      if (customer.foodDelivery) {
        const food = customer.foodDelivery, orderId = `local-food-order-${customer.id}-${today}`, addressId = `local-food-address-${customer.id}`, deliveryId = `local-food-delivery-${customer.id}-${today}`;
        sql.push(insert('dog_food_products', { id: food.productId, sku: 'LOCAL-BLUE-40', formula_code: '26-18', color: food.color, name: `${food.name}, ${food.weightLb} lb`, bag_weight_lb: food.weightLb, description: 'Adult maintenance formula', retail_price_cents: 5900, unit_cost_cents: 4200, is_active: 1, is_customer_visible: 0 }));
        sql.push(insert('dog_food_customers', { id: customer.id, first_name: customer.name.split(' ')[0], last_name: customer.name.split(' ').slice(1).join(' '), email: customer.email, phone: customer.phone, customer_type: 'route_partner', status: 'active' }));
        sql.push(insert('dog_food_addresses', { id: addressId, customer_id: customer.id, line1: customer.street, city: customer.city, state: 'OH', postal_code: customer.zip, latitude: customer.lat, longitude: customer.lng, placement_preference: 'other', placement_other: food.placement }));
        sql.push(insert('dog_food_orders', { id: orderId, order_number: `LOCAL-${today.replaceAll('-', '')}-${customer.id.slice(-2)}`, customer_id: customer.id, address_id: addressId, order_type: 'on_demand', status: 'scheduled', subtotal_cents: 5900 * food.quantity, total_cents: 5900 * food.quantity, tax_rate_basis_points: 0, source: 'local_preview', placed_at: `${today}T00:00:00Z` }));
        sql.push(insert('dog_food_order_items', { id: `${orderId}-item`, order_id: orderId, product_id: food.productId, quantity: food.quantity, unit_price_cents: 5900, line_total_cents: 5900 * food.quantity }));
        sql.push(insert('dog_food_payments', { id: `${orderId}-payment`, order_id: orderId, provider: 'fake', provider_transaction_id: `${orderId}-captured`, idempotency_key: `${orderId}-fake-payment`, amount_cents: 5900 * food.quantity, status: 'captured', processed_at: `${today}T00:00:00Z` }));
        sql.push(insert('dog_food_deliveries', { id: deliveryId, order_id: orderId, customer_id: customer.id, address_id: addressId, scheduled_date: today, delivery_type: 'route_partner', status: 'assigned', technician_id: tech.id, route_id: planId, route_sequence: index + 1, placement_note: food.placement }));
        sql.push(insert('route_partner_shift_inventory', { id: `local-field-inventory-${number}-${food.productId}-${today}`, shift_id: shiftId, product_id: food.productId, required_quantity: food.quantity }));
      }
      sql.push(insert('route_partner_locations', { id: stopId, route_plan_id: planId, organization_id: 'org-opwp', location_key: customer.id, sequence: index + 1, address, latitude: customer.lat, longitude: customer.lng, customer_display_name: customer.name, arrival_status: 'pending', estimated_service_minutes: services[index].reduce((sum, item) => sum + item.minutes * item.quantity, 0), estimated_drive_minutes: index === 0 ? 12 : 8 + index }));
      services[index].forEach((service, taskIndex) => {
        const taskId = `local-field-task-${number}-${index + 1}-${taskIndex + 1}-${today}`;
        const field = { identity: { id: taskId, organization_id: 'local-preview', client_id: customer.id, client_location_id: customer.id, assigned_to_id: tech.id }, hasGate: true, gateCode: customer.gateCode || '', dogCount: customer.dogCount, dogSafetySource: customer.scenario === 'unsafe_dog' || customer.id === 'local-customer-05' ? 'unsafe' : 'secured', frequency: customer.frequency, sourceNote: `Dogs: ${customer.dogNames.join(', ')}. Persistent: ${customer.accessNotes} ${customer.persistentNotes} ${customer.safetyNotes} Today: ${customer.todayNotes}` };
        sql.push(insert('route_partner_tasks', { id: taskId, route_plan_id: planId, location_id: stopId, organization_id: 'org-opwp', task_type: service.id === 'food' ? 'dog_food' : service.id === 'scoop' ? 'scoop' : 'other', source_provider: 'opwp', external_task_id: taskId, dog_food_delivery_id: service.id === 'food' ? `local-food-delivery-${customer.id}-${today}` : null, customer_external_id: customer.id, customer_display_name: customer.name, status: 'scheduled', estimated_minutes: service.minutes * service.quantity, product_summary: service.title, placement_note: service.id === 'food' ? customer.foodDelivery.placement : null, office_notes: service.id === 'litter' ? `Service ${service.quantity} litter ${service.quantity === 1 ? 'box' : 'boxes'}. Bag used litter and place it in the marked disposal bin.` : service.id === 'food' ? customer.foodDelivery.placement : customer.todayNotes, crm_completion_status: 'not_required', metadata: JSON.stringify({ field, workday: { serviceId: service.id, quantity: service.quantity } }) }));
        manifest.taskCount++;
      });
      manifest.stops.push({ id: stopId, customerId: customer.id, technicianId: tech.id, name: customer.name, address, services: services[index].map(service => ({ ...service })) });
    });
    manifest.techs.push({ id: tech.id, email: tech.email, name: tech.name, pin: tech.pin, planId, shiftId });
    manifest.routes.push({ id: planId, technicianId: tech.id, name: tech.routeName, stops: routeCustomers.length });
  }
  return { sql: `${sql.join('\n')}\n`, manifest };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const today = process.argv[2] || operatingDate(), output = process.argv[3] || 'tmp/local-preview/field-seed.sql';
  const result = createLocalPreviewFieldSeed({ today });
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, result.sql);
  fs.writeFileSync(output.replace(/\.sql$/, '.manifest.json'), `${JSON.stringify(result.manifest, null, 2)}\n`);
  console.log(`Fabricated local field seed written for ${today}: 2 technicians, ${result.manifest.stops.length} properties, ${result.manifest.taskCount} services. No database was accessed.`);
}

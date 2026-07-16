import { addressHash, normalizeSngDispatchJobs } from "./route-intelligence";

export const OPWP_ORGANIZATION_ID = "org-opwp";

const ACTIVE_DELIVERY_STATUSES = ["scheduled", "assigned", "out_for_delivery"];

function text(value) {
  return String(value ?? "").trim();
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00Z`).getTime());
}

function routeKey(technicianId, technicianName, routeId) {
  return `${text(technicianId) || text(technicianName) || "unassigned"}|${text(routeId) || "default"}`;
}

function completeAddress(row) {
  return [row.line1, row.line2, row.city, row.state, row.postal_code].map(text).filter(Boolean).join(", ").replace(/\s+/g, " ");
}

async function fingerprint(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function foodDeliveriesForDate(db, date) {
  const placeholders = ACTIVE_DELIVERY_STATUSES.map(() => "?").join(",");
  const result = await db.prepare(
    `SELECT d.id, d.technician_id, d.route_id, d.status, d.placement_note,
      a.line1, a.line2, a.city, a.state, a.postal_code, a.latitude, a.longitude,
      COALESCE(NULLIF(TRIM(c.first_name || ' ' || c.last_name), ''), 'Dog food customer') AS customer_name,
      GROUP_CONCAT(CAST(oi.quantity AS TEXT) || '× ' || p.formula_code || ' ' || CAST(p.bag_weight_lb AS TEXT) || ' lb', ', ') AS product_summary
     FROM dog_food_deliveries d
     JOIN dog_food_addresses a ON a.id=d.address_id
     JOIN dog_food_customers c ON c.id=d.customer_id
     JOIN dog_food_orders o ON o.id=d.order_id
     LEFT JOIN dog_food_order_items oi ON oi.order_id=o.id
     LEFT JOIN dog_food_products p ON p.id=oi.product_id
     WHERE d.scheduled_date=? AND d.status IN (${placeholders})
     GROUP BY d.id, d.technician_id, d.route_id, d.status, d.placement_note,
       a.line1, a.line2, a.city, a.state, a.postal_code, a.latitude, a.longitude,
       c.first_name, c.last_name
     ORDER BY d.route_sequence, d.created_at`
  ).bind(date, ...ACTIVE_DELIVERY_STATUSES).all();

  return Promise.all((result.results ?? []).map(async (row) => ({
    id: text(row.id),
    technicianId: text(row.technician_id),
    routeId: text(row.route_id),
    status: text(row.status),
    placementNote: text(row.placement_note),
    customerName: text(row.customer_name),
    productSummary: text(row.product_summary) || "Dog food delivery",
    address: completeAddress(row),
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
    locationKey: await addressHash(completeAddress(row)),
  })));
}

function buildSourceGroups(sourceRows) {
  const groups = new Map();
  const jobs = normalizeSngDispatchJobs(sourceRows).filter((job) => job.jobId && job.address);
  for (const job of jobs) {
    const key = routeKey(job.technicianId, job.technicianName, job.routeId);
    if (!groups.has(key)) groups.set(key, {
      key,
      technicianId: job.technicianId,
      technicianName: job.technicianName || "Unassigned",
      routeId: job.routeId,
      jobs: [],
      food: [],
    });
    groups.get(key).jobs.push(job);
  }
  for (const group of groups.values()) group.jobs.sort((left, right) => left.sequence - right.sequence || left.sourceIndex - right.sourceIndex);
  return groups;
}

async function attachFoodDeliveries(groups, deliveries) {
  const jobLocations = new Map();
  for (const group of groups.values()) {
    for (const job of group.jobs) {
      const key = await addressHash(job.address);
      if (!jobLocations.has(key)) jobLocations.set(key, group.key);
    }
  }

  for (const delivery of deliveries) {
    const exactRoute = [...groups.values()].find((group) => (
      delivery.technicianId && group.technicianId === delivery.technicianId && (!delivery.routeId || group.routeId === delivery.routeId)
    ));
    const matchingLocation = jobLocations.get(delivery.locationKey);
    const targetKey = exactRoute?.key || matchingLocation || routeKey(delivery.technicianId, "Unassigned", delivery.routeId || "food-delivery");
    if (!groups.has(targetKey)) groups.set(targetKey, {
      key: targetKey,
      technicianId: delivery.technicianId,
      technicianName: "Unassigned",
      routeId: delivery.routeId || "Food delivery",
      jobs: [],
      food: [],
    });
    groups.get(targetKey).food.push(delivery);
  }
}

async function locationsForGroup(group) {
  const locations = new Map();
  for (const job of group.jobs) {
    const locationKey = await addressHash(job.address);
    if (!locations.has(locationKey)) locations.set(locationKey, {
      id: crypto.randomUUID(),
      locationKey,
      sequence: Number(job.sequence) || locations.size + 1,
      address: job.address,
      customerName: job.customerName,
      latitude: job.location?.latitude ?? null,
      longitude: job.location?.longitude ?? null,
      tasks: [],
    });
    const location = locations.get(locationKey);
    location.customerName ||= job.customerName;
    location.tasks.push({
      id: crypto.randomUUID(),
      type: "scoop",
      sourceProvider: "sweep_and_go",
      externalId: job.jobId,
      customerId: job.customerId,
      customerName: job.customerName,
      status: "scheduled",
      estimatedMinutes: Number(job.serviceMinutes) || 0,
      crmCompletionStatus: "pending",
      metadata: { sourceSequence: job.sequence, scheduledTime: job.scheduledTime },
    });
  }

  let nextSequence = Math.max(0, ...[...locations.values()].map((location) => Number(location.sequence) || 0)) + 1;
  for (const delivery of group.food) {
    if (!locations.has(delivery.locationKey)) locations.set(delivery.locationKey, {
      id: crypto.randomUUID(),
      locationKey: delivery.locationKey,
      sequence: nextSequence++,
      address: delivery.address,
      customerName: delivery.customerName,
      latitude: delivery.latitude,
      longitude: delivery.longitude,
      tasks: [],
    });
    const location = locations.get(delivery.locationKey);
    location.customerName ||= delivery.customerName;
    location.tasks.push({
      id: crypto.randomUUID(),
      type: "dog_food",
      sourceProvider: "route_partner",
      externalId: delivery.id,
      deliveryId: delivery.id,
      customerName: delivery.customerName,
      status: "ready",
      estimatedMinutes: 4,
      placementNote: delivery.placementNote,
      productSummary: delivery.productSummary,
      crmCompletionStatus: "not_required",
      metadata: { deliveryStatus: delivery.status },
    });
  }

  const ordered = [...locations.values()].sort((left, right) => left.sequence - right.sequence || left.address.localeCompare(right.address));
  ordered.forEach((location, index) => {
    location.sequence = index + 1;
    location.estimatedMinutes = location.tasks.reduce((sum, task) => sum + Number(task.estimatedMinutes || 0), 0);
  });
  return ordered;
}

async function latestPlan(db, organizationId, date, group) {
  return db.prepare(
    `SELECT id, version, status, source_fingerprint
     FROM route_partner_route_plans
     WHERE organization_id=? AND service_date=? AND technician_external_id=? AND source_route_id=?
     ORDER BY version DESC LIMIT 1`
  ).bind(organizationId, date, group.technicianId, group.routeId).first();
}

async function saveGroupPlan(db, { organizationId, date, actor, group }) {
  const locations = await locationsForGroup(group);
  const sourceFingerprint = await fingerprint(locations.map((location) => ({
    address: location.address,
    tasks: location.tasks.map((task) => [task.type, task.externalId, task.status, task.productSummary]),
  })));
  const previous = await latestPlan(db, organizationId, date, group);
  if (previous?.source_fingerprint === sourceFingerprint) return { id: previous.id, version: previous.version, status: previous.status, unchanged: true };

  const planId = crypto.randomUUID();
  const version = Number(previous?.version || 0) + 1;
  const foodTaskCount = locations.flatMap((location) => location.tasks).filter((task) => task.type === "dog_food").length;
  const statements = [
    db.prepare(
      `INSERT INTO route_partner_route_plans
        (id, organization_id, service_date, technician_external_id, technician_name, source_provider,
         source_route_id, source_fingerprint, version, status, source_job_count, food_task_count, location_count, imported_by)
       VALUES (?, ?, ?, ?, ?, 'sweep_and_go', ?, ?, ?, 'draft', ?, ?, ?, ?)`
    ).bind(planId, organizationId, date, group.technicianId, group.technicianName, group.routeId, sourceFingerprint,
      version, group.jobs.length, foodTaskCount, locations.length, actor),
    db.prepare(
      `UPDATE route_partner_route_plans SET status='superseded', updated_at=CURRENT_TIMESTAMP
       WHERE organization_id=? AND service_date=? AND technician_external_id=? AND source_route_id=?
         AND status='draft' AND id<>?`
    ).bind(organizationId, date, group.technicianId, group.routeId, planId),
  ];

  for (const location of locations) {
    statements.push(db.prepare(
      `INSERT INTO route_partner_locations
        (id, route_plan_id, organization_id, location_key, sequence, address, latitude, longitude,
         customer_display_name, estimated_service_minutes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(location.id, planId, organizationId, location.locationKey, location.sequence, location.address,
      location.latitude, location.longitude, location.customerName || null, location.estimatedMinutes));
    for (const task of location.tasks) statements.push(db.prepare(
      `INSERT INTO route_partner_tasks
        (id, route_plan_id, location_id, organization_id, task_type, source_provider, external_task_id,
         dog_food_delivery_id, customer_external_id, customer_display_name, status, estimated_minutes,
         placement_note, product_summary, crm_completion_status, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(task.id, planId, location.id, organizationId, task.type, task.sourceProvider, task.externalId || null,
      task.deliveryId || null, task.customerId || null, task.customerName || null, task.status, task.estimatedMinutes,
      task.placementNote || null, task.productSummary || null, task.crmCompletionStatus, JSON.stringify(task.metadata)));
  }
  statements.push(db.prepare(
    `INSERT INTO route_partner_plan_events (id, organization_id, route_plan_id, event_type, actor_email, details)
     VALUES (?, ?, ?, 'route_imported', ?, ?)`
  ).bind(crypto.randomUUID(), organizationId, planId, actor, JSON.stringify({ version, sourceJobs: group.jobs.length, foodTasks: foodTaskCount, locations: locations.length })));

  for (let index = 0; index < statements.length; index += 75) await db.batch(statements.slice(index, index + 75));
  return { id: planId, version, status: "draft", unchanged: false };
}

export async function importRoutePartnerDay({ db, date, sourceRows, actor, organizationId = OPWP_ORGANIZATION_ID }) {
  if (!db) throw new Error("Route Partner storage is not configured.");
  if (!validDate(date)) throw new Error("A valid service date is required.");
  const groups = buildSourceGroups(sourceRows);
  const deliveries = await foodDeliveriesForDate(db, date);
  await attachFoodDeliveries(groups, deliveries);
  if (!groups.size) throw new Error("No dispatched scoop jobs or scheduled dog-food deliveries were found for this date.");

  const plans = [];
  for (const group of groups.values()) plans.push(await saveGroupPlan(db, { organizationId, date, actor, group }));
  await db.prepare(
    `UPDATE route_partner_crm_connections SET last_import_at=CURRENT_TIMESTAMP, last_error=NULL, updated_at=CURRENT_TIMESTAMP
     WHERE organization_id=? AND provider='sweep_and_go'`
  ).bind(organizationId).run();
  return { planCount: plans.length, createdCount: plans.filter((plan) => !plan.unchanged).length, unchangedCount: plans.filter((plan) => plan.unchanged).length };
}

export async function finalizeRoutePartnerPlan({ db, planId, actor, organizationId = OPWP_ORGANIZATION_ID }) {
  const plan = await db.prepare(
    `SELECT id, service_date, technician_external_id, source_route_id, status
     FROM route_partner_route_plans WHERE id=? AND organization_id=?`
  ).bind(planId, organizationId).first();
  if (!plan) throw new Error("The route plan was not found.");
  if (plan.status === "finalized") return { unchanged: true };
  if (plan.status !== "draft") throw new Error("Only a draft route can be finalized.");

  await db.batch([
    db.prepare(
      `UPDATE route_partner_route_plans SET status='superseded', updated_at=CURRENT_TIMESTAMP
       WHERE organization_id=? AND service_date=? AND technician_external_id=? AND source_route_id=? AND status='finalized'`
    ).bind(organizationId, plan.service_date, plan.technician_external_id, plan.source_route_id),
    db.prepare(
      `UPDATE route_partner_route_plans
       SET status='finalized', finalized_at=CURRENT_TIMESTAMP, finalized_by=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
    ).bind(actor, planId),
    db.prepare(
      `INSERT INTO route_partner_plan_events (id, organization_id, route_plan_id, event_type, actor_email)
       VALUES (?, ?, ?, 'route_finalized', ?)`
    ).bind(crypto.randomUUID(), organizationId, planId, actor),
  ]);
  return { unchanged: false };
}

export async function getRoutePartnerDay(db, date, organizationId = OPWP_ORGANIZATION_ID) {
  if (!validDate(date)) throw new Error("A valid service date is required.");
  const organization = await db.prepare(
    `SELECT id, slug, name, timezone, route_review_time, general_finalize_time
     FROM route_partner_organizations WHERE id=?`
  ).bind(organizationId).first();
  if (!organization) throw new Error("The Route Partner organization is not configured.");

  const planResult = await db.prepare(
    `SELECT p.* FROM route_partner_route_plans p
     WHERE p.organization_id=? AND p.service_date=?
       AND p.version=(SELECT MAX(p2.version) FROM route_partner_route_plans p2
         WHERE p2.organization_id=p.organization_id AND p2.service_date=p.service_date
           AND p2.technician_external_id=p.technician_external_id AND p2.source_route_id=p.source_route_id)
     ORDER BY CASE WHEN p.technician_name='Unassigned' THEN 1 ELSE 0 END, p.technician_name, p.source_route_id`
  ).bind(organizationId, date).all();
  const plans = planResult.results ?? [];
  if (!plans.length) return { organization, date, plans: [], totals: { routes: 0, locations: 0, scoopTasks: 0, foodTasks: 0, finalized: 0 } };

  const placeholders = plans.map(() => "?").join(",");
  const planIds = plans.map((plan) => plan.id);
  const [locationResult, taskResult] = await Promise.all([
    db.prepare(
      `SELECT id, route_plan_id, sequence, address, customer_display_name, estimated_service_minutes,
        arrival_status, latitude, longitude
       FROM route_partner_locations WHERE route_plan_id IN (${placeholders}) ORDER BY route_plan_id, sequence`
    ).bind(...planIds).all(),
    db.prepare(
      `SELECT id, route_plan_id, location_id, task_type, source_provider, external_task_id,
        customer_display_name, status, estimated_minutes, placement_note, product_summary, crm_completion_status
       FROM route_partner_tasks WHERE route_plan_id IN (${placeholders}) ORDER BY location_id, task_type`
    ).bind(...planIds).all(),
  ]);
  const tasksByLocation = new Map();
  for (const task of taskResult.results ?? []) {
    if (!tasksByLocation.has(task.location_id)) tasksByLocation.set(task.location_id, []);
    tasksByLocation.get(task.location_id).push({
      id: task.id,
      type: task.task_type,
      sourceProvider: task.source_provider,
      externalId: task.external_task_id,
      customerName: task.customer_display_name,
      status: task.status,
      estimatedMinutes: Number(task.estimated_minutes) || 0,
      placementNote: task.placement_note,
      productSummary: task.product_summary,
      crmCompletionStatus: task.crm_completion_status,
    });
  }
  const locationsByPlan = new Map();
  for (const location of locationResult.results ?? []) {
    if (!locationsByPlan.has(location.route_plan_id)) locationsByPlan.set(location.route_plan_id, []);
    locationsByPlan.get(location.route_plan_id).push({
      id: location.id,
      sequence: location.sequence,
      address: location.address,
      customerName: location.customer_display_name,
      estimatedMinutes: Number(location.estimated_service_minutes) || 0,
      status: location.arrival_status,
      latitude: location.latitude,
      longitude: location.longitude,
      tasks: tasksByLocation.get(location.id) ?? [],
    });
  }
  const publicPlans = plans.map((plan) => ({
    id: plan.id,
    technicianId: plan.technician_external_id,
    technicianName: plan.technician_name,
    routeId: plan.source_route_id,
    sourceProvider: plan.source_provider,
    version: plan.version,
    status: plan.status,
    sourceJobCount: plan.source_job_count,
    foodTaskCount: plan.food_task_count,
    locationCount: plan.location_count,
    importedAt: plan.imported_at,
    importedBy: plan.imported_by,
    finalizedAt: plan.finalized_at,
    finalizedBy: plan.finalized_by,
    locations: locationsByPlan.get(plan.id) ?? [],
  }));
  return {
    organization,
    date,
    plans: publicPlans,
    totals: {
      routes: publicPlans.length,
      locations: publicPlans.reduce((sum, plan) => sum + plan.locations.length, 0),
      scoopTasks: publicPlans.reduce((sum, plan) => sum + plan.locations.flatMap((location) => location.tasks).filter((task) => task.type === "scoop").length, 0),
      foodTasks: publicPlans.reduce((sum, plan) => sum + plan.locations.flatMap((location) => location.tasks).filter((task) => task.type === "dog_food").length, 0),
      finalized: publicPlans.filter((plan) => plan.status === "finalized").length,
    },
  };
}

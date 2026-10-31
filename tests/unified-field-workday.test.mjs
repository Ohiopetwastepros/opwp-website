import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { DatabaseSync } from "node:sqlite";
import {
  getWorkday,
  saveWorkdayEvent,
  fieldDigest,
} from "../lib/field-workday-store.mjs";
import {
  officeWorkdayCommand,
  officeWorkdays,
} from "../lib/field-workday-office.mjs";
import {
  applyWorkdayEvent,
  PRECHECKS,
  WRAPCHECKS,
  workdaySummary,
} from "../lib/field-workday-model.mjs";
import {
  SERVICE_DEFAULTS,
  serviceTask,
  validateService,
} from "../lib/field-service-catalog.mjs";
import { operatingDate, FieldError } from "../lib/field-policy.mjs";
import { recordFieldMessageReceipt } from "../lib/field-message-receipts.mjs";
import { compareRouteDensity } from "../lib/route-density-policy.mjs";
import {
  recurringPropertyKey,
  recurringDue,
  validateRecurring,
} from "../lib/field-recurring-services.mjs";
import { offlineAccessUntil } from "../lib/field-offline-access.mjs";
import { workdayInsights } from "../lib/field-workday-insights.mjs";
import { reviewCloseoutIdentity } from "../lib/field-sync-review.mjs";
import { assertDeviceSession,adoptServerWorkday } from "../lib/field-workday-device.mjs";

test('successful first sign-in without an assigned route opens an empty workday safely',()=>{
  const result={day:null,member:{id:'member',organizationId:'org'},changes:[],messages:[],offlineUntil:'2026-10-13T23:00:00Z'};
  for(const saved of [null,undefined]){
    const opened=adoptServerWorkday(saved,result);
    assert.equal(opened.day,null);assert.deepEqual(opened.member,result.member);assert.deepEqual(opened.photos,{});assert.deepEqual(opened.drafts,{});assert.deepEqual(opened.pending,[]);
    assert.deepEqual(adoptServerWorkday(opened,result),opened,'subsequent refresh of the empty workday remains valid');
  }
});

test('route removal retains pending work for review and clears only backed-up device attachments',()=>{
  const saved={day:{id:'old-shift',revision:2},pending:[{id:'unsynced'}],photos:{proof:'photo-bytes'},drafts:{task:'private note'}};
  const result={day:null,member:{id:'member'},changes:[],messages:[]};
  assert.throws(()=>adoptServerWorkday(saved,result),/Pending work is retained/);assert.equal(saved.photos.proof,'photo-bytes');assert.equal(saved.pending.length,1);
  const backedUp={...saved,pending:[]};assert.deepEqual(adoptServerWorkday(backedUp,result).photos,{});
  const same=adoptServerWorkday(backedUp,{...result,day:{id:'old-shift',revision:2}});assert.equal(same.photos.proof,'photo-bytes');assert.equal(same.drafts.task,'private note');
});

function fixture() {
  const sql = new DatabaseSync(":memory:");
  for (const file of fs
    .readdirSync(new URL("../tmp/test-migrations/", import.meta.url))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    sql.exec(
      fs.readFileSync(
        new URL(`../tmp/test-migrations/${file}`, import.meta.url),
        "utf8",
      ),
    );
  sql.exec(
    fs.readFileSync(
      new URL("../scripts/field-smoke-fixture.sql", import.meta.url),
      "utf8",
    ),
  );
  sql
    .prepare("UPDATE route_partner_route_plans SET service_date=? WHERE id=?")
    .run(operatingDate(), "qa-field-plan");
  sql
    .prepare("UPDATE route_partner_field_shifts SET service_date=? WHERE id=?")
    .run(operatingDate(), "qa-field-shift");
  sql.prepare("UPDATE route_partner_tasks SET metadata=? WHERE id=?").run(
    JSON.stringify({
      field: {
        identity: {
          id: "qa-sng-job",
          organization_id: "1",
          client_location_id: "1",
          assigned_to_id: "qa-tech",
        },
        dogCount: 0,
        gateCode: "QA only",
      },
    }),
    "qa-scoop-task",
  );
  sql.exec(
    "INSERT INTO dog_food_payments(id,order_id,idempotency_key,amount_cents,status) VALUES ('qa-unified-payment','qa-food-order','qa-unified-payment',6357,'captured')",
  );
  const db = {
    prepare(query) {
      return {
        bind(...values) {
          const args = values.map((v) =>
            v instanceof ArrayBuffer ? new Uint8Array(v) : v,
          );
          return {
            query,
            args,
            async first() {
              return sql.prepare(query).get(...args) || null;
            },
            async all() {
              return { results: sql.prepare(query).all(...args) };
            },
            async run() {
              return sql.prepare(query).run(...args);
            },
          };
        },
      };
    },
    async batch(rows) {
      sql.exec("BEGIN");
      try {
        const result = rows.map((r) => ({
          results: sql.prepare(r.query).all(...r.args),
        }));
        if (db.failWrites)
          sql.exec("INSERT INTO deliberately_missing_table VALUES (1)");
        sql.exec("COMMIT");
        return result;
      } catch (e) {
        sql.exec("ROLLBACK");
        throw e;
      }
    },
  };
  const member = {
    id: "qa-field-member",
    organizationId: "org-opwp",
    name: "Field QA",
    email: "field.qa@example.test",
  };
  let clock = Date.now();
  const f = {
    sql,
    db,
    member,
    get day() {
      return JSON.parse(
        sql
          .prepare("SELECT state_json FROM field_workdays WHERE shift_id=?")
          .get("qa-field-shift").state_json,
      );
    },
    async init() {
      return getWorkday(db, member);
    },
    event(type, body = {}, seconds = 1) {
      clock += seconds * 1000;
      return {
        id: crypto.randomUUID(),
        shiftId: "qa-field-shift",
        expectedRevision: f.day.revision,
        type,
        body,
        recordedAt: new Date(clock).toISOString(),
      };
    },
    async action(type, body = {}, seconds = 1) {
      const e = f.event(type, body, seconds);
      await saveWorkdayEvent(db, member, e, clock);
      return e;
    },
    async start() {
      await f.action("clock_in", { mileage: 100, vehicle: "company" });
      for (const [key] of PRECHECKS)
        await f.action("check_item", { key, checked: true });
      await f.action("confirm_load", {
        items: [{ productId: "edf-22-12-pink-40", quantity: 1 }],
      });
      await f.action("start_route");
    },
    async photo(taskId, purpose) {
      const id = crypto.randomUUID(),
        at = new Date(clock).toISOString();
      sql
        .prepare(
          "INSERT INTO field_workday_proofs(id,shift_id,task_id,member_id,purpose,captured_at,digest,byte_size,object_key,uploaded) VALUES (?,?,?,?,?,?,?,?,?,1)",
        )
        .run(
          id,
          "qa-field-shift",
          taskId,
          member.id,
          purpose,
          at,
          "hash",
          4,
          `private/${id}.jpg`,
        );
      sql
        .prepare(
          "INSERT INTO route_partner_field_proofs(id,organization_id,task_id,object_key,content_type,byte_size,uploaded_by) VALUES (?,?,?,?,?,?,?)",
        )
        .run(
          id,
          "org-opwp",
          taskId,
          `private/${id}.jpg`,
          "image/jpeg",
          4,
          member.id,
        );
      await f.action("add_photo", { taskId, photoId: id, purpose });
      return id;
    },
    close() {
      sql.close();
    },
  };
  return f;
}
test("authenticated scoop, three kitty boxes and food complete atomically with original times and inventory", async () => {
  const f = fixture();
  await f.init();
  const change = await officeWorkdayCommand(f.db, "office", {
    action: "add_service",
    shiftId: f.day.id,
    stopId: "qa-location-1",
    serviceId: "litter",
    quantity: 3,
    notes: "Three boxes; use approved litter.",
  });
  await f.action("accept_changes", { changeIds: [change.id] });
  const litter = f.day.stops[0].tasks.find((t) => t.serviceId === "litter");
  assert.equal(litter.quantity, 3);
  assert.equal(litter.estimatedMinutes, 18);
  await f.start();
  await f.action("arrive", { stopId: "qa-location-1" });
  const arrival = f.day.stops[0].arrivedAt;
  await f.action("start_task", { taskId: "qa-scoop-task", safe: true });
  await f.photo("qa-scoop-task", "gate");
  await f.action(
    "complete_task",
    { taskId: "qa-scoop-task", secured: true, units: 1, notes: "Gate latched" },
    95,
  );
  await f.action("start_task", { taskId: litter.id, safe: true });
  await assert.rejects(
    f.action("complete_task", { taskId: litter.id, secured: true, units: 2 }),
    /required service|assigned unit/,
  );
  await f.photo(litter.id, "service");
  await assert.rejects(
    f.action("complete_task", { taskId: litter.id, secured: true, units: 2 }),
    /assigned unit/,
  );
  await f.action(
    "complete_task",
    {
      taskId: litter.id,
      secured: true,
      units: 3,
      notes: "All three boxes done",
    },
    60,
  );
  assert.equal(f.day.stops[0].arrivedAt, arrival);
  await f.action("start_break", { breakType: "unpaid", mileage: 101 });
  await f.action("end_break", { mileage: 102 }, 600);
  await f.action("arrive", { stopId: "qa-location-2" });
  await f.action("start_task", { taskId: "qa-food-task" });
  await f.photo("qa-food-task", "delivery");
  await f.action("complete_task", {
    taskId: "qa-food-task",
    secured: true,
    units: 1,
    notes: "Placed as requested",
  });
  assert.equal(
    f.sql
      .prepare(
        "SELECT delivered_quantity FROM route_partner_shift_inventory WHERE shift_id=?",
      )
      .get(f.day.id).delivered_quantity,
    1,
  );
  assert.equal(
    f.sql
      .prepare("SELECT status FROM dog_food_deliveries WHERE id=?")
      .get("qa-food-delivery").status,
    "delivered",
  );
  await f.action("start_wrap");
  for (const [key] of WRAPCHECKS)
    await f.action("check_item", { key, checked: true });
  const finish = await f.action("finish_day", {
    mileage: 110,
    items: [
      { productId: "edf-22-12-pink-40", returned: 0, damaged: 0, missing: 0 },
    ],
    notes: "Ready for tomorrow",
  });
  await saveWorkdayEvent(f.db, f.member, finish, Date.parse(finish.recordedAt));
  assert.equal(workdaySummary(f.day).unpaidSeconds, 600);
  assert.equal(workdaySummary(f.day).workMiles, 9);
  const manifests = f.sql
    .prepare("SELECT * FROM route_partner_field_closeouts")
    .all();
  assert.equal(manifests.length, 1);
  const manifest = JSON.parse(manifests[0].manifest);
  assert.equal(manifest.jobs.length, 3);
  assert.equal(manifest.writeEnabled, false);
  assert.equal(manifest.jobs.find((t) => t.serviceId === "litter").quantity, 3);
  assert.equal(
    f.sql
      .prepare("SELECT completed_at FROM route_partner_tasks WHERE id=?")
      .get("qa-scoop-task").completed_at,
    manifest.jobs.find((t) => t.serviceId === "scoop").completedAt,
  );
  f.close();
});
test("lost response retries, identifier collisions, concurrent devices and transaction rollback retain one effect", async () => {
  const f = fixture();
  await f.init();
  const e = f.event("clock_in", { mileage: 100, vehicle: "company" });
  const same = await Promise.allSettled([
    saveWorkdayEvent(f.db, f.member, e),
    saveWorkdayEvent(f.db, f.member, e),
  ]);
  assert.ok(same.every((r) => r.status === "fulfilled"));
  assert.equal(f.day.revision, 1);
  await assert.rejects(
    saveWorkdayEvent(f.db, f.member, {
      ...e,
      body: { ...e.body, mileage: 200 },
    }),
    /identifier/,
  );
  const one = f.event("check_item", { key: "tools", checked: true }),
    two = { ...one, id: crypto.randomUUID() };
  const races = await Promise.allSettled([
    saveWorkdayEvent(f.db, f.member, one),
    saveWorkdayEvent(f.db, f.member, two),
  ]);
  assert.equal(races.filter((r) => r.status === "fulfilled").length, 1);
  const before = f.day.revision;
  f.db.failWrites = true;
  await assert.rejects(f.action("check_item", { key: "bags", checked: true }));
  assert.equal(f.day.revision, before);
  assert.equal(f.day.shift.prechecks.bags, undefined);
  f.close();
});
test("cross-account/organization, reassigned routes, legacy tabs, future work and clock skew fail closed", async () => {
  const f = fixture();
  await f.init();
  const e = f.event("clock_in", { mileage: 100, vehicle: "company" });
  for (const member of [
    { ...f.member, id: "other" },
    { ...f.member, organizationId: "other" },
  ])
    await assert.rejects(saveWorkdayEvent(f.db, member, e), /not assigned/);
  assert.throws(
    () =>
      f.sql
        .prepare(
          "INSERT INTO route_partner_field_commands(id,shift_id,member_id,expected_revision,body_hash,result) VALUES (?,?,?,?,?,?)",
        )
        .run(crypto.randomUUID(), f.day.id, f.member.id, 0, "hash", "{}"),
    /UNIFIED_APP/,
  );
  await assert.rejects(
    saveWorkdayEvent(f.db, f.member, {
      ...e,
      recordedAt: "2099-01-01T12:00:00Z",
    }),
    /clock/,
  );
  const future = structuredClone(f.day);
  future.date = "2099-01-01";
  assert.throws(() => applyWorkdayEvent(future, e), /assigned service date/);
  f.sql.exec("UPDATE route_partner_route_plans SET status='superseded'");
  await assert.rejects(saveWorkdayEvent(f.db, f.member, e), /not assigned/);
  f.close();
});
test("unknown safety requires office confirmation; unsafe office update fences service before acceptance", async () => {
  const f = fixture();
  await f.init();
  await f.start();
  await f.action("arrive", { stopId: "qa-location-2" });
  const change = await officeWorkdayCommand(f.db, "office", {
    action: "safety",
    shiftId: f.day.id,
    stopId: "qa-location-2",
    safe: false,
    notes: "Customer reported a loose animal.",
  });
  await assert.rejects(
    f.action("start_task", { taskId: "qa-food-task" }),
    /unsafe access/,
  );
  await f.action("accept_changes", { changeIds: [change.id] });
  const source = structuredClone(f.day),
    food = source.stops[1].tasks[0];
  food.entryRequired = true;
  food.status = "pending";
  source.stops[1].safety = "unknown";
  assert.throws(
    () =>
      applyWorkdayEvent(source, {
        ...f.event("start_task", { taskId: food.id, safe: true }),
        expectedRevision: source.revision,
      }),
    /clearance/,
  );
  f.close();
});
test("paid treatment is server-owned and cannot be supplied through an unpaid label or client paid flag", async () => {
  const f = fixture();
  await f.init();
  await f.start();
  await f.action("start_break", {
    breakType: "unpaid",
    paid: true,
    mileage: 100,
  });
  await f.action("end_break", { mileage: 100 }, 600);
  assert.equal(f.day.shift.breaks[0].paid, false);
  assert.equal(
    workdaySummary(f.day, Date.parse(f.day.lastEventAt)).unpaidSeconds,
    600,
  );
  await assert.rejects(
    f.action("start_break", { breakType: "Unpaid lunch", mileage: 100 }),
    /choose a break/,
  );
  f.close();
});
test("private proof must be uploaded for exact service/purpose and eight-photo caps are atomic", async () => {
  const f = fixture();
  await f.init();
  await f.start();
  await f.action("arrive", { stopId: "qa-location-1" });
  await assert.rejects(
    f.action("add_photo", {
      taskId: "qa-scoop-task",
      photoId: crypto.randomUUID(),
      purpose: "gate",
    }),
    /matching private proof/,
  );
  for (let i = 0; i < 8; i++) await f.photo("qa-scoop-task", "observation");
  assert.throws(
    () =>
      f.sql
        .prepare(
          "INSERT INTO field_workday_proofs(id,shift_id,task_id,member_id,purpose,captured_at,digest,byte_size,object_key,uploaded) VALUES (?,?,?,?,?,?,?,?,?,1)",
        )
        .run(
          crypto.randomUUID(),
          f.day.id,
          "qa-scoop-task",
          f.member.id,
          "gate",
          new Date().toISOString(),
          "x",
          4,
          "extra",
        ),
    /PHOTO_LIMIT/,
  );
  f.close();
});
test("recleans remain separate visits, source billing is untouched and dispatch updates require explicit acceptance", async () => {
  const f = fixture();
  await f.init();
  await f.start();
  await f.action("skip_task", {
    taskId: "qa-scoop-task",
    reason: "Customer request",
    notes: "Requested later return",
    confirm: true,
  });
  const original = f.day.stops.length;
  const change = await officeWorkdayCommand(f.db, "office", {
    action: "reclean",
    shiftId: f.day.id,
    stopId: "qa-location-1",
    serviceId: "scoop",
    quantity: 1,
    notes: "Separate approved return",
  });
  assert.equal(f.day.stops.length, original);
  await f.action("accept_changes", { changeIds: [change.id] });
  assert.equal(f.day.stops.length, original + 1);
  const extra = f.day.stops.at(-1);
  assert.equal(extra.arrivedAt, null);
  assert.equal(extra.recleanOf, "qa-location-1");
  assert.equal(extra.tasks[0].source.jobId, null);
  assert.equal(
    f.sql.prepare("SELECT COUNT(*) n FROM route_partner_tasks").get().n,
    3,
  );
  await assert.rejects(
    officeWorkdayCommand(f.db, "office", {
      action: "add_service",
      shiftId: f.day.id,
      stopId: extra.id,
      serviceId: "food",
      quantity: 1,
      notes: "Attempt payment bypass",
    }),
    /verified order/,
  );
  f.close();
});
test("early clock-out preserves paid time and incomplete tasks in an immutable blocked closeout", async () => {
  const f = fixture();
  await f.init();
  await f.start();
  await f.action("clock_out", {
    mileage: 103,
    notes: "Vehicle breakdown; office must account for remaining work.",
  });
  assert.equal(f.day.shift.status, "finished");
  assert.ok(workdaySummary(f.day).paidSeconds > 0);
  const manifest = JSON.parse(
    f.sql.prepare("SELECT manifest FROM route_partner_field_closeouts").get()
      .manifest,
  );
  assert.equal(manifest.jobs.filter((t) => t.status === "pending").length, 2);
  assert.equal(manifest.totals.unresolvedIssues, 1);
  f.close();
});

test("recurring litter survives job changes by stable property ID, applies once and never creates a charge", async () => {
  const f = fixture();
  await f.init();
  const body = {
    action: "save_recurring",
    shiftId: f.day.id,
    stopId: "qa-location-1",
    serviceId: "litter",
    quantity: 3,
    notes: "Three approved boxes; billed through existing arrangement.",
    active: true,
    everyWeeks: 1,
    weekdays: [new Date(`${f.day.date}T12:00:00Z`).getUTCDay()],
    startDate: f.day.date,
    billingReviewed: true,
  };
  await assert.rejects(
    officeWorkdayCommand(f.db, "office", { ...body, billingReviewed: false }),
    /authorization/,
  );
  await officeWorkdayCommand(f.db, "office", body);
  assert.equal(
    f.day.stops[0].tasks.length,
    1,
    "open workday is immutable until reviewed",
  );
  f.sql.exec("DELETE FROM field_workdays");
  const opened = await f.init(),
    litter = opened.day.stops[0].tasks.find((t) => t.serviceId === "litter");
  assert.equal(litter.quantity, 3);
  assert.equal(litter.estimatedMinutes, 18);
  await f.init();
  assert.equal(
    f.sql
      .prepare(
        "SELECT COUNT(*) n FROM route_partner_tasks WHERE task_type='other'",
      )
      .get().n,
    1,
  );
  assert.equal(
    f.sql.prepare("SELECT COUNT(*) n FROM dog_food_payments").get().n,
    1,
  );
  assert.equal(
    recurringPropertyKey({
      organization_id: "1",
      client_location_id: "1",
      id: "new-job",
    }),
    recurringPropertyKey({
      organization_id: "1",
      client_location_id: "1",
      id: "old-job",
    }),
  );
  assert.equal(
    recurringPropertyKey({ name: "Same name", address: "Same address" }),
    null,
  );
  assert.equal(
    recurringDue(
      { start_date: "2026-10-12", every_weeks: 2, weekdays: "[1]" },
      "2026-10-19",
    ),
    false,
  );
  assert.equal(
    recurringDue(
      { start_date: "2026-10-12", every_weeks: 2, weekdays: "[1]" },
      "2026-10-26",
    ),
    true,
  );
  assert.throws(
    () => validateRecurring({ ...body, startDate: "2026-02-31" }, f.day.date),
    /valid recurring/,
  );
  f.close();
});

test("offline access never outlives its verified session and missing expiry fails closed", () => {
  const now = Date.parse("2026-10-13T12:00:00Z");
  assert.equal(
    offlineAccessUntil("2026-10-13 13:00:00", now),
    "2026-10-13T13:00:00.000Z",
  );
  assert.equal(
    offlineAccessUntil("2026-10-20T12:00:00Z", now),
    "2026-10-14T00:00:00.000Z",
  );
  for (const expiry of [null, "invalid", "2026-10-12T12:00:00Z"])
    assert.throws(() => offlineAccessUntil(expiry, now));
});

test("a different authenticated account cannot replay the original account device queue", () => {
  assert.doesNotThrow(() =>
    assertDeviceSession("org:member", {
      authenticated: true,
      member: { organizationId: "org", id: "member" },
    }),
  );
  for (const session of [
    { authenticated: false },
    { authenticated: true, member: { organizationId: "org", id: "other" } },
    { authenticated: true, member: { organizationId: "other", id: "member" } },
  ])
    assert.throws(
      () => assertDeviceSession("org:member", session),
      (error) => error.status === 401,
    );
});

test("office safety clearance expires and wrapping cannot accept additional visits", async () => {
  const f = fixture();
  await f.init();
  await f.start();
  await f.action("arrive", { stopId: "qa-location-1" });
  const change = await officeWorkdayCommand(f.db, "office", {
    action: "safety",
    shiftId: f.day.id,
    stopId: "qa-location-1",
    safe: true,
    hasGate: false,
    notes: "LOCAL verified no gate and safe access.",
  });
  await f.action("accept_changes", { changeIds: [change.id] });
  assert.equal(f.day.stops[0].hasGate, false);
  await assert.rejects(
    f.action("start_task", { taskId: "qa-scoop-task", safe: true }, 31 * 60),
    /clearance/,
  );
  const wrapping = structuredClone(f.day);
  wrapping.shift.status = "wrapping";
  const e = {
    ...f.event("accept_changes", { changeIds: ["new-change"] }),
    expectedRevision: wrapping.revision,
  };
  assert.throws(
    () =>
      applyWorkdayEvent(wrapping, e, {
        now: Date.parse(e.recordedAt),
        officeChanges: [
          {
            id: "new-change",
            kind: "add_visit",
            payload: { stop: structuredClone(wrapping.stops[0]) },
          },
        ],
      }),
    /wrap-up/,
  );
  f.close();
});

test("timing evidence uses completed quantity-normalized observations and excludes impossible times", () => {
  const task = {
    serviceId: "litter",
    title: "Kitty litter",
    unitLabel: "box",
    quantity: 3,
    timed: true,
    status: "completed",
    estimatedMinutes: 18,
    startedAt: "2026-10-13T12:00:00Z",
    completedAt: "2026-10-13T12:15:00Z",
  };
  const tasks = [
    ...Array.from({ length: 5 }, () => ({ ...task })),
    { ...task, status: "skipped" },
    { ...task, completedAt: "2026-10-14T12:15:00Z" },
    { ...task, completedAt: null },
  ];
  const data = workdayInsights([{ stops: [{ tasks }] }]);
  assert.equal(data.services[0].medianMinutesPerUnit, 5);
  assert.equal(data.services[0].suggestedMinutesPerUnit, 5);
  assert.equal(data.services[0].samples, 5);
  assert.equal(data.timingCoverage, 63);
  assert.deepEqual(
    reviewCloseoutIdentity(
      {
        schema: "opwp.field-closeout.v2",
        jobs: [{ sourceProvider: "opwp", sourceJobId: null }],
      },
      [],
    ),
    { matched: 0, conflicts: [], writeEnabled: false, nativeServices: 1 },
  );
});

test("early delivery callback is retained for provider acceptance reconciliation", async () => {
  const f = fixture();
  await f.init();
  const r = await recordFieldMessageReceipt(
    f.db,
    {
      id: "early",
      type: "message.delivered",
      data: {
        object: {
          id: "provider-early",
          direction: "outgoing",
          from: "+14195550111",
          createdAt: new Date().toISOString(),
        },
      },
    },
    "+14195550111",
  );
  assert.equal(r.handled, true);
  assert.equal(
    f.sql
      .prepare(
        "SELECT status FROM field_message_delivery_receipts WHERE provider_id=?",
      )
      .get("provider-early").status,
    "delivered",
  );
  f.close();
});
test("STOP/START ordering and signed-delivery processing cannot reopen a delivered message", async () => {
  const f = fixture();
  await f.init();
  await f.start();
  const at = new Date().toISOString(),
    body = (id, text, stamp = at) => ({
      id,
      type: "message.received",
      data: {
        object: {
          direction: "incoming",
          from: "+14195550123",
          to: ["+14195550111"],
          text,
          createdAt: stamp,
        },
      },
    });
  await recordFieldMessageReceipt(f.db, body("stop", "STOP"), "+14195550111");
  await recordFieldMessageReceipt(
    f.db,
    body("older", "START", "2020-01-01T00:00:00Z"),
    "+14195550111",
  );
  assert.equal(
    f.sql.prepare("SELECT suppressed FROM field_message_suppression").get()
      .suppressed,
    1,
  );
  f.sql
    .prepare(
      "INSERT INTO field_workday_messages(id,organization_id,shift_id,stop_id,kind,recipient,content,expires_at,status,provider_id) VALUES ('message','org-opwp',?,'qa-location-1','on_way','+14195550123','test',?,'accepted','provider')",
    )
    .run(f.day.id, at);
  const receipt = (id, type) => ({
    id,
    type,
    data: {
      object: {
        id: "provider",
        direction: "outgoing",
        from: "+14195550111",
        createdAt: at,
      },
    },
  });
  await recordFieldMessageReceipt(
    f.db,
    receipt("delivered", "message.delivered"),
    "+14195550111",
  );
  await recordFieldMessageReceipt(
    f.db,
    receipt("late-fail", "message.failed"),
    "+14195550111",
  );
  assert.equal(
    f.sql.prepare("SELECT status FROM field_workday_messages").get().status,
    "delivered",
  );
  f.close();
});
test("catalog accepts quantity-based litter services and bounded custom definitions without price trust", () => {
  const service = validateService({
    ...SERVICE_DEFAULTS.find((s) => s.id === "litter"),
    active: true,
    instructions: "Approved litter only",
  });
  assert.equal(
    serviceTask(service, { id: "task", quantity: 4 }).estimatedMinutes,
    24,
  );
  assert.throws(
    () => validateService({ ...service, price: 1 }),
    /stable service ID/,
  );
  assert.throws(() => serviceTask(service, { quantity: 51 }), /quantity/);
  assert.throws(
    () => validateService({ ...service, id: "food" }),
    /Food deliveries/,
  );
});
test("small travel differences can yield to workload without scattering a geographically close route", () => {
  const a = {
      day: "Monday",
      insertionMinutes: 2,
      insertionMiles: 1,
      regionDensity: 8,
      projectedMinutes: 650,
    },
    b = { ...a, day: "Tuesday", insertionMinutes: 3, projectedMinutes: 350 };
  assert.ok(compareRouteDensity(a, b) > 0);
  assert.ok(compareRouteDensity(a, { ...b, insertionMinutes: 20 }) < 0);
});
test("public offline cache excludes credentials, APIs, customer links and admin routes", () => {
  const source = fs.readFileSync(
      new URL("../public/field/sw.js", import.meta.url),
      "utf8",
    ),
    allowed = runPrivateInNewContext(source + "\nallowed", {
      self: {
        location: { origin: "https://field.test" },
        addEventListener() {},
      },
      URL,
    });
  for (const path of [
    "/api/field/workday/",
    "/admin/",
    "/field/login/",
    "/field/pilot/",
    "/field/",
  ])
    assert.equal(allowed(new URL(path, "https://field.test")), false);
  assert.equal(allowed(new URL("/field/app/", "https://field.test")), true);
  assert.equal(
    allowed(new URL("https://evil.test/_next/static/app.js")),
    false,
  );
});

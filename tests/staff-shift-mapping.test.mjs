import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import vm from "node:vm";
import { authenticateSngWebhook, validateSngWebhookBody } from "../lib/sng-webhook-security.mjs";
import { normalizeSngId } from "../lib/sng-id.mjs";
import { migrationBindings } from "./helpers/migration-bindings.mjs";

const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8");
const historical = read("../tmp/test-migrations/0030_production_hardening.sql");
const staffSchema = historical.match(/CREATE TABLE staff_integration_mappings[\s\S]*?;/)[0];
const historicalSeed = historical.match(/INSERT OR IGNORE INTO staff_integration_mappings[\s\S]*?;/)[0];
const source = (file) => read(file).replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");

function d1(sql) {
  return {
    prepare(query) {
      return {
        bind(...args) {
          const statement = sql.prepare(query);
          return {
            first: async () => statement.get(...args),
            all: async () => ({ results: statement.all(...args) }),
            run: async () => statement.run(...args),
          };
        },
      };
    },
  };
}

export function technicianRow(name, employeeId, hourlyTarget, status = "Active") {
  return { fields: {
    fldzJ3dp1dMaB4OOV: name, fldm1LpmB6lei9OBu: status,
    fld1gIEEY4uqV5KFB: employeeId, fldkuMWBflZ1sXx1J: hourlyTarget,
  } };
}

function airtableFixture(db, roster) {
  const rows = new Map();
  const patches = [];
  let time = Date.now();
  const context = vm.createContext({
    getRuntimeEnv: () => ({ DB: db, AIRTABLE_API_KEY: "test", SNG_WEBHOOK_SECRET: "fixture-secret" }),
    URLSearchParams,
    normalizeSngId,
    Date: class extends Date { static now() { return time; } },
    fetch(_url, { method, body }) {
      assert.equal(method, "PATCH");
      const { performUpsert, records } = JSON.parse(body);
      const { fields } = records[0];
      const mergeField = Object.hasOwn(fields, "Job ID") ? "Job ID" : "Record ID";
      assert.deepEqual(performUpsert.fieldsToMergeOn, [mergeField]);
      const recordId = fields[mergeField];
      patches.push(fields);
      const merged = { ...rows.get(recordId), ...fields };
      rows.set(recordId, merged);
      return Response.json({ records: [{ id: recordId, fields: merged }] });
    },
    outboundFetch(url) {
      const route = new URL(url);
      if (route.pathname === "/v0/appcAWPBQB8GmOrcT/tblhWcI09FBRuGERu") {
        roster.reads += 1;
        assert.equal(route.searchParams.get("returnFieldsByFieldId"), "true");
        assert.deepEqual(route.searchParams.getAll("fields[]"), [
          "fldzJ3dp1dMaB4OOV", "fldm1LpmB6lei9OBu", "fld1gIEEY4uqV5KFB", "fldkuMWBflZ1sXx1J",
        ]);
        if (roster.offline) return Response.json({}, { status: 503 });
        if (roster.pages && !route.searchParams.get("offset")) {
          return Response.json({ records: roster.records.slice(0, 1), offset: "next" });
        }
        return Response.json({ records: roster.pages ? roster.records.slice(1) : roster.records });
      }
      const formula = route.searchParams.get("filterByFormula");
      const [, recordId] = formula.match(/^\{(?:Record ID|Job ID)\}='([^']+)'$/);
      const fields = rows.get(recordId);
      return Response.json({ records: fields ? [{ id: recordId, fields }] : [] });
    },
  });
  const getTechnicians = vm.runInContext(source("../lib/airtable.js") + "\ngetAirtableTechnicians", context);
  return { rows, patches, context, getTechnicians, advance: ms => { time += ms; } };
}

export function webhookFixture(t, { records = [], offline = false, pages = false, baseline = null } = {}) {
  const sql = new DatabaseSync(":memory:");
  t.after(() => sql.close());
  for (const migration of ["0002_sng_events.sql", "0006_sng_processing_errors.sql"]) {
    sql.exec(read("../tmp/test-migrations/" + migration));
  }
  sql.exec(staffSchema);
  if (baseline) sql.exec(baseline);
  const roster = { reads: 0, records, offline, pages };
  const { context, rows, patches, getTechnicians, advance } = airtableFixture(d1(sql), roster);
  Object.assign(context, { crypto, Response, TextDecoder, authenticateSngWebhook, validateSngWebhookBody });
  vm.runInContext(source("../lib/db.js"), context);
  vm.runInContext(source("../lib/sng-event-processor.js"), context);
  const handler = vm.runInContext(source("../app/api/sng-webhooks/route.js") + "\nPOST", context);
  async function post(event, id, data) {
    const response = await handler(new Request("https://example.test/api/sng-webhooks/", {
      method: "POST",
      headers: { "content-type": "application/json", "x-sng-webhook-secret": "fixture-secret" },
      body: JSON.stringify({ event, id, data }),
    }));
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(result.processing.processed, true, JSON.stringify(result));
    return sql.prepare("SELECT external_id FROM sng_events WHERE id = ?").get(result.id).external_id;
  }

  const archiveClockIn = sql.prepare(
    "INSERT INTO sng_events (id, event_type, external_id, payload, status) VALUES (?, 'staff:staff_clock_in', ?, ?, 'archived')",
  );
  return { post, archiveClockIn, rows, patches, roster, getTechnicians, advance };
}

export async function checkLegacyShiftClockIn(t, shiftId, employeeId, employeeName) {
  const { post, archiveClockIn, rows, roster } = webhookFixture(t, { records: [technicianRow("Airtable Name", employeeId, 125)] });
  const clockIn = (name) => JSON.stringify({ data: { name } });
  archiveClockIn.run("legacy", shiftId + ".0", clockIn(employeeName));
  archiveClockIn.run("fractional", shiftId + ".25", clockIn("Different Technician"));

  const shift = { shift_id: shiftId, employee_id: employeeId, shift_date: "2026-11-24", duration_time: 120 };
  assert.equal(await post("payroll:shift_info", "provider-shift-event", shift), String(shiftId));
  assert.equal(rows.get(String(shiftId))["Tech Name"], employeeName);

  archiveClockIn.run("padded", " 00" + shiftId + ".00\t", clockIn("Padded Technician"));
  await post("payroll:shift_info", "provider-shift-retry", shift);
  assert.equal(rows.get(String(shiftId))["Tech Name"], "Padded Technician");

  const newId = shiftId + 1;
  assert.equal(await post("staff:staff_clock_in", "provider-clock-event", {
    shift_id: " 00" + newId + ".00 ", name: "New Clock-In Technician",
  }), String(newId));
  await post("payroll:shift_info", "new-provider-shift-event", { ...shift, shift_id: newId });
  assert.equal(rows.get(String(newId))["Tech Name"], "New Clock-In Technician");
  assert.equal(roster.reads, 0);
}

test("the webhook correlates legacy and normalized clock-ins with integer shift IDs", async (t) => {
  await checkLegacyShiftClockIn(t, 721654, 900004, "Overflow Example");
});

test("an unresolved blank-name retry updates the shift without clearing its technician", async (t) => {
  const { post, patches, rows } = webhookFixture(t);
  const data = { shift_id: 721657, employee_id: 900004, shift_date: "2026-11-24", duration_time: 120 };
  await post("payroll:shift_info", "first-shift", { ...data, employee_name: "Overflow Example" });
  for (const employeeName of ["", " \t ", null, undefined]) {
    await post("payroll:shift_info", "shift-retry", { ...data, employee_name: employeeName, duration_time: 125 });
    assert.equal(Object.hasOwn(patches.at(-1), "Tech Name"), false);
    assert.equal(rows.get("721657")["Tech Name"], "Overflow Example");
    assert.equal(rows.get("721657")["Minutes Clocked"], 125);
    assert.match(rows.get("721657").Notes, /Unmapped tech ID 900004/);
  }
  assert.equal(rows.size, 1);
});

export async function checkAirtableAttribution(t, employeeId, employeeName) {
  const { post, rows, roster, getTechnicians } = webhookFixture(t, {
    records: [technicianRow("Inactive Duplicate", employeeId, 110, "Inactive"), technicianRow(employeeName, employeeId, 125.5)],
    pages: true,
  });
  const shift = { shift_id: 721660, employee_id: employeeId + ".0", shift_date: "2026-11-24", duration_time: 120 };
  await post("payroll:shift_info", "shift-event", shift);
  assert.equal(rows.get("721660")["Tech Name"], employeeName);

  await post("job:completed", "job-event", { job_id: 721661, employee_id: employeeId, end_time: "2026-11-24T18:00:00Z" });
  assert.equal(rows.get("721661")["Tech Name"], employeeName);
  assert.equal((await getTechnicians()).find(row => row.status === "active").hourlyTarget, 125.5);
  assert.equal(roster.reads, 2, "one paginated roster read covers multiple webhooks and reporting");

  await post("payroll:shift_info", "shift-retry", { ...shift, employee_name: "Payload Technician" });
  assert.equal(rows.get("721660")["Tech Name"], "Payload Technician");
  assert.equal(roster.reads, 2);
}

test("active Airtable attribution works for payroll and jobs without a D1 mapping", async t => {
  await checkAirtableAttribution(t, 900004, "Overflow Example");
});

export async function checkTechnicianFallback(t, baseline, expectedStaff) {
  const { post, rows, roster, advance } = webhookFixture(t, {
    baseline,
    records: expectedStaff.map(([id, name]) => technicianRow("Roster " + name, id, 105)),
  });
  const [firstId, firstName] = expectedStaff[0];
  const shift = { shift_id: firstId, employee_id: firstId, shift_date: "2026-11-24", duration_time: 120 };
  await post("payroll:shift_info", "cached-roster", shift);
  assert.equal(rows.get(String(firstId))["Tech Name"], "Roster " + firstName);
  roster.offline = true;
  advance(10 * 60 * 1000);
  for (const [id, name] of expectedStaff) {
    await post("payroll:shift_info", "fallback", { ...shift, shift_id: id, employee_id: id });
    assert.equal(rows.get(String(id))["Tech Name"], name);
  }
  assert.equal(roster.reads, 2, "one failed refresh is shared during the retry cooldown");
}

test("an expired roster falls back to the existing mappings during an Airtable outage", async t => {
  await checkTechnicianFallback(t, historicalSeed, [
    [Number(migrationBindings.B029), migrationBindings.B021],
    [Number(migrationBindings.B028), migrationBindings.B019],
  ]);
});

test("unmapped completed jobs are saved and their note is added without wiping office notes or the technician", async t => {
  const { post, rows, patches } = webhookFixture(t, {
    records: [technicianRow("Inactive Technician", 900099, 100, "Inactive")],
  });
  const job = { job_id: 721662, employee_id: 900099, end_time: "2026-11-24T18:00:00Z" };
  rows.set("721662", { "Tech Name": "Recorded Technician", Notes: "Office note" });
  await post("job:completed", "unknown-job", job);
  await post("job:completed", "unknown-job-retry", job);
  assert.equal(rows.get("721662").Notes, "Office note\nUnmapped tech ID 900099");
  assert.equal(rows.get("721662")["Tech Name"], "Recorded Technician");
  assert.equal(Object.hasOwn(patches.at(-1), "Tech Name"), false);
});

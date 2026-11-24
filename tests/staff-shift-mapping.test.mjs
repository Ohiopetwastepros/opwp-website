import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import vm from "node:vm";
import { authenticateSngWebhook, validateSngWebhookBody } from "../lib/sng-webhook-security.mjs";
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

function airtableFixture(db) {
  const rows = new Map();
  const patches = [];
  const context = vm.createContext({
    getRuntimeEnv: () => ({ DB: db, AIRTABLE_API_KEY: "test", SNG_WEBHOOK_SECRET: "fixture-secret" }),
    URLSearchParams,
    fetch(_url, { method, body }) {
      assert.equal(method, "PATCH");
      const { performUpsert, records } = JSON.parse(body);
      assert.deepEqual(performUpsert.fieldsToMergeOn, ["Record ID"]);
      const { fields } = records[0];
      const recordId = fields["Record ID"];
      patches.push(fields);
      const merged = { ...rows.get(recordId), ...fields };
      rows.set(recordId, merged);
      return Response.json({ records: [{ id: recordId, fields: merged }] });
    },
    outboundFetch(url) {
      const formula = new URL(url).searchParams.get("filterByFormula");
      const [, recordId] = formula.match(/^\{Record ID\}='([^']+)'$/);
      const fields = rows.get(recordId);
      return Response.json({ records: fields ? [{ id: recordId, fields }] : [] });
    },
  });
  const functions = vm.runInContext(source("../lib/airtable.js") + "\n({ mappedEmployeeName, upsertSngShift })", context);
  return { ...functions, rows, patches, context };
}

export async function checkStaffShiftMapping(sqlSeed, expectedStaff, baselineSeed = historicalSeed) {
  const sql = new DatabaseSync(":memory:");
  try {
    sql.exec(staffSchema);
    sql.exec(baselineSeed);
    sql.exec(sqlSeed);
    sql.exec(sqlSeed);
    assert.equal(sql.prepare("SELECT count(*) AS count FROM staff_integration_mappings").get().count, 4);

    const { mappedEmployeeName, upsertSngShift, rows } = airtableFixture(d1(sql));
    for (const [employeeId, expectedName] of expectedStaff) {
      assert.equal(await mappedEmployeeName(employeeId), expectedName);
      const shift = { shift_id: employeeId, employee_id: employeeId, employee_name: " \t ", shift_date: "2026-11-24", duration_time: 120 };
      const result = await upsertSngShift({ data: shift });
      assert.equal(result.verification.verified, true);
      assert.equal(rows.get(String(employeeId))["Tech Name"], expectedName);
      assert.equal(rows.get(String(employeeId))["Minutes Clocked"], 120);
    }
  } finally {
    sql.close();
  }
}

function webhookFixture(t) {
  const sql = new DatabaseSync(":memory:");
  t.after(() => sql.close());
  for (const migration of ["0002_sng_events.sql", "0006_sng_processing_errors.sql"]) {
    sql.exec(read("../tmp/test-migrations/" + migration));
  }
  sql.exec(staffSchema);
  const { context, rows, patches } = airtableFixture(d1(sql));
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
  return { post, archiveClockIn, rows, patches };
}

export async function checkLegacyShiftClockIn(t, shiftId, employeeId, employeeName) {
  const { post, archiveClockIn, rows } = webhookFixture(t);
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
  }
  assert.equal(rows.size, 1);
});

test("the overflow seed is idempotent and attributes shifts alongside the existing staff", async () => {
  await checkStaffShiftMapping(read("../tmp/test-migrations/0070_staff_shift_mapping.sql"), [
    [900004, "Overflow Example"],
    [Number(migrationBindings.B029), migrationBindings.B021],
    [Number(migrationBindings.B028), migrationBindings.B019],
  ]);
});

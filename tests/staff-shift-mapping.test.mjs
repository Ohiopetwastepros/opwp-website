import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import vm from "node:vm";
import { migrationBindings } from "./helpers/migration-bindings.mjs";

const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8");
const historical = read("../tmp/test-migrations/0030_production_hardening.sql");
const staffSchema = historical.match(/CREATE TABLE staff_integration_mappings[\s\S]*?;/)[0];
const historicalSeed = historical.match(/INSERT OR IGNORE INTO staff_integration_mappings[\s\S]*?;/)[0];
const airtableSource = read("../lib/airtable.js").replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");

export async function checkStaffShiftMapping(sqlSeed, expectedStaff, baselineSeed = historicalSeed) {
  const sql = new DatabaseSync(":memory:");
  try {
    sql.exec(staffSchema);
    sql.exec(baselineSeed);
    sql.exec(sqlSeed);
    sql.exec(sqlSeed);
    assert.equal(sql.prepare("SELECT count(*) AS count FROM staff_integration_mappings").get().count, 4);

    const db = {
      prepare(query) {
        return { bind: (id) => ({ first: async () => sql.prepare(query).get(id) }) };
      },
    };
    let records;
    const { mappedEmployeeName, upsertSngShift } = vm.runInNewContext(
      airtableSource + "\n({ mappedEmployeeName, upsertSngShift })",
      {
        getRuntimeEnv: () => ({ DB: db, AIRTABLE_API_KEY: "test" }),
        URLSearchParams,
        fetch(_url, { method, body }) {
          assert.equal(method, "PATCH");
          records = JSON.parse(body).records;
          return Response.json({ records: [{ id: "test-record" }] });
        },
        outboundFetch: () => Response.json({ records }),
      },
    );

    for (const [employeeId, expectedName] of expectedStaff) {
      assert.equal(await mappedEmployeeName(employeeId), expectedName);
      const shift = { shift_id: employeeId, employee_id: employeeId, shift_date: "2026-11-24", duration_time: 120 };
      const result = await upsertSngShift({ data: shift });
      assert.equal(result.verification.verified, true);
      assert.equal(records[0].fields["Tech Name"], expectedName);
      assert.equal(records[0].fields["Minutes Clocked"], 120);
    }
  } finally {
    sql.close();
  }
}

test("the overflow seed is idempotent and attributes shifts alongside the existing staff", async () => {
  await checkStaffShiftMapping(read("../tmp/test-migrations/0070_staff_shift_mapping.sql"), [
    [900004, "Overflow Example"],
    [Number(migrationBindings.B029), migrationBindings.B021],
    [Number(migrationBindings.B028), migrationBindings.B019],
  ]);
});

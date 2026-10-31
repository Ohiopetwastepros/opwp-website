import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function reconcile(airtableCustomers, activeSngClients, clientsWithoutSubscription = []) {
  const source = readFileSync(new URL("../lib/sweepandgo.js", import.meta.url), "utf8")
    .replace(/^import .*;\r?\n/gm, "")
    .replace(/^export /gm, "");
  const result = runPrivateInNewContext(`${source}\nbuildSubscriptionReconciliation(airtableCustomers, activeSngClients, clientsWithoutSubscription);`, { airtableCustomers, activeSngClients, clientsWithoutSubscription });
  return JSON.parse(JSON.stringify(result));
}

test("routing conflicts distinguish an exact SNG match from an active Airtable-only customer", () => {
  const result = reconcile(
    [
      { name: "Example Match", status: "Active", sngClientId: "" },
      { name: "Jeff Example", status: "Active", sngClientId: "" },
    ],
    [{ client_id: "rcl_exact", client_name: "Example Match", cleanup_frequency: "weekly" }],
    [],
  );
  assert.equal(result.missingSngId.length, 2);
  assert.deepEqual(result.missingSngId[0], {
    name: "Example Match",
    sngClientId: "rcl_exact",
    issue: "Airtable SNG Client ID is blank",
    action: "Add the exact-match SNG Client ID",
  });
  assert.deepEqual(result.missingSngId[1], {
    name: "Jeff Example",
    sngClientId: "",
    issue: "Active in Airtable with no matching SNG client",
    action: "Confirm service status; create in SNG or mark inactive in Airtable",
  });
});

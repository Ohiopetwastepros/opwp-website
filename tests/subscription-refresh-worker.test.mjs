import staffPrivate from '../lib/staff-private.json' with {type:'json'};
import assert from "node:assert/strict";
import test from "node:test";
import { syncAirtableServiceSchedules } from "../lib/subscription-refresh-worker.js";
import { isEasternMidnight, isUtcHour } from "../lib/scheduled-time.mjs";

test("midnight scheduling follows Eastern daylight and standard time", () => {
  assert.equal(isEasternMidnight(Date.parse("2026-08-29T04:00:00Z")), true);
  assert.equal(isEasternMidnight(Date.parse("2026-08-29T05:00:00Z")), false);
  assert.equal(isEasternMidnight(Date.parse("2026-12-15T05:00:00Z")), true);
  assert.equal(isEasternMidnight(Date.parse("2026-12-15T04:00:00Z")), false);
  assert.equal(isUtcHour(Date.parse("2026-08-29T11:00:00Z"), 11), true);
});

test("active SNG clients reactivate existing Airtable customers and create missing customers", async () => {
  const originalFetch = globalThis.fetch;
  const writes = [];
  globalThis.fetch = async (_url, options = {}) => {
    if (!options.method) {
      return Response.json({
        records: [
          {
            id: "recKatelyn",
            fields: {
              "Client Name": "Example Client A",
              Status: "Inactive",
              "SNG Client ID": 4,
              Frequency: "Weekly",
              "Service Day": "Thursday",
            },
          },
        ],
      });
    }
    writes.push({ method: options.method, body: JSON.parse(options.body) });
    return Response.json({ records: [] });
  };

  try {
    const result = await syncAirtableServiceSchedules(
      { AIRTABLE_API_KEY: "test-key" },
      [
        { client_id: 4, client_name: "Example Client A", cleanup_frequency: "weekly", service_days: ["Thursday"] },
        { client_id: 5, client_name: "Example Client B", cleanup_frequency: "weekly", service_days: ["Tuesday"], address: "1203 Example Lane.", city: "Toledo", zip: "43617" },
        { client_id: 6, client_name: "Example Client C", cleanup_frequency: "biweekly", service_days: ["Thursday"], address: "1204 Example Lane", city: "Toledo", zip: "43613" },
      ]
    );

    assert.equal(result.updated, 1);
    assert.equal(result.created, 2);
    const patch = writes.find((write) => write.method === "PATCH");
    assert.equal(patch.body.records[0].fields.Status, "Active");
    const post = writes.find((write) => write.method === "POST");
    assert.deepEqual(post.body.records.map((record) => record.fields["Client Name"]), ["Example Client B", "Example Client C"]);
    assert.ok(post.body.records.every((record) => record.fields.Status === "Active"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("SNG schedule fields are copied exactly, stale secondary fields are cleared, and technicians map by day", async () => {
  const originalFetch = globalThis.fetch;
  const writes = [];
  globalThis.fetch = async (_url, options = {}) => {
    if (!options.method) {
      return Response.json({
        records: [
          {
            id: "recTwiceWeekly",
            fields: {
              "Client Name": "Example Client D",
              Status: "Active",
              Frequency: "Twice Weekly",
              "Service Day": "Friday",
              "Service Day 2": "Thursday",
              "Assigned Tech": (staffPrivate.reliefName + ", " + staffPrivate.primaryName),
              "Assigned Tech 2": "",
            },
          },
          {
            id: "recWeekly",
            fields: {
              "Client Name": "Dana Example",
              Status: "Active",
              Frequency: "Biweekly",
              "Service Day": "Monday",
              "Service Day 2": "Thursday",
              "Assigned Tech": staffPrivate.primaryName,
              "Assigned Tech 2": staffPrivate.primaryName,
            },
          },
        ],
      });
    }
    writes.push({ method: options.method, body: JSON.parse(options.body) });
    return Response.json({ records: [] });
  };

  try {
    const result = await syncAirtableServiceSchedules(
      { AIRTABLE_API_KEY: "test-key" },
      [
        { client_name: "Example Client D", cleanup_frequency: "two_times_a_week", service_days: "Monday, Friday", assigned_to: (staffPrivate.reliefName + ", " + staffPrivate.primaryName) },
        { client_name: "Dana Example", cleanup_frequency: "bi_weekly", service_days: "Friday", assigned_to: staffPrivate.primaryName },
      ],
    );

    assert.equal(result.updated, 2);
    const patch = writes.find((write) => write.method === "PATCH");
    const twiceWeekly = patch.body.records.find((record) => record.id === "recTwiceWeekly").fields;
    assert.equal(twiceWeekly["Service Day"], "Monday");
    assert.equal(twiceWeekly["Service Day 2"], "Friday");
    assert.equal(twiceWeekly["Assigned Tech"], staffPrivate.reliefName);
    assert.equal(twiceWeekly["Assigned Tech 2"], staffPrivate.primaryName);
    const weekly = patch.body.records.find((record) => record.id === "recWeekly").fields;
    assert.equal(weekly["Service Day"], "Friday");
    assert.equal(weekly["Service Day 2"], null);
    assert.equal(weekly["Assigned Tech 2"], null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("daily reconciliation fills customer profile and active subscription fields from current SNG data", async () => {
  const originalFetch = globalThis.fetch;
  const writes = [];
  globalThis.fetch = async (_url, options = {}) => {
    if (!options.method) {
      return Response.json({
        records: [{
          id: "recAmanda",
          fields: {
            "Client Name": "Amanda Example",
            Status: "Active",
            "SNG Client ID": "rcl_amanda",
            Frequency: "Twice Weekly",
            Address: "633 state st unit 55, Elmore, Ohio 43416",
          },
        }],
      });
    }
    writes.push({ method: options.method, body: JSON.parse(options.body) });
    return Response.json({ records: [] });
  };

  const active = [{
    client: "rcl_amanda",
    client_name: "Amanda Example",
    address: "633 state st unit 55, Elmore, Ohio 43416",
    cleanup_frequency: "two_times_a_week",
    service_days: "Monday, Friday",
  }];
  const subscriptions = [
    { client: { id: "rcl_amanda", full_name: "Amanda Example", address: active[0].address }, status: "active", service_plan: "1d-2xW", category: "prepaid", billing_interval: "monthly", price: 162 },
    { client: { id: "rcl_amanda", full_name: "Amanda Example", address: active[0].address }, status: "active", service_plan: "Sanitization Treatment 1 per month", category: "prepaid", billing_interval: "monthly", price: 30 },
  ];

  try {
    const result = await syncAirtableServiceSchedules({ AIRTABLE_API_KEY: "test-key" }, active, subscriptions);
    assert.equal(result.updated, 1);
    const fields = writes.find((write) => write.method === "PATCH").body.records[0].fields;
    assert.deepEqual(fields, {
      Type: "Residential",
      Address: "633 state st unit 55",
      City: "Elmore",
      ZIP: "43416",
      "Number of Dogs": 1,
      "Subscription Name": "Regular Plan - 1d-2xW",
      "MRR ($)": 192,
      "Service Day": "Monday",
      "Service Day 2": "Friday",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("complete subscription reconciliation deactivates Airtable customers without a current core plan", async () => {
  const originalFetch = globalThis.fetch;
  const writes = [];
  const names = ["One", "Two", "Three", "Four"];
  globalThis.fetch = async (_url, options = {}) => {
    if (!options.method) {
      return Response.json({
        records: [
          ...names.map((name) => ({ id: `rec${name}`, fields: { "Client Name": name, Status: "Active", Type: "Residential" } })),
          { id: "recStale", fields: { "Client Name": "Stale Customer", Status: "Active", Type: "Residential" } },
        ],
      });
    }
    writes.push({ method: options.method, body: JSON.parse(options.body) });
    return Response.json({ records: [] });
  };
  const subscriptions = names.map((name) => ({ client_name: name, status: "active", service_plan: "1d-1xW", category: "prepaid", billing_interval: "monthly", price: 80 }));

  try {
    await syncAirtableServiceSchedules({ AIRTABLE_API_KEY: "test-key" }, [], subscriptions);
    const patched = writes.flatMap((write) => write.body.records);
    assert.deepEqual(patched.find((record) => record.id === "recStale").fields, { Status: "Inactive" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

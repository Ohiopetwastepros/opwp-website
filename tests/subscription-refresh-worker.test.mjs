import assert from "node:assert/strict";
import test from "node:test";
import { syncAirtableServiceSchedules } from "../lib/subscription-refresh-worker.js";

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
              "Client Name": "Katelyn Dunbar",
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
        { client_id: 4, client_name: "Katelyn Dunbar", cleanup_frequency: "weekly", service_days: ["Thursday"] },
        { client_id: 5, client_name: "Mary Clifford", cleanup_frequency: "weekly", service_days: ["Tuesday"], address: "2634 Stoneleigh Dr.", city: "Toledo", zip: "43617" },
        { client_id: 6, client_name: "Tom Kleinert", cleanup_frequency: "biweekly", service_days: ["Thursday"], address: "2244 Berdan Ave", city: "Toledo", zip: "43613" },
      ]
    );

    assert.equal(result.updated, 1);
    assert.equal(result.created, 2);
    const patch = writes.find((write) => write.method === "PATCH");
    assert.equal(patch.body.records[0].fields.Status, "Active");
    const post = writes.find((write) => write.method === "POST");
    assert.deepEqual(post.body.records.map((record) => record.fields["Client Name"]), ["Mary Clifford", "Tom Kleinert"]);
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
              "Client Name": "Brandi Bennington",
              Status: "Active",
              Frequency: "Twice Weekly",
              "Service Day": "Friday",
              "Service Day 2": "Thursday",
              "Assigned Tech": "Craig Bridgman, Tony Bridgman",
              "Assigned Tech 2": "",
            },
          },
          {
            id: "recWeekly",
            fields: {
              "Client Name": "Dana Mocek",
              Status: "Active",
              Frequency: "Biweekly",
              "Service Day": "Monday",
              "Service Day 2": "Thursday",
              "Assigned Tech": "Tony Bridgman",
              "Assigned Tech 2": "Tony Bridgman",
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
        { client_name: "Brandi Bennington", cleanup_frequency: "two_times_a_week", service_days: "Monday, Friday", assigned_to: "Craig Bridgman, Tony Bridgman" },
        { client_name: "Dana Mocek", cleanup_frequency: "bi_weekly", service_days: "Friday", assigned_to: "Tony Bridgman" },
      ],
    );

    assert.equal(result.updated, 2);
    const patch = writes.find((write) => write.method === "PATCH");
    const twiceWeekly = patch.body.records.find((record) => record.id === "recTwiceWeekly").fields;
    assert.equal(twiceWeekly["Service Day"], "Monday");
    assert.equal(twiceWeekly["Service Day 2"], "Friday");
    assert.equal(twiceWeekly["Assigned Tech"], "Craig Bridgman");
    assert.equal(twiceWeekly["Assigned Tech 2"], "Tony Bridgman");
    const weekly = patch.body.records.find((record) => record.id === "recWeekly").fields;
    assert.equal(weekly["Service Day"], "Friday");
    assert.equal(weekly["Service Day 2"], null);
    assert.equal(weekly["Assigned Tech 2"], null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

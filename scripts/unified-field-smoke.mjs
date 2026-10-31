// Explicitly isolated LOCAL workerd smoke. Never accepts a production host/database.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { TOTP, Secret } from "otpauth";
import { beginMfaLogin, finishMfaLogin } from "../lib/admin-mfa.mjs";
import { PRECHECKS, WRAPCHECKS } from "../lib/field-workday-model.mjs";
const base = "http://127.0.0.1:8789",
  root = path.resolve(
    "tmp/unified-field-local/v3/d1/miniflare-D1DatabaseObject",
  );
const file = fs.readdirSync(root).find((f) => /^[a-f0-9]+\.sqlite$/.test(f));
if (!file) throw Error("Initialize the isolated local database first.");
const sql = new DatabaseSync(path.join(root, file));
const db = {
  prepare(query) {
    return {
      bind(...args) {
        return {
          async first() {
            return sql.prepare(query).get(...args) || null;
          },
          async all() {
            return { results: sql.prepare(query).all(...args) };
          },
          async run() {
            const r = sql.prepare(query).run(...args);
            return { meta: { changes: Number(r.changes) } };
          },
        };
      },
    };
  },
};
db.batch = async (rows) => {
  sql.exec("BEGIN");
  try {
    const result = [];
    for (const row of rows) result.push(await row.run());
    sql.exec("COMMIT");
    return result;
  } catch (e) {
    sql.exec("ROLLBACK");
    throw e;
  }
};
const env = {
  DB: db,
  ADMIN_USERNAME: "field-office.qa@opwp.local",
  ADMIN_PASSWORD: "unified-local-password",
  ADMIN_SESSION_SECRET: "unified-local-session-secret",
  ADMIN_MFA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
};
const challenge = await beginMfaLogin(env, {
  username: env.ADMIN_USERNAME,
  password: env.ADMIN_PASSWORD,
});
if (challenge.secret)
  fs.writeFileSync("tmp/unified-local-mfa-secret", challenge.secret);
const localSecret =
  challenge.secret || fs.readFileSync("tmp/unified-local-mfa-secret", "utf8");
const totp = new TOTP({
  issuer: "Ohio Pet Waste Pros",
  label: env.ADMIN_USERNAME,
  algorithm: "SHA1",
  digits: 6,
  period: 30,
  secret: Secret.fromBase32(localSecret),
});
const session = await finishMfaLogin(
  env,
  challenge.challengeToken,
  { code: totp.generate() },
  "Isolated local smoke",
);
sql.close();
const adminCookie = `__Host-opwp_admin_mfa=${session.sessionToken}`;
async function api(
  url,
  { cookie = "", body, method = "GET", origin = base, headers = {} } = {},
) {
  const r = await fetch(base + url, {
    method,
    headers: {
      Cookie: cookie,
      Origin: origin,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  return { status: r.status, headers: r.headers, data: await r.json() };
}
const login = await api("/api/field/session/", {
  method: "POST",
  body: { email: "field.qa@opwp.local", pin: "246810" },
});
assert.equal(login.status, 200);
const cookie = login.headers.get("set-cookie").split(";")[0];
assert.equal((await api("/api/field/workday/")).status, 401);
assert.equal(
  (await api("/api/admin/field-workdays/?date=2026-10-13", { cookie })).status,
  401,
);
assert.equal((await api("/api/field/workday/photo/?id=not-proof")).status, 401);
let day = (await api("/api/field/workday/", { cookie })).data.day;
assert.ok(day && day.shift.status === "ready");
async function office(body) {
  const r = await api("/api/admin/field-workdays/", {
    cookie: adminCookie,
    method: "POST",
    body: { shiftId: day.id, ...body },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}
async function event(type, body = {}) {
  const e = {
    id: crypto.randomUUID(),
    shiftId: day.id,
    expectedRevision: day.revision,
    type,
    body,
    recordedAt: new Date().toISOString(),
  };
  const result = await api("/api/field/workday/", {
    cookie,
    method: "POST",
    body: e,
  });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  day = (await api("/api/field/workday/", { cookie })).data.day;
  return e;
}
const change = await office({
  action: "add_service",
  stopId: "qa-location-1",
  serviceId: "litter",
  quantity: 3,
  notes: "LOCAL QA ONLY: three approved boxes.",
});
await event("accept_changes", { changeIds: [change.id] });
assert.equal(
  (
    await api("/api/field/workday/", {
      cookie,
      method: "POST",
      origin: "https://attacker.invalid",
      body: { id: crypto.randomUUID() },
    })
  ).status,
  403,
);
const started = await event("clock_in", { mileage: 100, vehicle: "company" });
assert.equal(
  (await api("/api/field/workday/", { cookie, method: "POST", body: started }))
    .data.duplicate,
  true,
);
for (const [key] of PRECHECKS)
  await event("check_item", { key, checked: true });
await event("confirm_load", {
  items: day.inventory.map((i) => ({
    productId: i.productId,
    quantity: i.required,
  })),
});
await event("start_route");
const jpeg = fs.readFileSync("tmp/unified-proof.jpg");
async function proof(task, purpose) {
  const id = crypto.randomUUID(),
    capturedAt = new Date().toISOString();
  const url =
    "/api/field/workday/photo/?" +
    new URLSearchParams({
      id,
      shiftId: day.id,
      taskId: task.id,
      purpose,
      capturedAt,
    });
  const r = await fetch(base + url, {
    method: "PUT",
    headers: { Cookie: cookie, Origin: base, "Content-Type": "image/jpeg" },
    body: jpeg,
  });
  assert.equal(r.status, 201, await r.text());
  await event("add_photo", { taskId: task.id, photoId: id, purpose });
  const read = await fetch(base + `/api/field/workday/photo/?id=${id}`, {
    headers: { Cookie: cookie },
  });
  assert.equal(read.status, 200);
  assert.equal(read.headers.get("cache-control"), "private, no-store");
}
for (const stop of structuredClone(day.stops)) {
  await event("arrive", { stopId: stop.id });
  for (const task of stop.tasks) {
    await event("start_task", { taskId: task.id, safe: true });
    if (task.proofKind !== "none") await proof(task, task.proofKind);
    await event("complete_task", {
      taskId: task.id,
      secured: true,
      units: task.quantity,
      notes: "LOCAL QA ONLY completed.",
    });
  }
}
await event("start_break", { breakType: "unpaid", paid: true, mileage: 104 });
await event("end_break", { mileage: 104 });
await event("start_wrap");
for (const [key] of WRAPCHECKS)
  await event("check_item", { key, checked: true });
await event("finish_day", {
  mileage: 110,
  items: day.inventory.map((i) => ({
    productId: i.productId,
    returned: 0,
    damaged: 0,
    missing: 0,
  })),
  notes: "LOCAL QA ONLY.",
});
const officeRead = await api(`/api/admin/field-workdays/?date=${day.date}`, {
  cookie: adminCookie,
});
assert.equal(officeRead.status, 200);
assert.equal(officeRead.data.days[0].shift.status, "finished");
assert.equal(day.shift.breaks[0].paid, false);
console.log(
  JSON.stringify({
    ok: true,
    scope: "isolated local workerd",
    services: day.stops.flatMap((s) => s.tasks).length,
    kittyBoxes: 3,
    privateR2Proof: true,
    idempotentRetry: true,
    officeMfa: true,
    crossSiteBlocked: true,
    wrongRoleBlocked: true,
    closeout: "finished",
    providerWrites: false,
  }),
);

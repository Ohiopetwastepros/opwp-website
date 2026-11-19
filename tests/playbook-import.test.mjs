import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { redactPlaybookText, redactPlaybookSlots, hashExternalRef } from "../lib/playbook-redaction.mjs";
import { outputFolder, RUN_IMPORT, assertDryRun, readJson, quoPages, graphPages, activeDatasetFiles, jsonlWriter, phoneKey } from "../scripts/playbook-import/common.mjs";
import { threadClassification, resolveImportAuthor, importQuo } from "../scripts/playbook-import/quo.mjs";
import { importMeta } from "../scripts/playbook-import/meta.mjs";
import { localUsageStore, mineTurns } from "../scripts/playbook-import/mine.mjs";
import { runImports } from "../scripts/playbook-import/run.mjs";
const sourceText = (folder, source) => fs.readFileSync(activeDatasetFiles(folder).find(item => item.source === source).filename, "utf8");

test("learning redacts identities and keeps structured operational slots only", async () => {
  const result = redactPlaybookText("Hi Alice. Alice Example: alice@example.test, +1 (555) 555-0101, 1234 Example Street. Weekly is $95.", { names: ["Alice Example", "Alice"] });
  for (const value of ["Alice", "alice@example", "555", "1234"]) assert.equal(result.includes(value), false);
  assert.ok(result.includes("$95"));
  assert.equal(redactPlaybookText("my name is alice example. address is 719 w example").includes("719"), false);
  const unknown = redactPlaybookText("Meet Jane Example at 12 Broadway. Review https://example.test/admin/playbook/d/private-token/ now.");
  for (const privateText of ["Jane", "Example", "12", "Broadway", "private-token"]) assert.equal(unknown.includes(privateText), false, privateText);
  assert.deepEqual(redactPlaybookSlots({ name: "Alice", email: "a@example.test", address: "1234 Example St", phone: "5555550101", dogs: 2 }), { dogs: 2 });
  assert.equal((await hashExternalRef("5555550101", "a".repeat(32))).length, 64);
  assert.notEqual(await hashExternalRef("5555550101", "a".repeat(32)), await hashExternalRef("5555550101", "b".repeat(32)));
  await assert.rejects(hashExternalRef("5555550101", ""));
});

test("import output and API transport cannot escape the read-only dry-run boundary", async () => {
  assert.throws(() => outputFolder(os.tmpdir()));
  assert.throws(() => assertDryRun({ apply: true }));
  await assert.rejects(readJson("https://example.test/v1/messages"));
  const waits = [], methods = [];
  let attempts = 0;
  assert.deepEqual(await readJson("https://api.quo.com/v1/conversations", { authorization: "fake", sleep: async value => waits.push(value), fetcher: async (_, init) => { methods.push(init.method); return ++attempts === 1 ? new Response("", { status: 429, headers: { "retry-after": "1" } }) : Response.json({ data: [] }); } }), { data: [] });
  assert.deepEqual(methods, ["GET", "GET"]); assert.deepEqual(waits, [1000]);
});

test("Quo pagination preserves repeated participants and rejects repeated cursors", async () => {
  const urls = [];
  const api = { authorization: "fake", fetcher: async url => { urls.push(url); return Response.json({ data: [], nextPageToken: urls.length === 1 ? "cursor" : null }); } };
  for await (const ignored of quoPages("/v1/messages", { participants: ["+15555550101", "+15555550102"] }, api)) assert.deepEqual(ignored, []);
  assert.deepEqual(urls[0].searchParams.getAll("participants"), ["+15555550101", "+15555550102"]);
  assert.equal(urls[1].searchParams.get("pageToken"), "cursor");
  await assert.rejects(async () => { for await (const ignored of quoPages("/v1/messages", {}, { authorization: "fake", fetcher: async () => Response.json({ data: [], nextPageToken: "same" }) })) void ignored; }, /repeated/);
  await assert.rejects(async () => { for await (const ignored of graphPages("/v27.0/me/permissions", {}, { authorization: "fake", fetcher: async () => Response.json({ data: [], paging: { next: "https://example.test/leak" } }) })) void ignored; }, /origin/);
});

test("mining excludes staff/vendor/service-only customer threads and unknown authors stay Sona", () => {
  const phone = "+15555550101", incoming = [{ direction: "incoming", text: "I need a quote for pet waste cleanup", createdAt: "2026-01-01" }];
  assert.equal(threadClassification([phone], incoming, new Map()).keep, true);
  for (const kind of ["staff", "vendors"]) assert.equal(threadClassification([phone], incoming, new Map([["5555550101", { kind }]])).keep, false);
  assert.equal(threadClassification([phone], [{ direction: "incoming", text: "Please skip my service" }], new Map([["5555550101", { kind: "customers" }]])).keep, false);
  assert.equal(resolveImportAuthor({ direction: "outgoing", userId: "unknown" }), "sona");
  assert.equal(resolveImportAuthor({ direction: "outgoing", userId: "human" }, { humanIds: ["human"] }), "craig");
  assert.equal(resolveImportAuthor({ direction: "outgoing", id: "draft" }, { backendIds: ["draft"] }), "backend");
});

test("missing API credentials generate honest skipped reports without a network call", async () => {
  const folder = path.join(RUN_IMPORT, "test-skipped-" + crypto.randomUUID());
  try {
    const quo = await importQuo({ output: folder }, { env: {} }), meta = await importMeta({ output: folder }, { env: {} });
    assert.equal(quo.status, "skipped"); assert.equal(meta.permissions.status, "not_checked");
    assert.equal(quo.sources.quo_2371.kept, 0); assert.equal(meta.sources.meta_messenger.kept, 0);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test("Quo history importer redacts retained sales turns and enforces line/thread membership", async () => {
  const folder = path.join(RUN_IMPORT, "test-quo-" + crypto.randomUUID()), calls = [];
  fs.mkdirSync(folder, { recursive: true });
  const identities = path.join(folder, "identities.json");
  fs.writeFileSync(identities, JSON.stringify({ leads: [{ phone: "+15555550101", name: "Alice Example" }] }));
  try {
    const report = await importQuo({ output: folder, identities }, { env: { QUO_API_KEY: "fake", QUO_BUSINESS_PHONE_NUMBER_ID: "PNbusinessExample", QUO_INDUSTRY_PHONE_NUMBER_ID: "PNindustryExample", QUO_HUMAN_USER_IDS: "human" }, api: { fetcher: async (url, init) => {
      calls.push(init.method);
      if (url.pathname === "/v1/conversations") return Response.json({ data: url.searchParams.get("phoneNumbers") === "PNbusinessExample" ? [{ id: "thread", phoneNumberId: "PNbusinessExample", participants: ["+15555550101"] }] : [], nextPageToken: null });
      return Response.json({ data: [{ id: "m1", phoneNumberId: "PNbusinessExample", conversationId: "thread", direction: "incoming", from: "+15555550101", to: ["+15555550102"], text: "I need a pet waste quote. Alice Example, alice@example.test", createdAt: "2026-01-01" }, { id: "m2", phoneNumberId: "wrong-line", conversationId: "thread", direction: "incoming", from: "+15555550101", to: [], text: "never import this", createdAt: "2026-01-01" }], nextPageToken: null });
    } } });
    assert.equal(report.sources.quo_2371.kept, 1); assert.equal(report.sources.quo_2371.turns, 1);
    const output = sourceText(folder, "quo_2371");
    for (const forbidden of ["Alice", "alice@example", "555555", "never import"]) assert.equal(output.includes(forbidden), false);
    assert.equal(calls.every(method => method === "GET"), true);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test("Meta import reads permission scope and separately paginates messages without writes", async () => {
  const folder = path.join(RUN_IMPORT, "test-meta-" + crypto.randomUUID()), calls = [];
  try {
    const scopes = ["leads_retrieval", "pages_read_engagement", "pages_messaging", "pages_manage_metadata", "instagram_basic", "instagram_manage_messages"];
    const report = await importMeta({ output: folder }, { env: { META_PAGE_ACCESS_TOKEN: "fake", META_GRAPH_API_VERSION: "v27.0", META_ALLOWED_PAGE_IDS: "1", META_INSTAGRAM_ACCOUNT_ID: "3", META_LEAD_FORM_IDS: "2" }, api: { fetcher: async (url, init) => {
      calls.push({ path: url.pathname, method: init.method });
      if (url.pathname.endsWith("/permissions")) return Response.json({ data: scopes.map(permission => ({ permission, status: "granted" })) });
      if (url.pathname.endsWith("/leads")) return Response.json({ data: [{ id: "lead", created_time: "2026-01-01", field_data: [{ name: "full_name", values: ["Alice Example"] }, { name: "phone_number", values: ["+15555550101"] }, { name: "dogs", values: ["1"] }] }] });
      if (url.pathname.endsWith("/conversations")) return Response.json({ data: [{ id: url.searchParams.get("platform") + "_thread", participants: { data: [{ id: "person", name: "Alice Example" }] } }] });
      return Response.json({ data: [{ id: url.pathname, from: { id: "person", name: "Alice Example" }, message: "Alice Example at alice@example.test", created_time: "2026-01-01" }], paging: {} });
    } } });
    assert.equal(report.permissions.status, "checked"); assert.deepEqual(report.permissions.missing, []);
    assert.equal(report.sources.meta_messenger.turns, 1); assert.equal(report.sources.meta_instagram.turns, 1);
    assert.ok(calls.some(call => call.path.endsWith("/messenger_thread/messages")));
    const output = sourceText(folder, "meta_leadgen") + sourceText(folder, "meta_messenger");
    for (const forbidden of ["Alice", "alice@example", "555555"]) assert.equal(output.includes(forbidden), false);
    assert.equal(calls.every(call => call.method === "GET"), true);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test("local classifier durable claims share a hard daily cap across connections", async () => {
  const folder = path.join(RUN_IMPORT, "test-cap-" + crypto.randomUUID()), a = await localUsageStore(folder), b = await localUsageStore(folder);
  try {
    assert.equal(await a.claim({ usageDate: "2026-01-01", provider: "fake", cap: 1, id: "a", estimatedInputTokens: 20 }), true);
    assert.equal(await b.claim({ usageDate: "2026-01-01", provider: "fake", cap: 1, id: "b", estimatedInputTokens: 20 }), false);
    assert.equal(b.totals().calls, 1);
  } finally { a.close(); b.close(); fs.rmSync(folder, { recursive: true, force: true }); }
});

test("miner pairs only Craig answers, clusters support per thread, records wins and violations", async () => {
  const turns = [];
  for (const thread of ["a", "b"]) turns.push({ id: thread + "1", thread_id: thread, author: "lead", body_redacted: "It is too expensive", created_at: "2026-01-01T00:00:00Z" }, { id: thread + "2", thread_id: thread, author: "craig", body_redacted: "We can offer $15 off your first full month.", created_at: "2026-01-01T00:01:00Z" }, { id: thread + "3", thread_id: thread, author: "lead", body_redacted: "I am ready to sign up", created_at: "2026-01-01T00:02:00Z" });
  turns.push({ id: "s1", thread_id: "sona", author: "lead", body_redacted: "It is too expensive", created_at: "2026-01-01" }, { id: "s2", thread_id: "sona", author: "sona", body_redacted: "A different answer", created_at: "2026-01-02" });
  const result = await mineTurns(turns);
  assert.equal(result.candidates.length, 1); assert.equal(result.candidates[0].support_count, 2); assert.equal(result.candidates[0].win_rate, 1);
  assert.ok(result.candidates[0].rule_violations_json.includes("missing_stop_footer"));
  assert.equal(result.candidates[0].status, "pending_review");
});

test("temporary need manual replies preserve empathy as review examples and flag early pricing", async () => {
  const result = await mineTurns([{ id: "t1", thread_id: "temp", author: "lead", body_redacted: "Yes I had surgery and need service for a few months", created_at: "2026-01-01" }, { id: "t2", thread_id: "temp", author: "craig", body_redacted: "I hope recovery goes well. It is $95 a month and month to month, cancel anytime.", created_at: "2026-01-02" }]);
  assert.equal(result.candidates.length, 1); assert.equal(result.candidates[0].intent, "question_contract");
  assert.equal(result.candidates[0].source, "approved_edit");
  assert.ok(result.candidates[0].rule_violations_json.includes("unapproved_price_text"));
});

test("iPhone importer reads only allowlisted business chats, denylist wins, and output contains no raw numbers", () => {
  const folder = path.join(RUN_IMPORT, "test-iphone-" + crypto.randomUUID());
  fs.mkdirSync(folder, { recursive: true });
  const source = path.join(folder, "copied-fake.db"), db = new DatabaseSync(source);
  try {
    db.exec("CREATE TABLE chat(chat_identifier TEXT); CREATE TABLE handle(id TEXT); CREATE TABLE message(text TEXT,attributedBody BLOB,is_from_me INTEGER,date INTEGER); CREATE TABLE chat_handle_join(chat_id INTEGER,handle_id INTEGER); CREATE TABLE chat_message_join(chat_id INTEGER,message_id INTEGER)");
    for (let id = 1; id <= 5; id++) {
      db.prepare("INSERT INTO chat(ROWID,chat_identifier) VALUES(?,?)").run(id, "fake-chat-" + id);
      db.prepare("INSERT INTO handle(ROWID,id) VALUES(?,?)").run(id, "+1555555010" + id);
      db.prepare("INSERT INTO chat_handle_join VALUES(?,?)").run(id, id);
      db.prepare("INSERT INTO message(ROWID,text,is_from_me,date) VALUES(?,?,0,1)").run(id, "My number is +1555555010" + id + " and email alice@example.test at 1234 Example Street");
      db.prepare("INSERT INTO chat_message_join VALUES(?,?)").run(id, id);
    }
    db.exec("INSERT INTO chat_handle_join VALUES(4,2),(5,2)");
    const text = "Do you provide weekly service?", attributed = Buffer.concat([Buffer.from("streamtypedNSString\x01+", "binary"), Buffer.from([text.length]), Buffer.from(text)]);
    db.prepare("INSERT INTO message(ROWID,text,attributedBody,is_from_me,date) VALUES(6,NULL,?,1,2)").run(attributed);
    db.exec("INSERT INTO chat_message_join VALUES(1,6)");
  } finally { db.close(); }
  const allow = path.join(folder, "allowlist.json"), deny = path.join(folder, "denylist.json");
  fs.writeFileSync(allow, JSON.stringify({ phones: ["+15555550101", "+15555550103", "+15555550104"], groups: ["fake-chat-5"] }));
  fs.writeFileSync(deny, JSON.stringify({ phones: ["+15555550103"] }));
  const digest = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex"), before = digest(source);
  const executable = process.env.PLAYBOOK_TEST_PYTHON || (process.platform === "win32" ? "python" : "python3");
  try {
    const result = spawnSync(executable, ["scripts/playbook-import/iphone-sms.py", source, "--output", folder, "--allowlist", allow, "--denylist", deny], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    const report = JSON.parse(result.stdout);
    assert.equal(report.kept, 2); assert.equal(report.dropped, 3); assert.equal(report.turns, 3);
    assert.deepEqual(report.reasons, { not_business_allowlisted: 1, personal_denylist: 1, group_not_allowlisted: 1 });
    const output = sourceText(folder, "iphone_backup");
    for (const identity of ["555555", "1234", "alice@example"]) assert.equal(output.includes(identity), false);
    assert.ok(output.includes("Do you provide weekly service?")); assert.equal(digest(source), before);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test("strict phone matching cannot admit international or email handles by suffix collision", () => {
  assert.equal(phoneKey("+15555550101"), "5555550101");
  assert.equal(phoneKey("(555) 555-0101"), "5555550101");
  for (const value of ["+445555550101", "person5555550101@example.test", "+5555550101", "1234567890123455555550101"]) assert.equal(phoneKey(value), "", value);
});

test("aggregate skipped sources exclude stale JSONL and prior iPhone reports while preserving archives", async () => {
  const folder = path.join(RUN_IMPORT, "test-stale-" + crypto.randomUUID());
  fs.mkdirSync(folder, { recursive: true });
  try {
    const legacy = path.join(folder, "quo_2371.jsonl");
    fs.writeFileSync(legacy, "old legacy history must stay archived\n");
    jsonlWriter(folder, "quo_2371")({ id: "old", thread_id: "old", source: "quo_2371", author: "lead", body_redacted: "How much is service?", created_at: "2026-01-01" });
    const previousDataset = activeDatasetFiles(folder)[0].filename;
    fs.writeFileSync(path.join(folder, "iphone-report.json"), JSON.stringify({ source: "iphone_backup", status: "complete", kept: 500 }));
    const report = await runImports({ output: folder }, { env: {} });
    assert.equal(report.sources.quo.status, "skipped"); assert.equal(report.sources.meta.status, "skipped"); assert.equal(report.sources.iphone.status, "skipped");
    assert.equal(report.sources.iphone.kept, 0); assert.equal(report.sources.mining.turns, 0); assert.deepEqual(report.sources.mining.activeSources, []);
    assert.equal(activeDatasetFiles(folder).length, 0);
    assert.ok(fs.existsSync(previousDataset)); assert.equal(fs.readFileSync(legacy, "utf8"), "old legacy history must stay archived\n");
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test("iPhone exact handle admission and denial do not share US phone suffixes and use identity redaction context", () => {
  const folder = path.join(RUN_IMPORT, "test-iphone-identity-" + crypto.randomUUID());
  fs.mkdirSync(folder, { recursive: true });
  const source = path.join(folder, "copied-fake.db"), db = new DatabaseSync(source);
  try {
    db.exec("CREATE TABLE chat(chat_identifier TEXT); CREATE TABLE handle(id TEXT); CREATE TABLE message(text TEXT,attributedBody BLOB,is_from_me INTEGER,date INTEGER); CREATE TABLE chat_handle_join(chat_id INTEGER,handle_id INTEGER); CREATE TABLE chat_message_join(chat_id INTEGER,message_id INTEGER)");
    const handles = ["+15555550101", "+445555550101", "person5555550101@example.test", "allowed@example.test", "denied@example.test"];
    for (let index = 0; index < handles.length; index++) {
      const id = index + 1;
      db.prepare("INSERT INTO chat(ROWID,chat_identifier) VALUES(?,?)").run(id, "identity-chat-" + id);
      db.prepare("INSERT INTO handle(ROWID,id) VALUES(?,?)").run(id, handles[index]); db.prepare("INSERT INTO chat_handle_join VALUES(?,?)").run(id, id);
      db.prepare("INSERT INTO message(ROWID,text,is_from_me,date) VALUES(?,?,0,1)").run(id, "Meet Jane Example at 12 Broadway. Known doorstep: Cedar Cottage. Contact Jane at unusual_alias@example.test https://example.test/admin/playbook/d/secret-capability/");
      db.prepare("INSERT INTO chat_message_join VALUES(?,?)").run(id, id);
    }
  } finally { db.close(); }
  const allow = path.join(folder, "allow.json"), deny = path.join(folder, "deny.json"), identities = path.join(folder, "identities.json");
  fs.writeFileSync(allow, JSON.stringify({ phones: ["+15555550101"], handles: ["allowed@example.test", "denied@example.test"] }));
  fs.writeFileSync(deny, JSON.stringify({ handles: ["denied@example.test"] }));
  fs.writeFileSync(identities, JSON.stringify({ leads: [{ phone: "+15555550101", name: "Jane Example", address: "Cedar Cottage", email: "unusual_alias@example.test" }] }));
  const executable = process.env.PLAYBOOK_TEST_PYTHON || (process.platform === "win32" ? "python" : "python3");
  try {
    const result = spawnSync(executable, ["scripts/playbook-import/iphone-sms.py", source, "--output", folder, "--allowlist", allow, "--denylist", deny, "--identities", identities], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    const report = JSON.parse(result.stdout);
    assert.equal(report.kept, 2); assert.equal(report.dropped, 3); assert.equal(report.reasons.not_business_allowlisted, 2); assert.equal(report.reasons.personal_denylist, 1);
    const output = sourceText(folder, "iphone_backup").trim().split("\n").map(line => JSON.parse(line).body_redacted).join("\n");
    for (const value of ["Jane", "Example", "12", "Broadway", "Cedar Cottage", "unusual_alias", "secret-capability", "5555550101", "allowed@example"]) assert.equal(output.includes(value), false, value);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

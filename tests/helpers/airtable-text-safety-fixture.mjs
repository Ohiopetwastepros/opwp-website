// Dependency injection for tests of unrelated state/transport behavior. Tests
// of the authoritative guard use mocked Airtable HTTP responses instead.
export async function verifiedTextSafety() {
  return {verified: true, doNotText: false, records: [], reason: "airtable_verified", checkedAt: new Date().toISOString()};
}

export function withVerifiedTextSafety(api) {
  return {...api,
    actOnPlaybookDraft: (db, env, id, command, actor, options = {}) => api.actOnPlaybookDraft(db, env, id, command, actor, {textSafety: verifiedTextSafety, ...options}),
    sendVerifiedPlaybookDraft: (db, env, id, options = {}) => api.sendVerifiedPlaybookDraft(db, env, id, {textSafety: verifiedTextSafety, ...options}),
  };
}

export const safetyTables = ["tblhi8MGUOsWNmd37", "tblxniDSLBZdba6Z7"].map((id, index) => ({
  id, name: index ? "Meta Leads" : "Customers", fields: [
    {id: `fldPhoneFixture0${index}`, name: "Phone", type: "phoneNumber"},
    {id: `fldDoNotText0000${index}`, name: "Do Not Text", type: "checkbox"},
    {id: `fldTextStatus000${index}`, name: "Text Status", type: "singleSelect", options: {choices: ["OK", "Asked to stop", "Opted out in Quo", "Text failed", "No reply"].map(name => ({name}))}},
    {id: `fldStatusNotes00${index}`, name: "Text Status Notes", type: "multilineText"},
  ],
}));

const metaFields = [
  ["Meta Lead ID", "singleLineText"], ["Name", "singleLineText"], ["Email", "email"], ["ZIP", "singleLineText"], ["Town", "singleLineText"],
  ["Lead Date", "date"], ["Form", "singleSelect", ["v1", "v2"]], ["Source", "singleLineText"],
  ["Lead Status", "singleSelect", ["New", "Texted", "Replied", "Quoted", "Signed up", "Not interested", "Former client", "Junk"]],
  ["Converted", "checkbox"], ["Linked Customer", "multipleRecordLinks"], ["Last Contact", "date"], ["Follow-up Date", "date"], ["Notes", "multilineText"],
].map(([name, type, choices], index) => ({id: `fld${String(index + 100).padStart(14, "0")}`, name, type,
  ...(choices ? {options: {choices: choices.map(name => ({name}))}} : {})}));

// A future-compatible local Meta schema includes the explicitly requested notes
// field. The production missing-field finding is documented separately.
export function createAirtableContactFixture() {
  const tables = structuredClone(safetyTables);
  tables[1].fields.push(...metaFields);
  const records = new Map(tables.map(table => [table.id, []])), writes = [];
  let sequence = 0;
  const names = table => new Map(table.fields.map(field => [field.id, field.name]));
  const normalize = (table, fields) => Object.fromEntries(Object.entries(fields || {}).map(([key, value]) => [names(table).get(key) || key, value]));
  const view = (table, record, url, body = {}) => {
    const byId = url.searchParams.get("returnFieldsByFieldId") === "true" || body.returnFieldsByFieldId === true;
    const selected = url.searchParams.getAll("fields[]");
    return {id: record.id, fields: Object.fromEntries(Object.entries(record.fields).flatMap(([name, value]) => {
      const field = table.fields.find(field => field.name === name);
      if (selected.length && !selected.includes(name) && !selected.includes(field?.id)) return [];
      return [[byId && field ? field.id : name, value]];
    }))};
  };
  function fetcher(input, options = {}) {
    const url = new URL(String(input)), method = options.method || "GET";
    if (url.origin !== "https://api.airtable.com") return undefined;
    if (/^\/v0\/meta\/bases\/[^/]+\/tables$/.test(url.pathname) && method === "GET") return Response.json({tables});
    const table = tables.find(table => url.pathname === `/v0/appcAWPBQB8GmOrcT/${table.id}` || url.pathname.startsWith(`/v0/appcAWPBQB8GmOrcT/${table.id}/`));
    if (!table) return undefined;
    const rows = records.get(table.id), id = url.pathname.split("/")[4];
    if (method === "GET") {
      if (id) {
        const record = rows.find(record => record.id === id);
        return record ? Response.json(view(table, record, url)) : Response.json({}, {status: 404});
      }
      const formula = url.searchParams.get("filterByFormula") || "";
      const sourceKey = formula.match(/\{Meta Lead ID\}='([^']+)'/)?.[1];
      const number = formula.match(/="(1?\d{10})"/)?.[1];
      const filtered = rows.filter(record => sourceKey ? record.fields["Meta Lead ID"] === sourceKey : number ?
        String(record.fields.Phone || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "") === number.replace(/^1(?=\d{10}$)/, "") : true);
      return Response.json({records: filtered.map(record => view(table, record, url))});
    }
    if (!["POST", "PATCH"].includes(method)) return undefined;
    const body = JSON.parse(options.body), inputs = body.records || [{id, fields: body.fields}];
    const changed = inputs.map(item => {
      let record = rows.find(record => record.id === (id || item.id));
      if (!record && body.performUpsert?.fieldsToMergeOn) {
        const normalized = normalize(table, item.fields);
        record = rows.find(record => body.performUpsert.fieldsToMergeOn.every(name => record.fields[name] === normalized[name]));
      }
      if (!record) {
        record = {id: `rec${String(++sequence).padStart(14, "0")}`, fields: {}};
        rows.push(record);
      }
      Object.assign(record.fields, normalize(table, item.fields));
      writes.push({tableId: table.id, method, id: record.id, fields: structuredClone(record.fields)});
      return view(table, record, url, body);
    });
    return Response.json(body.records ? {records: changed} : changed[0]);
  }
  return {fetcher, tables, records, writes};
}

// Return undefined for other endpoints so each parent fixture still rejects
// unexpected calls. Empty complete lists represent verified, opted-in contacts.
export function mockAirtableSafetyRead(input, options = {}) {
  const url = new URL(String(input));
  if (url.origin !== "https://api.airtable.com" || (options.method || "GET") !== "GET") return undefined;
  if (/^\/v0\/meta\/bases\/[^/]+\/tables$/.test(url.pathname)) return Response.json({tables: safetyTables});
  if (safetyTables.some(table => url.pathname === `/v0/appcAWPBQB8GmOrcT/${table.id}`)) return Response.json({records: []});
  return undefined;
}

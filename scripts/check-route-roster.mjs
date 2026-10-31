import fs from 'node:fs/promises';
// Read-only comparison, with local output kept under ignored tmp/.
const source = await fs.readFile('.dev.vars', 'utf8');
const key = process.env.AIRTABLE_TOKEN || source.match(/^AIRTABLE_API_KEY\s*=\s*["']?([^\r\n"']+)/m)?.[1];
if (!key) throw new Error('Airtable credentials unavailable');
const d1 = JSON.parse((await fs.readFile('tmp/route-audit/d1.json', 'utf8')).replace(/^\uFEFF/, ''))[0].results[0];
const stored = JSON.parse(d1.customers);
const rows = [];
let offset;
for (let page = 0; page < 50; page++) {
  const params = new URLSearchParams({ pageSize: '100' });
  if (offset) params.set('offset', offset);
  const response = await fetch(`https://api.airtable.com/v0/appcAWPBQB8GmOrcT/tblhi8MGUOsWNmd37?${params}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`Airtable returned ${response.status}`);
  const data = await response.json();
  rows.push(...data.records);
  offset = data.offset;
  if (!offset) break;
}
if (offset) throw new Error('Incomplete Airtable pagination');
await fs.writeFile('tmp/route-audit/airtable.json', JSON.stringify(rows));
const fields = ['SNG Client ID', 'Status', 'Frequency', 'Service Day', 'Service Day 2', 'Assigned Tech', 'Assigned Tech 2', 'Address', 'City', 'ZIP', 'Est. Service Minutes'];
const differences = [];
const cached = new Map(stored.map(r => [r.id, r]));
for (const row of rows) {
  const prior = cached.get(row.id);
  if (!prior) { differences.push({ customer: row.fields['Client Name'], field: 'missing_from_d1' }); continue; }
  for (const field of fields) if (String(row.fields[field] ?? '') !== String(prior.fields[field] ?? '')) differences.push({ customer: row.fields['Client Name'], field, airtable: row.fields[field], d1: prior.fields[field] });
}
for (const row of stored) if (!rows.some(r => r.id === row.id)) differences.push({ customer: row.fields['Client Name'], field: 'removed_from_airtable' });
const report = { checkedAt: new Date().toISOString(), snapshotAt: d1.captured_at, airtable: rows.length, d1: stored.length, activeAirtable: rows.filter(r => r.fields.Status === 'Active').length, differences };
await fs.writeFile('tmp/route-audit/roster-comparison.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

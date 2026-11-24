const cities = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').slice(0, 100);
const timestamp = value => Date.parse(String(value || '').replace(' ', 'T') + (/Z$|[+-]\d\d:\d\d$/.test(String(value || '')) ? '' : 'Z'));

// Read the source-owned snapshot. Never refresh, import, or send customer data
// to a model just to answer an area question.
export async function loadPlaybookServiceAreaFacts(db, {now = new Date()} = {}) {
  try {
    const row = await db.prepare("SELECT payload,status,captured_at FROM airtable_cockpit_snapshots WHERE snapshot_key='business_cockpit'").first();
    const at = timestamp(row?.captured_at), age = new Date(now).getTime() - at;
    if (row?.status !== 'success' || !Number.isFinite(age) || age < -60000 || age > 86400000) return {statusHealthy:false,activeClientTowns:[],activeClientZips:[]};
    const payload = JSON.parse(row.payload), records = payload?.opwp?.customers;
    if (!Array.isArray(records)) return {statusHealthy:false,activeClientTowns:[],activeClientZips:[]};
    const active = records.filter(record => String(record?.fields?.Status || '').trim().toLowerCase() === 'active');
    const towns = [...new Set(active.map(record => cities(record.fields.City)).filter(Boolean))].sort();
    const zips = [...new Set(active.map(record => String(record.fields.ZIP || '').trim().match(/^\d{5}/)?.[0]).filter(Boolean))].sort();
    return {statusHealthy:true,sourceSnapshotAt:new Date(at).toISOString(),activeClientTowns:towns,activeClientZips:zips};
  } catch { return {statusHealthy:false,activeClientTowns:[],activeClientZips:[]}; }
}

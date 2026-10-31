const BASE=`WITH leads AS (
  SELECT s.id,s.created_at,g.outcome_reason reason,
    CASE WHEN s.source='facebook' THEN 'meta' WHEN s.source='quo' THEN 'quo' WHEN s.source='website' AND s.kind='partial_quote' THEN 'website_quotes' ELSE 'other' END source,
    CASE WHEN s.lifecycle_stage='converted' OR (s.kind='onboarding' AND s.sng_sync_state='succeeded') OR i.signed_up_at IS NOT NULL THEN 'won' ELSE COALESCE(g.stage,'new') END stage,
    CASE WHEN s.lifecycle_stage='converted' OR (s.kind='onboarding' AND s.sng_sync_state='succeeded') OR i.signed_up_at IS NOT NULL THEN 1 ELSE 0 END signedUp,
    CASE WHEN i.paid_at IS NOT NULL THEN 1 ELSE 0 END paid,
    CASE WHEN g.stage='quoted' OR i.quoted_at IS NOT NULL OR json_extract(CASE WHEN json_valid(w.payload) THEN w.payload ELSE '{}' END,'$.quoteSentAt') IS NOT NULL THEN 1 ELSE 0 END quoted,
    CASE WHEN g.outcome_reason='duplicate' OR i.duplicate_of IS NOT NULL THEN 1 ELSE 0 END duplicate,
    (SELECT MIN(m.created_at) FROM lead_messages m JOIN lead_conversations c ON c.id=m.conversation_id WHERE c.submission_id=s.id AND c.organization_id='org-opwp' AND m.organization_id='org-opwp' AND m.direction='outbound' AND m.delivery_status IN ('sent','delivered')) firstResponse
  FROM submissions s
  LEFT JOIN growth_leads g ON g.submission_id=s.id AND g.organization_id='org-opwp'
  LEFT JOIN meta_lead_intakes i ON i.submission_id=s.id AND i.organization_id='org-opwp'
  LEFT JOIN airtable_cockpit_snapshots w ON w.snapshot_key=('lead_workspace:org-opwp:'||s.id)
  WHERE s.kind IN ('partial_quote','question','waitlist','onboarding') AND s.status!='deleted' AND COALESCE(g.outcome_reason,'')!='not_a_lead'
    AND NOT EXISTS(SELECT 1 FROM growth_leads x WHERE x.submission_id=s.id AND x.organization_id!='org-opwp')
    AND NOT EXISTS(SELECT 1 FROM lead_conversations x WHERE x.submission_id=s.id AND (x.organization_id!='org-opwp' OR x.status='deleted'))
    AND NOT EXISTS(SELECT 1 FROM submissions original JOIN airtable_cockpit_snapshots ow ON ow.snapshot_key=('lead_workspace:org-opwp:'||original.id) WHERE original.id!=s.id AND original.funnel_id=s.funnel_id AND original.status!='deleted' AND s.kind IN ('partial_quote','onboarding') AND json_extract(ow.payload,'$.handoffPreparedAt') IS NOT NULL)
    AND (s.kind!='onboarding' OR s.funnel_id IS NULL OR NOT EXISTS(SELECT 1 FROM submissions q WHERE q.kind='partial_quote' AND q.funnel_id=s.funnel_id AND q.status!='deleted'))
    AND (?=0 OR datetime(s.created_at)>=datetime('now',?))
)`;
const measures=`COUNT(*) total,SUM(CASE WHEN stage='won' THEN 1 ELSE 0 END) won,SUM(CASE WHEN stage NOT IN ('won','lost','not_qualified') THEN 1 ELSE 0 END) open,SUM(signedUp) signedUp,SUM(paid) paid,SUM(quoted) quoted,SUM(CASE WHEN stage IN ('won','lost','not_qualified') THEN 1 ELSE 0 END) closed`;
export async function readLeadReport(db,days=90){
  if(![0,30,90,365].includes(days))throw new Error('Invalid report period.');
  const [totals,sources,reasons,duplicates]=await db.batch([
    db.prepare(BASE+` SELECT ${measures},SUM(CASE WHEN firstResponse IS NOT NULL THEN 1 ELSE 0 END) responseCount,AVG(CASE WHEN julianday(firstResponse)>=julianday(created_at) THEN (julianday(firstResponse)-julianday(created_at))*1440 END) averageResponseMinutes FROM leads WHERE duplicate=0`).bind(days,`-${days} days`),
    db.prepare(BASE+` SELECT source,${measures} FROM leads WHERE duplicate=0 GROUP BY source ORDER BY total DESC`).bind(days,`-${days} days`),
    db.prepare(BASE+` SELECT COALESCE(reason,'unrecorded') reason,COUNT(*) count FROM leads WHERE stage IN ('lost','not_qualified') GROUP BY reason ORDER BY count DESC`).bind(days,`-${days} days`),
    db.prepare(BASE+` SELECT COUNT(*) count FROM leads WHERE duplicate=1`).bind(days,`-${days} days`),
  ]);
  const row=totals.results?.[0]||{};
  return {...Object.fromEntries(['total','open','won','signedUp','paid','quoted','closed','responseCount'].map(k=>[k,Number(row[k]||0)])),averageResponseMinutes:row.averageResponseMinutes==null?null:Math.round(row.averageResponseMinutes),sources:(sources.results||[]).map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,k==='source'?v:Number(v||0)]))),reasons:reasons.results||[],duplicates:Number(duplicates.results?.[0]?.count||0),days,capturedAt:new Date().toISOString()};
}

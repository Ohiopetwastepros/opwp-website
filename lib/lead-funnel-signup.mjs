import {funnelDigest,funnelTime,funnelJobKey} from './lead-funnel-policy.mjs';
import {FunnelError} from './lead-funnel-admin.mjs';

export async function createFunnelRouteToken(db,leadId,{now=Date.now()}={}) {
  const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('');
  await db.prepare(`INSERT INTO airtable_cockpit_snapshots(snapshot_key,payload,status,captured_at) VALUES (?,?,'success',CURRENT_TIMESTAMP)`)
    .bind('lead_route_token:'+await funnelDigest(token),JSON.stringify({leadId,expiresAt:new Date(now+24*3600000).toISOString()})).run();
  return token;
}
export async function saveFunnelSignupAddress(db,token,input,{now=Date.now()}={}) {
  if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))throw new FunnelError('Your quote link is unavailable.',403);
  const stored=await db.prepare(`SELECT json_extract(payload,'$.leadId') id,json_extract(payload,'$.expiresAt') expires FROM airtable_cockpit_snapshots WHERE snapshot_key=?`).bind('lead_route_token:'+await funnelDigest(token)).first();
  if(!stored || funnelTime(stored.expires)<=now)throw new FunnelError('Your quote link has expired. Refresh your quote.',410);
  const address=String(input.address||'').trim(),city=String(input.city||'').trim(),state=String(input.state||'').trim(),zip=String(input.zip||'').trim();
  if(address.length<5 || address.length>200 || city.length<2 || city.length>80 || !['OH','MI'].includes(state) || !/^\d{5}$/.test(zip) || /[\u0000-\u001f]/.test(address+city))throw new FunnelError('Enter a valid service address.');
  // This capability can update only the address supplied by its own prospect.
  // It grants no read access to the lead, existing customers, consent or payment.
  const patch={home_address:address,city,state,zip};
  const results=await db.batch([db.prepare(`UPDATE submissions SET payload=json_patch(payload,?),zip=?,last_activity_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND status IN ('new','follow_up_pending') AND EXISTS(SELECT 1 FROM airtable_cockpit_snapshots WHERE snapshot_key=?)
    AND NOT EXISTS(SELECT 1 FROM growth_leads g WHERE g.submission_id=submissions.id AND (g.organization_id!='org-opwp' OR g.stage IN ('won','lost','not_qualified')))`)
    .bind(JSON.stringify(patch),zip,stored.id,funnelJobKey(stored.id)),
    db.prepare(`UPDATE airtable_cockpit_snapshots SET payload=json_remove(payload,'$.route','$.routeInputHash'),updated_at=CURRENT_TIMESTAMP WHERE snapshot_key=?
      AND EXISTS(SELECT 1 FROM submissions WHERE id=? AND status IN ('new','follow_up_pending'))`).bind(funnelJobKey(stored.id),stored.id),
  ]);
  if(!results[0].meta?.changes)throw new FunnelError('This quote is no longer open.',409);
  const row=await db.prepare(`SELECT payload FROM submissions WHERE id=?`).bind(stored.id).first();
  return {leadId:stored.id,body:JSON.parse(row.payload)};
}

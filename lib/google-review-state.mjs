import { normalizeReviewIdentity, matchGoogleReviews } from './google-review-matching.mjs';

export const GOOGLE_REVIEW_AUDIT_KEY = 'google_review_audit_v1';
export const GOOGLE_REVIEW_DECISIONS_KEY = 'google_review_decisions_v1';
export async function getGoogleReviewDecisions(db) {
  if (!db) throw new Error('Review decision storage is unavailable.');
  const row=await db.prepare('SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key=?').bind(GOOGLE_REVIEW_DECISIONS_KEY).first();
  return row?.payload ? JSON.parse(row.payload) : {reviews:{},updatedAt:''};
}

export function buildGoogleReviewAudit(records, reviews, result, { source = 'google_api', now = new Date().toISOString() } = {}) {
  const verified = new Set(result.matches.map(match => match.record.id));
  const clients = records.filter(record => record.fields['Client Type'] !== 'Unmatched review');
  return {
    source, capturedAt: now, reviewCount: reviews.length,
    verifiedRecordIds: [...verified],
    unmatched: result.unmatched, ambiguous: result.ambiguous,
    ignored: result.ignored || [], reviewMatches: result.reviewMatches || [],
    reviews: reviews.slice(0,1000).map(review=>({reviewId:String(review.reviewId || '').slice(0,200),reviewer:{displayName:String(review.reviewer?.displayName || 'Anonymous').slice(0,100)},starRating:review.starRating,createTime:review.createTime || '',updateTime:review.updateTime || '',comment:String(review.comment || '').slice(0,4000)})),
    alternateNames: result.matches.filter(match => normalizeReviewIdentity(match.record.fields['Client Name']) !== normalizeReviewIdentity(match.review.reviewer?.displayName))
      .map(match => ({ recordId: match.record.id, customer: match.record.fields['Client Name'], reviewer: match.review.reviewer.displayName })),
    completedNotVerified: clients.filter(record => record.fields['Google Review'] === 'Reviewed' && !verified.has(record.id))
      .map(record => ({ recordId: record.id, customer: record.fields['Client Name'], reviewer: record.fields['Review Name'] || '' })),
  };
}

export async function saveGoogleReviewAudit(db, audit) {
  if (!db) return;
  await db.prepare(`INSERT INTO airtable_cockpit_snapshots (snapshot_key,payload,status,captured_at,updated_at)
    VALUES (?,?,'success',?,CURRENT_TIMESTAMP) ON CONFLICT(snapshot_key) DO UPDATE SET
    payload=excluded.payload,status=excluded.status,captured_at=excluded.captured_at,updated_at=CURRENT_TIMESTAMP`)
    .bind(GOOGLE_REVIEW_AUDIT_KEY, JSON.stringify(audit), audit.capturedAt).run();
}

export async function refreshSavedReviewAudit(db) {
  const [prior,snapshot,decisions]=await Promise.all([
    db.prepare('SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key=?').bind(GOOGLE_REVIEW_AUDIT_KEY).first(),
    db.prepare("SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key='business_cockpit'").first(),
    getGoogleReviewDecisions(db),
  ]);
  if(!prior?.payload||!snapshot?.payload)return;
  const old=JSON.parse(prior.payload),records=JSON.parse(snapshot.payload)?.opwp?.reviewTracker;
  if(old.source!=='google_api'||!Array.isArray(old.reviews)||!Array.isArray(records))return;
  const result=matchGoogleReviews(records,old.reviews,decisions.reviews);
  await saveGoogleReviewAudit(db,{...buildGoogleReviewAudit(records,old.reviews,result,{now:old.capturedAt}),resolvedAt:new Date().toISOString()});
}

export async function getGoogleReviewHealth(db, env = {}) {
  const configured = ['GOOGLE_BUSINESS_CLIENT_ID','GOOGLE_BUSINESS_CLIENT_SECRET','GOOGLE_BUSINESS_REFRESH_TOKEN','GOOGLE_BUSINESS_LOCATION'].every(name => Boolean(env[name]));
  if (!db) return { configured, latest: null, audit: null };
  const [latest, row] = await Promise.all([
    db.prepare("SELECT status,error,completed_at FROM system_sync_runs WHERE sync_name='google_reviews' ORDER BY started_at DESC LIMIT 1").first(),
    db.prepare('SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key=?').bind(GOOGLE_REVIEW_AUDIT_KEY).first(),
  ]);
  let audit = null;
  try { audit = row?.payload ? JSON.parse(row.payload) : null; } catch { /* Missing evidence must never imply verification. */ }
  return { configured, latest: latest || null, audit };
}

export function reviewSyncNotice(health = {}, now = Date.now()) {
  if (!health.configured) return { warning: true, text: 'Automatic Google review checking is not connected. Airtable updates can still reach this page, but new Google reviews are not checked until Business Profile authorization is completed.' };
  if (health.latest?.status !== 'success') return { warning: true, text: 'Google review sync needs attention. ' + (health.latest?.error || 'No successful check is recorded.') };
  const captured = health.audit?.source === 'google_api' ? Date.parse(health.audit.capturedAt) : NaN;
  if (!Number.isFinite(captured) || now - captured > 2 * 3600000) return { warning: true, text: 'Automatic Google review evidence is stale or unavailable. The last verified review decisions are preserved.' };
  return { warning: false, text: 'Google reviews are checked hourly and matched to customer names and saved aliases. Airtable and this page refresh after each check. Unrecognized or conflicting names need verification below.' };
}

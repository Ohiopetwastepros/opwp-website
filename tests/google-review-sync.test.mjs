import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { matchGoogleReviews } from '../lib/google-review-matching.mjs';
import { buildReviewTrackerRoster } from '../lib/review-tracker-roster.mjs';
import { buildGoogleReviewAudit, reviewSyncNotice } from '../lib/google-review-state.mjs';

const source = fs.readFileSync(new URL('../lib/google-review-sync.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const client = { id: 'rec12345678901234', fields: { 'Client Name': "Allen Example", 'Client Type': 'Recurring', 'Google Review': 'Not reviewed', 'Google Review Aliases': "Mitch Example" } };
const review = { reviewId: 'google-1', reviewer: { displayName: "Mitch Example" }, starRating: 'FIVE' };

function runtime({ pages = 1, failRoster = false, google = false, failGoogle = false } = {}) {
  const writes = [], runs = [], audits = [];
  let jobPages = 0, cockpit = 0;
  const fetch = async (input, options = {}) => {
    const url = new URL(input);
    if (url.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'test-token' });
    if (url.hostname === 'mybusiness.googleapis.com') return Response.json(failGoogle ? {} : { reviews: [review] }, { status: failGoogle ? 403 : 200 });
    const table = url.pathname.split('/').at(-1);
    if (options.method) { writes.push(JSON.parse(options.body)); return Response.json({ records: JSON.parse(options.body).records }); }
    if (table === 'tbls15v5OYexAIULc') {
      assert.deepEqual(url.searchParams.getAll('fields[]'), ['Customer Name', 'Status', 'Date', 'Service Type']);
      if (failRoster) return Response.json({}, { status: 503 });
      jobPages++;
      return Response.json({ records: [{ fields: { 'Customer Name': "Allen Example", Status: 'Completed', Date: '2026-10-28' } }], ...(jobPages < pages ? { offset: String(jobPages) } : {}) });
    }
    return Response.json({ records: table === 'tblzRg9DZKdIRQDrn' ? [client] : [] });
  };
  const env = { AIRTABLE_API_KEY: 'test', DB: { prepare() { return { bind(...args) { runs.push(args); return this; }, async run() {} }; } }, ...(google ? { GOOGLE_BUSINESS_CLIENT_ID: 'test', GOOGLE_BUSINESS_CLIENT_SECRET: 'test', GOOGLE_BUSINESS_REFRESH_TOKEN: 'test', GOOGLE_BUSINESS_LOCATION: 'accounts/123/locations/456' } : {}) };
  const api = runPrivateInNewContext(source + '\n({runScheduledGoogleReviewSync,runScheduledReviewPipeline})', {
    fetch, Response, URL, URLSearchParams, AbortSignal, TextDecoder, Uint8Array, crypto, console: { log() {}, error() {} }, setTimeout: callback => { callback(); },
    matchGoogleReviews, buildReviewTrackerRoster, buildGoogleReviewAudit, saveGoogleReviewAudit: async (_db, audit) => audits.push(audit),
    getGoogleReviewDecisions: async () => ({reviews:{}}), withRecordLease: async (_db,_key,callback) => callback(), patchCockpitRecord: async () => {},
    runScheduledAirtableCockpitRefresh: async () => { cockpit++; return {}; },
  });
  return { api, env, writes, runs, audits, jobPages: () => jobPages, cockpit: () => cockpit };
}

test('roster traverses history larger than the old 50-page ceiling', async () => {
  const r = runtime({ pages: 131 });
  const result = await r.api.runScheduledGoogleReviewSync(r.env);
  assert.equal(r.jobPages(), 131);
  assert.equal(result.status, 'roster_only');
  assert.ok(r.writes.some(batch => batch.records.some(record => record.fields['Completed Jobs'] === 131)));
  assert.match(r.runs.at(-1).at(-1), /not configured/);
});

test('configured pipeline marks an alias reviewed, retains audit evidence and refreshes backend', async () => {
  const r = runtime({ google: true });
  await r.api.runScheduledReviewPipeline(r.env);
  assert.ok(r.writes.some(batch => batch.records.some(record => record.fields['Review Name'] === "Mitch Example" && record.fields['Google Review'] === 'Reviewed')));
  assert.equal(r.audits[0].verifiedRecordIds[0], client.id);
  assert.equal(r.audits[0].alternateNames[0].customer, "Allen Example");
  assert.equal(r.cockpit(), 1);
});

test('roster outage does not prevent matching existing customers; failure stays visible', async () => {
  const r = runtime({ google: true, failRoster: true });
  await assert.rejects(r.api.runScheduledReviewPipeline(r.env), /roster refresh failed/);
  assert.equal(r.audits.length, 1);
  assert.equal(r.cockpit(), 1);
  assert.ok(r.runs.some(args => args.includes('failed')));
});

test('Google failure preserves previous audit and review decisions while refreshing backend', async () => {
  const r = runtime({ google: true, failGoogle: true });
  await assert.rejects(r.api.runScheduledReviewPipeline(r.env), /403/);
  assert.equal(r.audits.length, 0);
  assert.equal(r.cockpit(), 1);
  assert.ok(!r.writes.some(batch => batch.records.some(record => record.fields['Google Review'] === 'Reviewed')));
});

test('manual Google check skips historical roster scans and retains review text',async()=>{
  const r=runtime({google:true});
  await r.api.runScheduledGoogleReviewSync(r.env,{refreshRoster:false});
  assert.equal(r.jobPages(),0);
  assert.equal(r.audits[0].reviews[0].reviewer.displayName,"Mitch Example");
});

test('audit retains unmatched/conflicting identities and does not count manual completion as verification', () => {
  const records = [{ ...client, fields: { ...client.fields, 'Google Review': 'Reviewed' } }];
  const result = matchGoogleReviews(records, [{ reviewId: 'unknown', reviewer: { displayName: 'Unknown Name' } }]);
  const audit = buildGoogleReviewAudit(records, [], result);
  assert.equal(audit.completedNotVerified.length, 1);
  assert.equal(audit.unmatched.length, 1);
  assert.equal(audit.verifiedRecordIds.length, 0);
  assert.equal(reviewSyncNotice({ configured: false }).warning, true);
  assert.equal(reviewSyncNotice({ configured: true, latest: { status: 'failed' } }).warning, true);
  assert.equal(reviewSyncNotice({ configured: true, latest: { status: 'success' }, audit: { source: 'manual_audit', capturedAt: new Date().toISOString() } }).warning, true);
  assert.equal(reviewSyncNotice({ configured: true, latest: { status: 'success' }, audit: { source: 'google_api', capturedAt: new Date().toISOString() } }).warning, false);
});

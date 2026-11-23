import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const bundle = await build({entryPoints: ['lib/field-messages.js'], bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{name: 'field-provider-fixtures', setup(builder) {
    builder.onResolve({filter: /^\.\/(?:sweepandgo|field-quota\.mjs|field-policy\.mjs|field-workday-store\.mjs)$/}, ({path}) => ({path, namespace: 'fixture'}));
    builder.onLoad({filter: /.*/, namespace: 'fixture'}, ({path}) => ({loader: 'js', contents:
      path === './sweepandgo' ? 'export const sngRequest=async()=>({ok:true,data:globalThis.__footerDispatch});export const sngRows=r=>r.data;'
        : path === './field-quota.mjs' ? 'export const fieldQuota=async()=>true;'
          : path === './field-policy.mjs' ? 'export const identityConflicts=()=>[];'
            : 'export const normalizePhone=p=>p;'}));
  }}]});
const {processFieldMessages} = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));

test('previously queued field messages lose historical opt-out footers at delivery', async () => {
  const recipient = '+14195550100', originalFetch = globalThis.fetch, sent = [];
  globalThis.__footerDispatch = [{id: 'job', status_id: 1, cell_phone: recipient, cleanup_notification_channel: 'sms', cleanup_notification_type: 'on_the_way'}];
  globalThis.fetch = async (_url, request) => {sent.push(JSON.parse(request.body));return Response.json({data: {id: 'fixture-delivery'}});};
  try {
    for (const footer of [' Reply STOP to opt out.', '\n\nText STOP to unsubscribe.']) {
      const row = {id: 'message', organization_id: 'org-opwp', recipient, kind: 'on_way', stop_id: 'stop', content: 'Ohio Pet Waste Pros: We are on the way.' + footer,
        expires_at: '2099-01-01T00:00:00Z', state_json: JSON.stringify({date: '2026-11-21', employeeId: 'employee', stops: [{id: 'stop', tasks: [{source: {provider: 'sweep_and_go', identity: {}, jobId: 'job'}}]}]})};
      const db = {prepare(sql) {return {bind() {return {run: async () => ({}), first: async () => sql.includes('RETURNING id') ? {id: row.id} : null, all: async () => ({results: [row]})};}};}};
      const result = await processFieldMessages({DB: db, FIELD_NOTIFICATIONS_ENABLED: 'true', QUO_API_KEY: 'fixture-key', QUO_FROM_NUMBER: '+14195550101', FIELD_QUO_WEBHOOK_SIGNING_KEY: 'fixture-signing'});
      assert.equal(result.accepted, 1);
      assert.equal(sent.at(-1).content, 'Ohio Pet Waste Pros: We are on the way.');
      assert.deepEqual(sent.at(-1).to, [recipient]);
    }
  } finally {globalThis.fetch = originalFetch;delete globalThis.__footerDispatch;}
});

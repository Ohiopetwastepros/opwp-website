import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runPrivateInNewContext } from './helpers/private-vm.mjs';
import { readBoundedProviderJson } from '../lib/bounded-body.mjs';
import { stripSmsOptOutFooter } from '../lib/customer-sms.mjs';

const source = readFileSync(new URL('../lib/field-messages.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');

for (const kind of ['on_way', 'completed']) {
  test(`legacy queued ${kind} notices send without an opt-out footer`, async () => {
    const sent = [];
    const body = kind === 'on_way'
      ? 'Ohio Pet Waste Pros: Estimated arrival in 15 minutes. Please secure pets and ensure safe access.'
      : 'Ohio Pet Waste Pros: Your food delivery is complete. Thank you!';
    const row = { id: 'queued-notice', kind, organization_id: 'org-opwp', stop_id: 'stop',
      recipient: '+14195550123', expires_at: '2099-01-01T00:00:00Z',
      content: `${body}\n\nReply STOP to opt out.`,
      state_json: JSON.stringify({ date: '2026-11-21', employeeId: 'tech', stops: [{ id: 'stop',
        tasks: [{ source: { provider: 'sweep_and_go', identity: { id: 'job' }, jobId: 'job' } }] }] }) };
    const db = { prepare(query) { return { bind() { return {
      async run() { return {}; },
      async all() { return { results: [row] }; },
      async first() { return query.includes("SET status='sending'") ? { id: row.id } : null; },
    }; } }; } };
    const { processFieldMessages } = runPrivateInNewContext(`${source}\n({processFieldMessages})`, {
      Date, JSON, console, AbortSignal, readBoundedProviderJson, stripSmsOptOutFooter,
      normalizePhone: value => value, identityConflicts: () => [], fieldQuota: async () => true,
      sngRequest: async () => ({ ok: true }), sngRows: () => [{ id: 'job', status_id: 1,
        cell_phone: row.recipient, cleanup_notification_channel: 'sms',
        cleanup_notification_type: kind === 'on_way' ? 'on_the_way' : 'completed' }],
      fetch: async (_url, options) => {
        sent.push(JSON.parse(options.body));
        return Response.json({ data: { id: 'fixture-accepted' } });
      },
    });
    const result = await processFieldMessages({ DB: db, FIELD_NOTIFICATIONS_ENABLED: 'true',
      QUO_API_KEY: 'fixture-key', QUO_FROM_NUMBER: '+14195550101', FIELD_QUO_WEBHOOK_SIGNING_KEY: 'fixture-key' });
    assert.equal(result.accepted, 1);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].content, body);
    assert.doesNotMatch(sent[0].content, /Reply STOP to opt out|Text STOP to unsubscribe/i);
  });
}

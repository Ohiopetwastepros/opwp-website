import { readBoundedProviderJson } from './bounded-body.mjs';
import { isStopMessage, sngClientMatchesPhone } from './lead-assistant.mjs';
import { winbackPhone, winbackHash, winbackWindow } from './winback-policy.mjs';
import { winbackSwitches } from './winback-store.mjs';
import { readAirtableTextSafety, syncAirtableTextStatus } from './airtable-text-safety.mjs';

const BASE = 'appcAWPBQB8GmOrcT';
export class WinbackProviderError extends Error { constructor(code) { super(code); this.code = code; } }
const fail = code => { throw new WinbackProviderError(code); };

// No provider opt-out API is invented here. A separately verified authoritative
// read adapter is mandatory; public Quo contacts/history cannot prove that a
// manually blocked recipient is clear. Missing authority always holds delivery.
export function createWinbackProviders(env, { fetcher = fetch, loadSngDirectory, readQuoOptOut, clock = () => new Date() } = {}) {
  async function request(url, provider, options = {}) {
    const response = await fetcher(url, { method: 'GET', redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(12000), ...options });
    if (!response.ok) { await response.body?.cancel(); fail(`${provider}_http_${response.status}`); }
    return readBoundedProviderJson(response, 2 * 1024 * 1024);
  }
  async function airtable(phone) {
    const safety = await readAirtableTextSafety(env, phone, { fetcher });
    if (!safety.verified) fail(safety.reason || 'airtable_unverified');
    const headers = { Authorization: `Bearer ${env.AIRTABLE_API_KEY}`, Accept: 'application/json' };
    const matches = safety.records.map(record => ({ tableId: record.tableId, id: record.id, fields: {} }));
    if (safety.doNotText) return { matches, doNotText: true, active: false, paused: false, seasonal: false };
    // Text-safety owns opt-outs. Separate read-only lifecycle fields remain
    // Sweep&Go/Airtable source data and are never rewritten by this campaign.
    for (const record of matches.filter(record => record.tableId === 'tblhi8MGUOsWNmd37')) {
      const result = await request(`https://api.airtable.com/v0/${BASE}/${record.tableId}/${record.id}`, 'airtable', { headers });
      if (result.id !== record.id || winbackPhone(result.fields?.Phone) !== phone) fail('airtable_identity_mismatch');
      if (!/^(?:active|paused|dropped|prospect|inactive)$/i.test(result.fields.Status || '')) fail('airtable_customer_status_unverified');
      record.fields = result.fields;
    }
    return { matches, doNotText: false, active: matches.some(r => /^active$/i.test(r.fields.Status || '')), paused: matches.some(r => /^paused$/i.test(r.fields.Status || '')), seasonal: matches.some(r => /pauser/i.test(String(r.fields['Seasonal Pattern'] || ''))) };
  }
  async function quo(phone, now) {
    if (!env.QUO_API_KEY || !winbackPhone(env.QUO_FROM_NUMBER)) fail('quo_unconfigured');
    if (typeof readQuoOptOut !== 'function') fail('quo_optout_authority_unavailable');
    const optout = await readQuoOptOut(phone, { now });
    if (optout?.verified !== true || typeof optout.optedOut !== 'boolean') fail('quo_optout_unverified');
    if (optout.optedOut) return { optedOut: true, recentOutbound: false, firstMessage: false };
    const origin = env.QUO_API_BASE_URL || 'https://api.openphone.com';
    if (!['https://api.openphone.com', 'https://api.quo.com'].includes(origin)) fail('quo_origin_unverified');
    const headers = { Authorization: env.QUO_API_KEY, Accept: 'application/json' };
    const numbers = await request(`${origin}/v1/phone-numbers`, 'quo', { headers });
    if (!Array.isArray(numbers.data) || !numbers.data.length || numbers.nextPageToken || !numbers.data.some(n => winbackPhone(n.number) === winbackPhone(env.QUO_FROM_NUMBER))) fail('quo_inboxes_unverified');
    let recentOutbound = false, anyOutbound = false, stopped = false;
    for (const inbox of numbers.data) {
      const from = winbackPhone(inbox.number);
      if (!from || !/^PN[\w-]{1,100}$/.test(inbox.id || '')) fail('quo_inbox_identity_unverified');
      const query = new URLSearchParams({ phoneNumberId: inbox.id, participants: phone, maxResults: '100' }), tokens = new Set();
      for (let page = 0; page < 50; page++) {
        const result = await request(`${origin}/v1/messages?${query}`, 'quo', { headers });
        if (!Array.isArray(result.data) || result.data.length > 100) fail('quo_history_unverified');
        for (const message of result.data) {
          const incoming = message.direction === 'incoming', outgoing = message.direction === 'outgoing', timestamp = Date.parse(message.createdAt || '');
          if ((!incoming && !outgoing) || message.phoneNumberId !== inbox.id || winbackPhone(message.from) !== (incoming ? phone : from) || !Array.isArray(message.to) || message.to.length !== 1 || winbackPhone(message.to[0]) !== (incoming ? from : phone) || !Number.isFinite(timestamp) || timestamp > now.getTime() + 60000 || typeof message.text !== 'string') fail('quo_history_identity_mismatch');
          if (incoming && isStopMessage(message.text)) stopped = true;
          if (outgoing) { anyOutbound = true; if (timestamp >= now.getTime() - 30 * 86400000) recentOutbound = true; }
        }
        if (!result.nextPageToken) break;
        if (typeof result.nextPageToken !== 'string' || tokens.has(result.nextPageToken) || page === 49) fail('quo_history_incomplete');
        tokens.add(result.nextPageToken); query.set('pageToken', result.nextPageToken);
      }
    }
    return { optedOut: stopped, recentOutbound, firstMessage: !anyOutbound };
  }
  async function sng(phone) {
    if (typeof loadSngDirectory !== 'function') fail('sng_directory_unavailable');
    // A paused endpoint must be verified privately. Guessing a provider endpoint
    // or treating a missing/partial roster as empty would permit unsafe sends.
    const pausedPath = env.WINBACK_SNG_PAUSED_PATH;
    if (typeof pausedPath !== 'string' || !/^\/api\/v1\/clients\/[a-z_]{1,60}$/.test(pausedPath)) fail('sng_paused_directory_unverified');
    const paths = ['/api/v1/clients/active', '/api/v1/clients/active_no_subscription', pausedPath];
    const directories = await Promise.all(paths.map(path => loadSngDirectory(path)));
    if (directories.some(d => d?.ok !== true || d.complete !== true || !Array.isArray(d.rows))) fail('sng_directory_incomplete');
    return { active: directories.slice(0, 2).some(d => d.rows.some(r => sngClientMatchesPhone(r, phone))), paused: directories[2].rows.some(r => sngClientMatchesPhone(r, phone)) };
  }
  return {
    airtable, quo, sng,
    async writeAirtable(event) {
      const result = await syncAirtableTextStatus(env, { phone: event.phone, doNotText: Boolean(event.do_not_text), status: event.outcome === 'Opted out in Quo' ? 'Opted out in Quo' : event.do_not_text ? 'Asked to stop' : event.outcome === 'Failed' ? 'Text failed' : 'OK', note: `${event.outcome}: ${event.note}`, at: new Date(event.created_at), eventId: event.id }, { fetcher });
      if (!result.verified) fail(result.reason || 'airtable_write_unverified');
      return { matched: result.records.length };
    },
    async send(phone, body, { campaignId, recipientId, deliveryId, purpose = 'initial' } = {}) {
      // Runner checks all independent switches immediately before invoking this.
      // There is intentionally no MMS property or card URL in the transport.
      const origin = env.QUO_API_BASE_URL || 'https://api.openphone.com';
      if (env.WINBACK_ENABLED !== 'true' || env.WINBACK_SEND_ENABLED !== 'true' || env.WINBACK_KILL_SWITCH !== 'false') fail('send_disabled');
      if (!env.DB || !campaignId || !recipientId || !deliveryId || !(await winbackSwitches(env.DB, env, campaignId)).allowed) fail('send_disabled');
      const recipient = await env.DB.prepare(`SELECT r.phone,r.status,d.message_body FROM winback_recipients r JOIN winback_deliveries d ON d.recipient_id=r.id WHERE r.id=? AND r.campaign_id=? AND d.id=? AND d.purpose=? AND d.status='sending'`).bind(recipientId, campaignId, deliveryId, purpose).first();
      if (!recipient || recipient.phone !== phone || recipient.status !== (purpose === 'reply' ? 'replied' : 'queued') || recipient.message_body !== body) fail('send_recipient_changed');
      if (!['initial','reply'].includes(purpose)) fail('send_disabled');
      if (purpose === 'reply') {
        if (env.WINBACK_AUTOREPLY_ENABLED !== 'true') fail('send_disabled');
        const conversation = await env.DB.prepare(`SELECT c.owner,c.automation_mode FROM lead_conversations c JOIN winback_recipients r ON r.submission_id=c.submission_id WHERE r.id=? AND c.organization_id='org-opwp'`).bind(recipientId).first();
        if (conversation?.owner !== 'backend' || conversation.automation_mode !== 'approved') fail('send_disabled');
      }
      if (typeof readQuoOptOut !== 'function') fail('quo_optout_authority_unavailable');
      const optout = await readQuoOptOut(phone, { now: new Date() });
      if (optout?.verified !== true || typeof optout.optedOut !== 'boolean') fail('quo_optout_unverified');
      if (optout.optedOut) fail('quo_opted_out');
      const safety = await readAirtableTextSafety(env, phone, { fetcher });
      if (!safety.verified) fail('send_airtable_unverified');
      if (safety.doNotText) fail('airtable_do_not_text');
      if (await env.DB.prepare(`SELECT 1 blocked FROM lead_suppressions WHERE organization_id='org-opwp' AND phone_hash=?`).bind(await winbackHash(phone)).first()) fail('phone_suppressed');
      if (!(await winbackSwitches(env.DB, env, campaignId)).allowed) fail('send_disabled');
      if (purpose === 'reply' && env.WINBACK_AUTOREPLY_ENABLED !== 'true') fail('send_disabled');
      if (!winbackWindow(clock()).allowed) fail('outside_send_window');
      if (!['https://api.openphone.com', 'https://api.quo.com'].includes(origin) || !env.QUO_API_KEY || !winbackPhone(phone) || !winbackPhone(env.QUO_FROM_NUMBER)) fail('quo_send_unconfigured');
      const response = await fetcher(`${origin}/v1/messages`, { method: 'POST', redirect: 'manual', headers: { Authorization: env.QUO_API_KEY, Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ content: body, from: winbackPhone(env.QUO_FROM_NUMBER), to: [phone] }), signal: AbortSignal.timeout(12000) });
      if (!response.ok) { await response.body?.cancel(); fail(response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status) ? `send_rejected_${response.status}` : 'send_outcome_unknown'); }
      const result = await readBoundedProviderJson(response);
      const id = result?.data?.id;
      if (typeof id !== 'string' || !/^AC[\w-]{1,150}$/.test(id)) fail('send_outcome_unknown');
      return { id };
    },
  };
}

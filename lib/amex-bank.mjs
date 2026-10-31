import bankPrivate from './bank-private.json' with {type:'json'};
import { readBoundedProviderJson } from './bounded-body.mjs';
import { cents, providerId, normalizeBankTransaction } from './bank-reconciliation.mjs';

export const REQUIRED_BANK_ACCOUNTS = Object.freeze(bankPrivate.accounts.map(account=>({mask:account.mask,name:account.label})));
export function authorizedCheckingAccounts(accounts) {
  // Explicit owner scope: both business accounts, no personal/card accounts.
  const selected=REQUIRED_BANK_ACCOUNTS.map(required=>{
    const matches=accounts?.filter(a=>a.mask===required.mask && a.type==='depository' && a.subtype==='checking' && a.balances?.iso_currency_code==='USD') || [];
    if(matches.length!==1) throw new Error('Authorize both General Operations and Fuel checking accounts.');
    providerId(matches[0].account_id);
    return {...matches[0], displayName:required.name};
  });
  if(new Set(selected.map(a=>a.account_id)).size!==2) throw new Error('Distinct bank accounts required.');
  return selected;
}

export function bankConfigured(env) {
  try {
    return Boolean(['sandbox', 'production'].includes(env.PLAID_ENVIRONMENT) && env.PLAID_CLIENT_ID && env.PLAID_SECRET && atob(env.BANK_TOKEN_ENCRYPTION_KEY || '').length === 32 && /^ins_\d+$/.test(env.AMEX_PLAID_INSTITUTION_ID || '') && !(env.APP_ENV === 'production' && env.PLAID_ENVIRONMENT !== 'production'));
  } catch { return false; }
}
async function key(env) {
  if (!bankConfigured(env)) throw new Error('Bank connector is not configured.');
  return crypto.subtle.importKey('raw', Uint8Array.from(atob(env.BANK_TOKEN_ENCRYPTION_KEY), c => c.charCodeAt(0)), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
export async function encryptBankToken(env, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return `${b64(iv)}.${b64(await crypto.subtle.encrypt({ name:'AES-GCM', iv }, await key(env), new TextEncoder().encode(value)))}`;
}
export async function decryptBankToken(env, value) {
  const [iv, data] = String(value).split('.').map(v => Uint8Array.from(atob(v), c => c.charCodeAt(0)));
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name:'AES-GCM', iv }, await key(env), data));
}
export async function plaidRequest(env, path, body) {
  if (!bankConfigured(env)) throw new Error('Bank connector is not configured.');
  const allowed = ['/link/token/create','/link/token/get','/item/public_token/exchange','/accounts/get','/item/get','/item/remove','/transactions/sync'];
  if (!allowed.includes(path)) throw new Error('Unsupported bank operation.');
  // Timeout includes bounded body consumption; never log provider bodies or tokens.
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 15000);
  try {
    const response = await fetch(`https://${env.PLAID_ENVIRONMENT}.plaid.com${path}`, { method:'POST', redirect:'error', signal:abort.signal, headers:{'Content-Type':'application/json','Plaid-Version':'2020-09-14'}, body:JSON.stringify({...body, client_id:env.PLAID_CLIENT_ID, secret:env.PLAID_SECRET}) });
    const data = await readBoundedProviderJson(response, 2 * 1024 * 1024);
    if (!response.ok) {
      const error = new Error('Bank provider request failed.');
      error.code = ['ITEM_LOGIN_REQUIRED','TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION','PRODUCT_NOT_READY'].includes(data.error_code) ? data.error_code : 'PROVIDER_ERROR';
      throw error;
    }
    return data;
  } finally { clearTimeout(timer); }
}
export async function bankAudit(db, actor, action, detail = {}) {
  await db.prepare('INSERT INTO financial_reconciliation_audit(at,actor,action,detail) VALUES (?,?,?,?)').bind(new Date().toISOString(), actor, action, JSON.stringify(detail)).run();
}
export async function withBankLock(env, callback, { scheduled = false } = {}) {
  if (!bankConfigured(env) || !env.DB) throw new Error('Bank connector is unavailable.');
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT OR IGNORE INTO bank_connection(id,environment) VALUES ('primary',?)").bind(env.PLAID_ENVIRONMENT).run();
  const lease = crypto.randomUUID();
  const record = await env.DB.prepare(`UPDATE bank_connection SET lease_token=?,lease_until=? WHERE id='primary' AND environment=? AND (lease_until IS NULL OR lease_until<?) AND (?=0 OR next_check_at IS NULL OR next_check_at<=?) RETURNING *`).bind(lease, new Date(Date.now()+15*60000).toISOString(), env.PLAID_ENVIRONMENT, now, scheduled ? 1 : 0, now).first();
  if (!record) return { skipped:true, reason:'busy_or_not_due' };
  try { return await callback(record); }
  finally { await env.DB.prepare("UPDATE bank_connection SET lease_token=NULL,lease_until=NULL WHERE id='primary' AND lease_token=?").bind(lease).run(); }
}
export async function startBankLink(env, actor) {
  return withBankLock(env, async record => {
    const origin = new URL(env.SITE_ORIGIN);
    if (origin.protocol !== 'https:' || origin.username || origin.password) throw new Error('Invalid site origin.');
    const result = await plaidRequest(env, '/link/token/create', {
      client_name:'Ohio Pet Waste Pros', user:{client_user_id:'opwp-primary-bank'}, country_codes:['US'], language:'en',
      ...(record.access_token_encrypted ? {access_token:await decryptBankToken(env,record.access_token_encrypted)} : {products:['transactions'], transactions:{days_requested:90}, account_filters:{depository:{account_subtypes:['checking']}}}),
      hosted_link:{completion_redirect_uri:`${origin.origin}/admin/financials/reconciliation/`,url_lifetime_seconds:1800},
    });
    const link = new URL(result.hosted_link_url);
    if (link.protocol !== 'https:' || link.hostname !== 'secure.plaid.com' || link.username || link.password) throw new Error('Invalid bank link.');
    await env.DB.prepare('INSERT INTO bank_link_sessions(actor,token_encrypted,environment,expires_at,update_mode) VALUES (?,?,?,?,?) ON CONFLICT(actor) DO UPDATE SET token_encrypted=excluded.token_encrypted,environment=excluded.environment,expires_at=excluded.expires_at,update_mode=excluded.update_mode')
      .bind(actor,await encryptBankToken(env,result.link_token),env.PLAID_ENVIRONMENT,new Date(Date.now()+30*60000).toISOString(),record.access_token_encrypted ? 1 : 0).run();
    await bankAudit(env.DB,actor,'bank_link_started');
    return {url:link.toString()};
  });
}
export async function finishBankLink(env, actor) {
  return withBankLock(env, async record => {
    const session = await env.DB.prepare('SELECT * FROM bank_link_sessions WHERE actor=? AND environment=? AND expires_at>?').bind(actor,env.PLAID_ENVIRONMENT,new Date().toISOString()).first();
    if (!session) throw new Error('No active bank link.');
    const result = await plaidRequest(env,'/link/token/get',{link_token:await decryptBankToken(env,session.token_encrypted)});
    let accessToken;
    let newlyExchanged = false;
    if (session.update_mode) {
      accessToken = await decryptBankToken(env,record.access_token_encrypted);
      const item = await plaidRequest(env,'/item/get',{access_token:accessToken});
      if (item.item?.error) throw new Error('Bank reconnection is incomplete.');
    } else {
      const tokens = [...new Set((result.link_sessions || []).flatMap(s => (s.results?.item_add_results || (s.on_success ? [s.on_success] : [])).map(r => r.public_token)).filter(Boolean))];
      if (tokens.length !== 1 || record.access_token_encrypted) throw new Error('Finish linking exactly one bank.');
      const exchanged = await plaidRequest(env,'/item/public_token/exchange',{public_token:tokens[0]});
      accessToken = exchanged.access_token;
      newlyExchanged = true;
    }
    try {
      const accounts = await plaidRequest(env,'/accounts/get',{access_token:accessToken});
      const checking = authorizedCheckingAccounts(accounts.accounts);
      if (accounts.item?.institution_id !== env.AMEX_PLAID_INSTITUTION_ID) throw new Error('Wrong bank institution.');
      const existing=(await env.DB.prepare('SELECT account_id,account_mask FROM bank_accounts').all()).results;
      if(existing.length && (existing.length!==2 || checking.some(a=>!existing.some(old=>old.account_id===a.account_id && old.account_mask===a.mask)))) throw new Error('Bank account identity changed.');
      await env.DB.batch([
        env.DB.prepare("UPDATE bank_connection SET access_token_encrypted=?,item_id=?,connected_by=?,connected_at=?,last_error=NULL,next_check_at=NULL WHERE id='primary'").bind(await encryptBankToken(env,accessToken),providerId(accounts.item.item_id),actor,new Date().toISOString()),
        ...checking.map(account=>env.DB.prepare('INSERT INTO bank_accounts(account_id,account_name,account_mask) VALUES (?,?,?) ON CONFLICT(account_id) DO NOTHING').bind(account.account_id,account.displayName,account.mask)),
        env.DB.prepare('DELETE FROM bank_link_sessions WHERE actor=?').bind(actor),
      ]);
      newlyExchanged = false;
      await bankAudit(env.DB,actor,'bank_connected');
      return {connected:true};
    } finally {
      if (newlyExchanged) {
        try { await plaidRequest(env,'/item/remove',{access_token:accessToken}); }
        catch { console.error(JSON.stringify({event:'bank_unaccepted_item_revocation_failed'})); }
      }
    }
  });
}

export async function syncBank(env, record, request = plaidRequest) {
  const access_token = await decryptBankToken(env,record.access_token_encrypted);
  const storedAccounts=(await env.DB.prepare('SELECT * FROM bank_accounts').all()).results;
  if(storedAccounts.length!==2) throw new Error('Both checking accounts are required.');
  const accountIds=new Set(storedAccounts.map(a=>a.account_id));
  // All pages are validated before committing. Failure/mutation retries from the saved cursor.
  const updates = new Map();
  let cursor = record.cursor || '';
  let complete = false;
  let ready = false;
  for (let page=0;page<10;page++) {
    const data = await request(env,'/transactions/sync',{access_token,cursor,count:100});
    if (!Array.isArray(data.added) || !Array.isArray(data.modified) || !Array.isArray(data.removed) || typeof data.has_more !== 'boolean' || typeof data.next_cursor !== 'string' || data.next_cursor.length > 2048 || data.added.length+data.modified.length+data.removed.length > 100) throw new Error('Invalid bank pagination.');
    for (const row of [...data.added,...data.modified]) {
      // Other consented accounts never enter this account ledger.
      if (accountIds.has(row.account_id)) updates.set(providerId(row.transaction_id), normalizeBankTransaction(row,row.account_id));
    }
    for (const row of data.removed) updates.set(providerId(row.transaction_id), {id:row.transaction_id,removed:true});
    cursor = data.next_cursor;
    ready = data.transactions_update_status === 'HISTORICAL_UPDATE_COMPLETE';
    if (!data.has_more) {complete=true;break;}
  }
  if (!complete) throw new Error('Bank pagination limit reached.');
  const accounts = await request(env,'/accounts/get',{access_token});
  const item = await request(env,'/item/get',{access_token});
  const checking=authorizedCheckingAccounts(accounts.accounts);
  if (checking.some(a=>!storedAccounts.some(old=>old.account_id===a.account_id && old.account_mask===a.mask)) || accounts.item?.item_id !== record.item_id || accounts.item?.institution_id !== env.AMEX_PLAID_INSTITUTION_ID || item.item?.error) throw new Error('Bank account evidence changed.');
  const now = new Date().toISOString();
  const changed=JSON.stringify([...updates.values()].filter(row=>!row.removed));
  const removed=JSON.stringify([...updates.values()].filter(row=>row.removed).map(row=>row.id));
  const collision=await env.DB.prepare(`SELECT t.id FROM bank_transactions t JOIN json_each(?) incoming ON t.id=json_extract(incoming.value,'$.id') WHERE t.account_id<>json_extract(incoming.value,'$.accountId') LIMIT 1`).bind(changed).first();
  if(collision) throw new Error('Transaction account identity changed.');
  const statements = [
    env.DB.prepare('UPDATE bank_transactions SET removed=1,updated_at=? WHERE id IN (SELECT value FROM json_each(?)) AND account_id IN (?,?)').bind(now,removed,...storedAccounts.map(a=>a.account_id)),
    env.DB.prepare(`INSERT INTO bank_transactions(id,account_id,date,amount_cents,description,pending,removed,updated_at)
      SELECT json_extract(value,'$.id'),json_extract(value,'$.accountId'),json_extract(value,'$.date'),json_extract(value,'$.amountCents'),json_extract(value,'$.description'),json_extract(value,'$.pending'),0,?
      FROM json_each(?) WHERE 1
      ON CONFLICT(id) DO UPDATE SET date=excluded.date,amount_cents=excluded.amount_cents,description=excluded.description,pending=excluded.pending,removed=0,updated_at=excluded.updated_at`).bind(now,changed),
  ];
  const bankUpdatedAt = item.status?.transactions?.last_successful_update || item.item?.status?.transactions?.last_successful_update || null;
  if (bankUpdatedAt && !Number.isFinite(Date.parse(bankUpdatedAt))) throw new Error('Invalid bank freshness timestamp.');
  statements.push(...checking.map(account=>env.DB.prepare('UPDATE bank_accounts SET current_cents=?,available_cents=? WHERE account_id=?').bind(account.balances.current == null ? null : cents(account.balances.current),account.balances.available == null ? null : cents(account.balances.available),account.account_id)));
  statements.push(env.DB.prepare("UPDATE bank_connection SET cursor=?,bank_updated_at=?,synced_at=?,history_ready=?,last_error=NULL WHERE id='primary'")
    .bind(cursor,bankUpdatedAt,now,ready?1:0));
  // D1 batch is atomic: a cursor never advances beyond persisted data.
  await env.DB.batch(statements);
  return env.DB.prepare("SELECT * FROM bank_connection WHERE id='primary'").first();
}

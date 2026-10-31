import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { subscriptionRevenueProposal as propose, supportingRevenueProposal, reconcileMissingRevenueBaselines as reconcile, fetchSngBillingCollection, REVENUE_RECONCILIATION_KEY } from '../lib/subscription-reconciliation.mjs';
const client = { client_name: 'Sample Customer', address: '12 Main St', email: 'sample@example.test', subscription_names: '2d-1xW' };
const subscription = { ...client, status: 'active', service_plan: '2d-1xW', category: 'prepaid', billing_interval: 'monthly', price: 85 };
const checks = { airtable: 'checked', sngInvoices: 'checked', invoiceArchive: 'checked', quickbooks: 'checked' };
function database() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of ['0010_subscription_daily_truth.sql', '0018_airtable_cockpit_snapshot.sql']) sqlite.exec(readFileSync(new URL('../tmp/test-migrations/'+file, import.meta.url), 'utf8'));
  const DB = { prepare(sql) { const statement = sqlite.prepare(sql); let args=[]; return { bind(...values) { args=values; return this; }, async all() { return {results:statement.all(...args)}; }, async first() { return statement.get(...args) || null; }, async run() { return {meta:statement.run(...args)}; } }; } };
  return { DB, sqlite, state: () => JSON.parse(sqlite.prepare('SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key=?').get(REVENUE_RECONCILIATION_KEY).payload) };
}
test('current recurring terms establish monthly core and add-ons without an invoice', () => {
  const value=propose(client,[subscription,{...subscription,service_plan:'Sanitization',price:30}]);
  assert.equal(value.coreMrr,85); assert.equal(value.addonMrr,30); assert.equal(value.addonCount,1);
  assert.equal(propose(client,[{...subscription,billing_interval:'annually',price:1020}]).coreMrr,85);
});
test('ambiguous, discounted, unrelated and unsupported subscription prices fail closed', () => {
  for (const rows of [[subscription,subscription],[{...subscription,address:'1202 Example Lane'}],[{...subscription,coupon_code:'PROMO'}],[{...subscription,billing_interval:'per_visit'}],[{...subscription,status:'canceled'}],[{...subscription,price:0}],[{...subscription,service_plan:'Unknown extra'}]]) assert.equal(propose(client,rows),null);
});
test('fallback requires explicit recurring terms, matching identity and Airtable corroboration', () => {
  const sources={airtable:[{fields:{'Client Name':client.client_name,Address:client.address,'MRR ($)':85}}],quickbooks:[{Id:'inv1',CustomerRef:{name:client.client_name},ShipAddr:{Line1:client.address},Line:[{DetailType:'SalesItemLineDetail',Description:'Dog waste service at $85 monthly',Amount:47.33}]}]};
  assert.equal(supportingRevenueProposal(client,sources).coreMrr,85);
  sources.airtable[0].fields['MRR ($)']=90;
  assert.equal(supportingRevenueProposal(client,sources),null);
  sources.quickbooks[0].Line[0].Description='Dog waste service';
  assert.equal(supportingRevenueProposal(client,sources),null);
});
test('verified baseline persists once and repeated runs preserve the audit history', async () => {
  const db=database(); let reads=0;
  const options={fetchSubscriptions:async()=>{reads++;return [subscription];},fetchSupporting:async()=>{throw Error('unexpected fallback');}};
  await reconcile({DB:db.DB},[client,client],options);
  assert.equal(db.state().resolved.length,1); assert.equal(db.state().pending.length,0);
  await reconcile({DB:db.DB},[client],options);
  assert.equal(reads,1);assert.equal(db.state().resolved.length,1);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM subscription_client_baseline').get().n,1);
});
test('a failed source retries without requesting an answer or inventing revenue', async () => {
  const db=database();
  await reconcile({DB:db.DB},[client],{fetchSubscriptions:async()=>{throw Error('provider unavailable');},fetchSupporting:async()=>({checks,evidence:{}}),fetchCommunications:async()=>({complete:true})});
  assert.equal(db.state().pending[0].ownerActionRequired,false);
  assert.equal(db.state().pending[0].checks.sngSubscriptions,'retrying');
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM subscription_client_baseline').get().n,0);
});
test('follow-up waits until every source finishes and communication batches progress', async () => {
  const db=database();const clients=Array.from({length:7},(_,i)=>({...client,client_name:'Customer '+i})); let calls=0;
  const options={fetchSubscriptions:async()=>[],fetchSupporting:async()=>({checks,evidence:{}}),fetchCommunications:async()=>{calls++;return {complete:true,excerpts:[]};}};
  await reconcile({DB:db.DB},clients,options);
  assert.equal(db.state().pending.filter(row=>row.ownerActionRequired).length,5);
  await reconcile({DB:db.DB},clients,options);
  assert.equal(db.state().pending.filter(row=>row.ownerActionRequired).length,7);assert.equal(calls,7);
});
test('truncated provider pagination cannot become financial evidence', async () => {
  const original=globalThis.fetch;
  try { globalThis.fetch=async()=>Response.json({subscriptions:{data:[subscription],current_page:1,last_page:1,total:2}});
    await assert.rejects(fetchSngBillingCollection({SNG_API_KEY:'test'},'subscriptions'),/incomplete/);
  } finally {globalThis.fetch=original;}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { archivedResolution, parseInvoiceBalance, reconcileRecordedPayments, verifyFailedPaymentForSend, runFailedPaymentRecovery } from '../lib/failed-payment-reconciliation.js';

function fixture() {
  const sql=new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE sng_events(id TEXT PRIMARY KEY,event_type TEXT,status TEXT,received_at TEXT,payload TEXT);
  CREATE TABLE sng_invoices(invoice_id TEXT PRIMARY KEY,invoice_number TEXT);
  CREATE TABLE route_invoice_history(invoice_id TEXT PRIMARY KEY,invoice_number TEXT,status TEXT,imported_at TEXT);
  CREATE TABLE failed_payment_sms(id TEXT PRIMARY KEY,invoice_id TEXT,source_event_id TEXT,client_ref TEXT,client_name TEXT,status TEXT);
  CREATE TABLE airtable_cockpit_snapshots(snapshot_key TEXT PRIMARY KEY,payload TEXT,status TEXT,captured_at TEXT,updated_at TEXT);`);
  sql.exec(readFileSync(new URL('../tmp/test-migrations/0045_failed_payment_reconciliation.sql',import.meta.url),'utf8'));
  sql.prepare('INSERT INTO sng_events VALUES (?,?,?,?,?)').run('decline','client:client_payment_declined','processed','2026-09-01 00:00:00',JSON.stringify({data:{client:'client-1',invoice_id:'123',total:90}}));
  sql.exec(`INSERT INTO failed_payment_sms VALUES ('sms-1','123','decline','client-1','Test Customer','awaiting_approval');
    INSERT INTO route_invoice_history VALUES ('123','invoice-123','Failed','2026-09-20 00:00:00');`);
  const db={prepare(query){return {bind(...values){const stmt=sql.prepare(query);return {
    all:async()=>({results:stmt.all(...values)}),first:async()=>stmt.get(...values)||null,
    run:async()=>({meta:{changes:stmt.run(...values).changes}})
  };}};}};
  const env={DB:db,SNG_API_KEY:'test',AIRTABLE_API_KEY:'test',AIRTABLE_BASE_ID:'appTest',AIRTABLE_FAILED_PAYMENTS_TABLE_ID:'tblTest'};
  return {sql,db,env};
}

test('invoice balances reject absent, null, blank, malformed, negative and huge values',()=>{
  for(const value of [null,undefined,'',' ',false,'oops',-1,'1e2',1000001]) assert.throws(()=>parseInvoiceBalance({invoice_remaining:value}));
  assert.equal(parseInvoiceBalance({invoice_remaining:'0.00'}),0);
  assert.equal(parseInvoiceBalance({invoice_remaining:'90.50'}),90.5);
});

test('old exports cannot close a newer decline and payment matches are not invoice settlement',()=>{
  assert.equal(archivedResolution({history_status:'Paid',history_at:'2026-08-01',decline_at:'2026-09-01'}),null);
  assert.equal(archivedResolution({payment_match:1}).state,'payment_recorded');
});

test('backfill closes paid and voided invoices without destroying sent/dismissed delivery history',async()=>{
  const {sql,db}=fixture();
  try {
    sql.exec("UPDATE route_invoice_history SET status='Paid'; UPDATE failed_payment_sms SET status='sent'");
    await reconcileRecordedPayments(db);
    assert.equal(sql.prepare('SELECT payment_state FROM failed_payment_reconciliation').get().payment_state,'paid');
    assert.equal(sql.prepare('SELECT status FROM failed_payment_sms').get().status,'sent');
    await reconcileRecordedPayments(db);
    assert.equal(sql.prepare('SELECT count(*) n FROM failed_payment_reconciliation').get().n,1);
    sql.exec("UPDATE route_invoice_history SET status='Voided'");
    await reconcileRecordedPayments(db);
    assert.equal(sql.prepare('SELECT payment_state FROM failed_payment_reconciliation').get().payment_state,'voided');
  } finally { sql.close(); }
});

for(const scenario of ['unpaid','paid','partial','provider_failure','mirror_failure','readback_mismatch']) {
 test(`pre-send gate: ${scenario}`,async()=>{
  const {sql,db,env}=fixture(); const original=globalThis.fetch; let fields; let writes=0;
  globalThis.fetch=async(url,options)=>{
    if(String(url).includes('sweepandgo')) {
      if(scenario==='provider_failure') return new Response('',{status:503});
      return Response.json({invoice_remaining:scenario==='paid'?'0.00':scenario==='partial'?'40.00':'90.00'});
    }
    if(options.method==='PATCH') {
      writes++;
      if(scenario==='mirror_failure') return new Response('',{status:403});
      fields=JSON.parse(options.body).records[0].fields;
      return Response.json({records:[{id:'recTest123',fields}]});
    }
    return Response.json({id:'recTest123',fields:scenario==='readback_mismatch'?{}:fields});
  };
  try {
    await reconcileRecordedPayments(db);
    if(['provider_failure','mirror_failure','readback_mismatch'].includes(scenario)) await assert.rejects(()=>verifyFailedPaymentForSend(env,'sms-1'));
    else {
      assert.equal(await verifyFailedPaymentForSend(env,'sms-1'),scenario==='unpaid');
      assert.equal(writes,1);
      assert.ok(sql.prepare('SELECT airtable_confirmed_at FROM failed_payment_reconciliation').get().airtable_confirmed_at);
    }
  } finally { globalThis.fetch=original;sql.close(); }
 });
}

test('scheduled reconciliation mirrors export-paid cases without any SNG charge or SMS call',async()=>{
  const {sql,env}=fixture();const original=globalThis.fetch;let fields;
  globalThis.fetch=async(url,options)=>{
    assert.match(String(url),/^https:\/\/api.airtable.com\//);
    if(options.method==='PATCH') { fields=JSON.parse(options.body).records[0].fields;return Response.json({records:[{id:'recTest',fields}]}); }
    return Response.json({fields});
  };
  try {
    sql.exec("UPDATE route_invoice_history SET status='Paid'");
    assert.deepEqual(await runFailedPaymentRecovery(env),{configured:true,confirmed:1,held:0});
    assert.equal(fields['Payment State'],'paid');
    assert.equal(fields['SMS State'],'awaiting_approval');
  } finally { globalThis.fetch=original;sql.close(); }
});

test('failed-payment endpoint authenticates, rejects cross-site writes and streams bounded bodies',()=>{
  const source=readFileSync(new URL('../app/api/admin/failed-payments/route.js',import.meta.url),'utf8');
  assert.match(source,/verifyAdminRequest/);assert.match(source,/status:403/);assert.match(source,/readBoundedBytes\(request,4096\)/);
  assert.ok(source.indexOf('if (!auth.authorized)')<source.indexOf('const body = await boundedJson'));
});

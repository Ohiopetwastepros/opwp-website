import bankPrivate from '../lib/bank-private.json' with {type:'json'};
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { cents, providerId, normalizeBankTransaction, compareFinancialEvidence, requiredQuickBooksBankAccounts } from '../lib/bank-reconciliation.mjs';
import { bankConfigured, encryptBankToken, decryptBankToken, syncBank, withBankLock, authorizedCheckingAccounts } from '../lib/amex-bank.mjs';
import { persistReconciliation } from '../lib/financial-reconciliation-store.mjs';
import { quickBooksBankMovements } from '../lib/quickbooks-bank-movements.mjs';
const config={PLAID_ENVIRONMENT:'sandbox',PLAID_CLIENT_ID:'test',PLAID_SECRET:'test',BANK_TOKEN_ENCRYPTION_KEY:btoa('x'.repeat(32)),AMEX_PLAID_INSTITUTION_ID:'ins_123'};
function database() {
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../tmp/test-migrations/0042_bank_reconciliation.sql',import.meta.url),'utf8'));
  const db={prepare(sql){const stmt=sqlite.prepare(sql);let args=[];return {bind(...a){args=a;return this;},async first(){return stmt.get(...args)||null;},async all(){return {results:stmt.all(...args)};},async run(){return {meta:stmt.run(...args)};}};},async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const stmt of statements)results.push(await stmt.run());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
  return {sqlite,db};
}
test('strict cents, signs, account scope, currency, pending validation',()=>{
  assert.equal(cents('123.45'),12345);
  for(const v of [null,undefined,'',false,'bad',Infinity]) assert.throws(()=>cents(v));
  const row={transaction_id:'t1',account_id:'a1',date:'2026-09-01',amount:-23.50,iso_currency_code:'USD',pending:false};
  assert.equal(normalizeBankTransaction(row,'a1').amountCents,2350);
  for(const changed of [{account_id:'other'},{iso_currency_code:'CAD'},{date:'2026-02-30'},{pending:'false'}]) assert.throws(()=>normalizeBankTransaction({...row,...changed},'a1'));
});
test('configuration fails closed and token encryption authenticates ciphertext',async()=>{
  assert.equal(bankConfigured(config),true);
  assert.equal(bankConfigured({...config,APP_ENV:'production'}),false);
  assert.equal(bankConfigured({...config,BANK_TOKEN_ENCRYPTION_KEY:''}),false);
  const cipher=await encryptBankToken(config,'secret-token');
  assert.equal(await decryptBankToken(config,cipher),'secret-token');
  assert.equal(cipher.includes('secret-token'),false);
  await assert.rejects(decryptBankToken({...config,BANK_TOKEN_ENCRYPTION_KEY:btoa('y'.repeat(32))},cipher));
});
const evidence=()=>({now:'2026-09-23T12:00:00Z',bank:{account_id:'a1',account_name:'Example General Operations',account_mask:("" + bankPrivate.accounts[0].mask),bank_updated_at:'2026-09-23T10:00:00Z',history_ready:1,current_cents:10000},qboAccount:{Id:'q1',CurrentBalance:100},deposits:[{Id:'d1',DepositToAccountRef:{value:'q1'},TotalAmt:20,TxnDate:'2026-09-20'}],invoices:[{Id:'i1',DocNumber:'123',TotalAmt:85,CustomerRef:{name:"Jane Example"}}],sngInvoices:[{invoice_id:'s1',invoice_number:'123',client_name:"Jane Example",total:85}],transactions:[{id:'t1',date:'2026-09-20',amount_cents:2000,pending:0,removed:0}]});
test('balance and invoice agreement do not turn deposit suggestions into verified settlements',()=>{
  const rows=compareFinancialEvidence(evidence());
  assert.equal(rows.find(r=>r.id==='bank:a1:balance').status,'resolved');
  assert.equal(rows.find(r=>r.id==='sng:invoice:s1').status,'resolved');
  assert.equal(rows.find(r=>r.id==='bank:deposit:t1').status,'open');
  assert.deepEqual(rows.find(r=>r.id==='bank:deposit:t1').evidence.candidates,['d1']);
});
test('stale data, duplicate invoices, wrong customers and currencies cannot clear checks',()=>{
  for(const change of [e=>e.invoices.push({...e.invoices[0]}),e=>e.invoices[0].CustomerRef.name='Other',e=>e.invoices[0].CurrencyRef={value:'CAD'},e=>e.sngInvoices.push({...e.sngInvoices[0],invoice_id:'s2'})]) {
    const input=evidence();change(input);assert.equal(compareFinancialEvidence(input).find(r=>r.id==='sng:invoice:s1').status,'open');
  }
  const input=evidence();input.bank.bank_updated_at='2026-09-01T00:00:00Z';
  const rows=compareFinancialEvidence(input);assert.equal(rows.some(r=>r.id==='bank:a1:balance'),false);assert.equal(rows.find(r=>r.id==='bank:a1:freshness').status,'open');
});
test('reviewed settlements close only with fresh agreeing evidence and reopen on a change',()=>{
  const input=evidence();input.settlementLinks=[{bank_transaction_id:'t1',qbo_deposit_id:'d1',bank_date:'2026-09-20',amount_cents:2000,reviewed_by:'owner'}];
  assert.equal(compareFinancialEvidence(input).find(c=>c.kind==='settlement').status,'resolved');
  input.deposits[0].TotalAmt=19;
  assert.equal(compareFinancialEvidence(input).find(c=>c.kind==='settlement').status,'open');
  input.deposits[0].TotalAmt=20;input.bank.history_ready=0;
  assert.equal(compareFinancialEvidence(input).find(c=>c.kind==='settlement').status,'open');
});
test('issue history is idempotent, survives failures, resolves and reopens',async()=>{
  const {db,sqlite}=database();const now='2026-09-23T12:00:00Z';
  const entry={id:'bank:a1:balance',kind:'balance',status:'open',evidence:{differenceCents:100}};
  await persistReconciliation(db,[entry],{status:'review_required'},now);
  await persistReconciliation(db,[entry],{status:'review_required'},now);
  await persistReconciliation(db,[],{status:'incomplete'},now);
  assert.equal(sqlite.prepare('SELECT status FROM financial_reconciliation_cases').get().status,'open');
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM financial_reconciliation_audit').get().n,1);
  await persistReconciliation(db,[{...entry,status:'resolved'}],{status:'review_required'},now);
  await persistReconciliation(db,[entry],{status:'review_required'},now);
  assert.equal(sqlite.prepare('SELECT resolved_at FROM financial_reconciliation_cases').get().resolved_at,null);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM financial_reconciliation_audit').get().n,3);
});
async function setupSync(){const {db,sqlite}=database();const env={...config,DB:db};const encrypted=await encryptBankToken(env,'token');await db.prepare("INSERT INTO bank_connection(id,environment,access_token_encrypted,item_id,cursor) VALUES ('primary','sandbox',?,'item1','old')").bind(encrypted).run();sqlite.exec(("INSERT INTO bank_accounts(account_id,account_name,account_mask) VALUES ('a1','Example General Operations','" + bankPrivate.accounts[0].mask + "'),('a2','Example Fuel Account','" + bankPrivate.accounts[1].mask + "')"));return {env,sqlite,record:await db.prepare('SELECT * FROM bank_connection').first()};}
const syncPage={added:[{transaction_id:'t1',account_id:'a1',date:'2026-09-20',amount:-20,iso_currency_code:'USD',pending:false}],modified:[],removed:[],has_more:false,next_cursor:'new',transactions_update_status:'HISTORICAL_UPDATE_COMPLETE'};
const provider=async(env,path)=>path==='/transactions/sync'?syncPage:path==='/accounts/get'?{accounts:[{account_id:'a1',mask:("" + bankPrivate.accounts[0].mask),type:'depository',subtype:'checking',balances:{current:100,available:90,iso_currency_code:'USD'}},{account_id:'a2',mask:("" + bankPrivate.accounts[1].mask),type:'depository',subtype:'checking',balances:{current:10,available:9,iso_currency_code:'USD'}}],item:{item_id:'item1',institution_id:'ins_123'}}:{item:{},status:{transactions:{last_successful_update:'2026-09-23T10:00:00Z'}}};
test('sync replay is idempotent and cursor commits with transactions; removals retained',async()=>{
  const {env,sqlite,record}=await setupSync();
  await syncBank(env,record,provider);await syncBank(env,record,provider);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM bank_transactions').get().n,1);
  assert.equal(sqlite.prepare('SELECT cursor FROM bank_connection').get().cursor,'new');
  await syncBank(env,record,async(e,p)=>p==='/transactions/sync'?{...syncPage,added:[],removed:[{transaction_id:'t1'}]}:provider(e,p));
  assert.equal(sqlite.prepare('SELECT removed FROM bank_transactions').get().removed,1);
});
test('pagination failures never commit partial transactions or advance cursor',async()=>{
  const {env,sqlite,record}=await setupSync();let calls=0;
  await assert.rejects(syncBank(env,record,async()=>{if(calls++)throw Error('mutation');return {...syncPage,has_more:true};}));
  assert.equal(sqlite.prepare('SELECT cursor FROM bank_connection').get().cursor,'old');
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM bank_transactions').get().n,0);
});
test('global lease excludes concurrent work and scheduled cadence cannot be bypassed',async()=>{
  const {env}=await setupSync();let concurrent;
  await withBankLock(env,async()=>{concurrent=await withBankLock(env,async()=>{throw Error('should not enter');});});
  assert.equal(concurrent.skipped,true);
  await env.DB.prepare("UPDATE bank_connection SET next_check_at='2999-01-01T00:00:00Z'").run();
  assert.equal((await withBankLock(env,async()=>{throw Error('should not enter');},{scheduled:true})).skipped,true);
});
test('both required Amex checking accounts must be present; duplicate masks and cards fail',async()=>{
  const accounts=(await provider(config,'/accounts/get')).accounts;
  assert.equal(authorizedCheckingAccounts(accounts).length,2);
  assert.throws(()=>authorizedCheckingAccounts(accounts.slice(0,1)));
  assert.throws(()=>authorizedCheckingAccounts([...accounts,accounts[0]]));
  assert.throws(()=>authorizedCheckingAccounts([accounts[0],{...accounts[1],type:'credit'}]));
});
test('both accounts sync independently, and a missing Fuel account rolls back everything',async()=>{
  const {env,sqlite,record}=await setupSync();
  await syncBank(env,record,async(e,p)=>p==='/transactions/sync'?{...syncPage,added:[...syncPage.added,{...syncPage.added[0],transaction_id:'t2',account_id:'a2',amount:5}]}:provider(e,p));
  assert.deepEqual(sqlite.prepare('SELECT account_id,amount_cents FROM bank_transactions ORDER BY account_id').all().map(r=>({...r})),[{account_id:'a1',amount_cents:2000},{account_id:'a2',amount_cents:-500}]);
  assert.equal(sqlite.prepare("SELECT current_cents FROM bank_accounts WHERE account_id='a2'").get().current_cents,1000);
  await assert.rejects(syncBank(env,record,async(e,p)=>{
    const result=await provider(e,p);
    return p==='/accounts/get'?{...result,accounts:result.accounts.slice(0,1)}:p==='/transactions/sync'?{...result,next_cursor:'bad'}:result;
  }));
  assert.equal(sqlite.prepare('SELECT cursor FROM bank_connection').get().cursor,'new');
});
test('each account balance is checked separately; equal/opposite differences cannot cancel',()=>{
  const operations=evidence();operations.bank.current_cents=11000;
  const fuel=evidence();fuel.bank={...fuel.bank,account_id:'a2',account_name:'Fuel',current_cents:9000};
  const cases=[...compareFinancialEvidence(operations),...compareFinancialEvidence(fuel)].filter(c=>c.kind==='balance');
  assert.equal(cases.length,2);assert.equal(new Set(cases.map(c=>c.id)).size,2);assert.ok(cases.every(c=>c.status==='open'));
});
test('purchases and both transfer legs preserve signs and account identity; cash transfer sums to zero',()=>{
  const movements=quickBooksBankMovements({purchases:[{Id:'7',AccountRef:{value:'fuel'},TotalAmt:66.32,TxnDate:'2026-09-19'}],transfers:[{Id:'8',FromAccountRef:{value:'ops'},ToAccountRef:{value:'fuel'},Amount:1000,TxnDate:'2026-08-06'}],payments:[{Id:'9',TotalAmt:65,TxnDate:'2026-09-23'}]});
  assert.equal(movements.length,3);assert.equal(movements[0].TotalAmt,-66.32);
  assert.equal(movements.slice(1).reduce((sum,m)=>sum+m.TotalAmt,0),0);
  assert.deepEqual(movements.slice(1).map(m=>m.DepositToAccountRef.value),['fuel','ops']);
  const input=evidence();input.qboAccount.Id='fuel';input.transactions=[{id:'t3',date:'2026-09-19',amount_cents:-6632,pending:0,removed:0}];input.deposits=movements;
  assert.deepEqual(compareFinancialEvidence(input).find(c=>c.kind==='settlement').evidence.candidates,['Purchase_7']);
});
test('required QuickBooks accounts are selected exactly and fail closed',()=>{
  const rows=[
    {Id:'q1',Name:("Example General Operations (" + bankPrivate.accounts[0].mask + ") - 1"),AccountType:'Bank',Active:true,CurrentBalance:27559.86},
    {Id:'q2',Name:("Example Fuel Account (" + bankPrivate.accounts[1].mask + ")"),AccountType:'Bank',Active:true,CurrentBalance:449.55},
    {Id:'q3',Name:'Cash',AccountType:'Bank',Active:true,CurrentBalance:2066.81},
  ];
  const selected=requiredQuickBooksBankAccounts(rows);
  assert.deepEqual(selected.map(row=>[row.key,row.mask,row.bookCents]),[['operations',("" + bankPrivate.accounts[0].mask),2755986],['fuel',("" + bankPrivate.accounts[1].mask),44955]]);
  assert.throws(()=>requiredQuickBooksBankAccounts(rows.slice(0,1)));
  assert.throws(()=>requiredQuickBooksBankAccounts([...rows,{...rows[0],Id:'q4'}]));
  assert.throws(()=>requiredQuickBooksBankAccounts(rows.map(row=>row.Id==='q2'?{...row,Active:false}:row)));
  assert.throws(()=>requiredQuickBooksBankAccounts(rows.map(row=>row.Id==='q2'?{...row,CurrencyRef:{value:'CAD'}}:row)));
});
test('SNG composite invoice numbers match the QuickBooks document-number suffix',()=>{
  const input=evidence();
  input.sngInvoices[0].invoice_number='3567-232515-260826-1-3713267';
  input.invoices[0].DocNumber='S&G-3713267';
  assert.equal(compareFinancialEvidence(input).find(row=>row.id==='sng:invoice:s1').status,'resolved');
});
test('an explicit QuickBooks tax component permits a pre-tax SNG subtotal',()=>{
  const input=evidence();
  input.invoices[0].TotalAmt=92.81;
  input.invoices[0].TxnTaxDetail={TotalTax:7.81};
  assert.equal(compareFinancialEvidence(input).find(row=>row.id==='sng:invoice:s1').status,'resolved');
  input.invoices[0].TxnTaxDetail={TotalTax:7};
  assert.equal(compareFinancialEvidence(input).find(row=>row.id==='sng:invoice:s1').status,'open');
});
test('full review window persists with bounded database queries',async()=>{
  const {db,sqlite}=database();let prepared=0;
  const counted={...db,prepare(sql){prepared++;return db.prepare(sql);}};
  const cases=Array.from({length:2000},(_,i)=>({id:`case-${i}`,kind:'invoice',status:'open',evidence:{amountCents:i}}));
  await persistReconciliation(counted,cases,{status:'review_required'},'2026-09-23T12:00:00Z');
  assert.ok(prepared<10,'must stay within D1 invocation query budget');
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM financial_reconciliation_cases').get().n,2000);
});

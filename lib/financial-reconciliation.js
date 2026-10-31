import { getRuntimeEnv } from './cloudflare';
import { withQuickBooksReadOnlyClient } from './quickbooks';
import { compareSngQuickBooksInvoices, requiredQuickBooksBankAccounts } from './bank-reconciliation.mjs';
import { persistReconciliation } from './financial-reconciliation-store.mjs';
import { quickBooksBankMovements } from './quickbooks-bank-movements.mjs';

const CHECK_INTERVAL_MS=55*60*1000;
const LEASE_MS=15*60*1000;

async function qboEvidence(env,start,end) {
  const connection=await env.DB.prepare("SELECT realm_id,environment FROM quickbooks_connections WHERE id='primary'").first();
  if(!connection?.realm_id) throw new Error('QuickBooks is not connected.');
  return withQuickBooksReadOnlyClient(async ({get,environment})=>{
    if(environment!==connection.environment) throw new Error('QuickBooks environment changed.');
    const deadline=Date.now()+180000;
    async function query(entity,where='') {
      const rows=[];
      for(let page=0;page<10;page++) {
        if(Date.now()>deadline) throw new Error('QuickBooks read time budget exceeded.');
        const data=await get('query',{query:`SELECT * FROM ${entity} ${where} STARTPOSITION ${page*100+1} MAXRESULTS 100`});
        const response=data?.QueryResponse;
        const pageRows=response?.[entity] || [];
        if(!response || !Array.isArray(pageRows) || pageRows.length>100) throw new Error('Invalid QuickBooks response.');
        rows.push(...pageRows);
        if(pageRows.length<100) return rows;
      }
      throw new Error('QuickBooks evidence limit reached.');
    }
    const accounts=requiredQuickBooksBankAccounts(await query('Account',"WHERE AccountType = 'Bank'"));
    const where=`WHERE TxnDate >= '${start}' AND TxnDate <= '${end}'`;
    // Sequential reads avoid competing OAuth refresh-token rotations.
    const deposits=await query('Deposit',where);
    const payments=await query('Payment',where);
    const purchases=await query('Purchase',where);
    const transfers=await query('Transfer',where);
    const invoices=await query('Invoice',where);
    const movements=quickBooksBankMovements({deposits,payments,purchases,transfers});
    return {realmId:connection.realm_id,accounts,movements,invoices};
  });
}

async function withReconciliationLease(env,callback) {
  const now=new Date(),token=crypto.randomUUID();
  await env.DB.prepare("INSERT OR IGNORE INTO qbo_reconciliation_state(id) VALUES ('primary')").run();
  const result=await env.DB.prepare(`UPDATE qbo_reconciliation_state SET lease_token=?,lease_until=?
    WHERE id='primary' AND (lease_until IS NULL OR lease_until<=?) AND (next_check_at IS NULL OR next_check_at<=?)`)
    .bind(token,new Date(now.getTime()+LEASE_MS).toISOString(),now.toISOString(),now.toISOString()).run();
  if((result.meta?.changes ?? result.changes ?? 0)!==1) return {skipped:true,reason:'not_due_or_running'};
  try { return await callback(); }
  finally { await env.DB.prepare("UPDATE qbo_reconciliation_state SET lease_token=NULL,lease_until=NULL WHERE id='primary' AND lease_token=?").bind(token).run(); }
}

export async function runFinancialReconciliation(env=getRuntimeEnv()) {
  if(!env.DB) return {skipped:true,reason:'storage_unavailable'};
  return withReconciliationLease(env,async()=>{
    const now=new Date().toISOString();
    await env.DB.prepare("UPDATE qbo_reconciliation_state SET next_check_at=? WHERE id='primary'").bind(new Date(Date.now()+CHECK_INTERVAL_MS).toISOString()).run();
    const summary={status:'incomplete',checkedAt:now,source:'quickbooks',scope:'90-day QuickBooks book activity and archived SNG invoice totals; General Operations and Fuel reported separately',limitations:['QuickBooks is the only bank-data source in this no-cost version, so it cannot independently validate its own Amex feed.','Amex statement balances, available balances, pending transactions and the QuickBooks bank-feed review queue are outside the QuickBooks Accounting API used here.','The SNG archive is not a complete live billing inventory. Payment settlement, processor fees, refunds and chargebacks require separate evidence.','This check is read-only and never writes to QuickBooks or SNG.']};
    try {
      const start=new Date(Date.now()-90*86400000).toISOString().slice(0,10),end=now.slice(0,10);
      const qbo=await qboEvidence(env,start,end);
      const sng=await env.DB.prepare('SELECT invoice_id,invoice_number,client_name,total,invoice_created_at FROM sng_invoices WHERE substr(invoice_created_at,1,10)>=? AND substr(invoice_created_at,1,10)<=? LIMIT 1001').bind(start,end).all();
      if(sng.results.length>1000) throw new Error('SNG reconciliation evidence limit reached.');
      const cases=compareSngQuickBooksInvoices({invoices:qbo.invoices,sngInvoices:sng.results});
      summary.status='review_required';
      summary.accounts=qbo.accounts.map(account=>({...account,activityCount:qbo.movements.filter(m=>m.DepositToAccountRef?.value===account.id).length}));
      summary.combinedBookCents=qbo.accounts.reduce((sum,account)=>sum+account.bookCents,0);
      summary.counts={quickBooksCashEntries:qbo.movements.length,sngArchivedInvoices:sng.results.length,quickBooksInvoices:qbo.invoices.length,openChecks:cases.filter(c=>c.status==='open').length};
      await persistReconciliation(env.DB,cases,summary,now);
      await env.DB.prepare("UPDATE qbo_reconciliation_state SET realm_id=?,last_checked_at=?,last_error=NULL WHERE id='primary'").bind(qbo.realmId,now).run();
      return summary;
    } catch(error) {
      const code='check_incomplete';
      summary.error=code;
      await env.DB.prepare("UPDATE qbo_reconciliation_state SET last_checked_at=?,last_error=? WHERE id='primary'").bind(now,code).run();
      await persistReconciliation(env.DB,[],summary,now);
      console.error(JSON.stringify({event:'financial_reconciliation_incomplete',code,message:String(error?.message || error).slice(0,240)}));
      return summary;
    }
  });
}

function parseJson(value,fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

export async function getReconciliationStatus() {
  const env=getRuntimeEnv();
  if(!env.DB) return {configured:false,storageReady:false};
  try {
    const connection=await env.DB.prepare("SELECT realm_id,company_name,environment FROM quickbooks_connections WHERE id='primary'").first();
    const state=await env.DB.prepare("SELECT realm_id,last_checked_at,next_check_at,last_error FROM qbo_reconciliation_state WHERE id='primary'").first();
    const runs=await env.DB.prepare('SELECT checked_at,status,summary FROM financial_reconciliation_runs ORDER BY checked_at DESC LIMIT 10').all();
    const cases=await env.DB.prepare("SELECT * FROM financial_reconciliation_cases WHERE status='open' ORDER BY first_seen_at LIMIT 100").all();
    const count=await env.DB.prepare("SELECT COUNT(*) total FROM financial_reconciliation_cases WHERE status='open'").first();
    const parsedRuns=runs.results.map(row=>({...row,summary:parseJson(row.summary,{})}));
    return {configured:Boolean(connection?.realm_id),storageReady:true,connection,state,accounts:parsedRuns[0]?.summary?.source==='quickbooks'?parsedRuns[0].summary.accounts || []:[],openCount:Number(count?.total || 0),cases:cases.results.map(row=>({...row,evidence:parseJson(row.evidence,{})})),runs:parsedRuns};
  } catch { return {configured:false,storageReady:false}; }
}

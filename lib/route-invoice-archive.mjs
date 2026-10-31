// Merge the historical export with ongoing webhook invoices by provider identity.
// The export is authoritative at its capture time; a newer live invoice wins.
export const ROUTE_INVOICE_SQL = `WITH route_invoices AS (
 SELECT i.invoice_id,i.invoice_number,i.client_name,i.client_ref,
   COALESCE(h.client_id,'') client_id,i.invoice_type,i.billing_interval,
   substr(i.invoice_created_at,1,10) invoice_date,i.subtotal,
   COALESCE(NULLIF(json_extract(e.payload,'$.data.status'),''),h.status,'') status,
   json_extract(e.payload,'$.data.items') items
 FROM sng_invoices i LEFT JOIN sng_events e ON e.id=i.source_event_id
 LEFT JOIN route_invoice_history h ON h.invoice_id=i.invoice_id
 WHERE h.invoice_id IS NULL OR julianday(i.updated_at)>julianday(h.imported_at)
 UNION ALL
 SELECT h.invoice_id,h.invoice_number,h.client_name,NULL,h.client_id,
   h.invoice_type,NULL,h.invoice_date,h.subtotal,h.status,h.items
 FROM route_invoice_history h LEFT JOIN sng_invoices i ON i.invoice_id=h.invoice_id
 WHERE i.invoice_id IS NULL OR julianday(i.updated_at)<=julianday(h.imported_at)
   OR julianday(i.updated_at) IS NULL
)`;

export function archivedInvoice(row) {
  let items; try { items=JSON.parse(row.items || "[]"); } catch { items=[]; }
  const complete=Array.isArray(items)&&items.length>0&&items.length<=100;
  return { source:"Sweep & Go",id:String(row.invoice_id),customer:row.client_name,
    clientId:String(row.client_id||String(row.invoice_number||"").match(/^\d+-(\d+)-\d{6}-\d+-\d+$/)?.[1]||""),clientRef:String(row.client_ref||""),
    date:row.invoice_date,type:row.invoice_type,billingInterval:row.billing_interval,
    status:row.status,subtotal:row.subtotal,total:row.subtotal,complete,
    lines:complete ? items.map(item=>({description:String(item.description||"").slice(0,400),amount:item.amount==null||item.amount===""?null:Number(item.amount)})) : [] };
}

export const invoiceIsVoided = invoice => /^(void|voided|draft|deleted)$/i.test(String(invoice.status||""));

export async function readDatedRouteInvoices(db,from,through) {
  const result=await db.prepare(`${ROUTE_INVOICE_SQL} SELECT * FROM route_invoices
    WHERE invoice_date BETWEEN date(?,'-365 days') AND date(?,'+90 days') LIMIT 20001`).bind(from,through).all();
  if(result.results.length>20000)throw new Error("Historical invoice evidence exceeds its safe range.");
  return result.results.map(archivedInvoice).filter(i=>i.complete&&!invoiceIsVoided(i));
}

export async function readRouteInvoiceEvidence(db,names) {
  if(!names.length)return {invoices:[],complete:true};
  if(names.length>40)throw new Error("Invoice evidence exceeds its customer limit.");
  const result=await db.prepare(`${ROUTE_INVOICE_SQL} SELECT * FROM route_invoices
    WHERE client_name IN (${names.map(()=>"?").join(",")}) ORDER BY invoice_date DESC LIMIT 1001`).bind(...names).all();
  const invoices=(result.results||[]).slice(0,1000).map(archivedInvoice).filter(i=>!invoiceIsVoided(i));
  return {invoices,complete:result.results.length<=1000&&invoices.every(i=>i.complete)};
}

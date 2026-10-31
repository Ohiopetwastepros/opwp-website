import s from './sales-operations.module.css';
import pstyle from './purchase-lines.module.css';
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function Field({label,...props}){return <label className={s.field}><span>{label}</span><input {...props}/></label>;}
export default function PurchaseOrderFields({purchase={},products=[]}){
  return <><div className={s.formGrid}>
    <Field label="PO / supplier invoice number" name="number" defaultValue={purchase.number} required maxLength={200}/><Field label="Supplier" name="supplier" defaultValue={purchase.supplier||'Extreme Dog Fuel'} required maxLength={200}/>
    <Field label="Order date" name="date" type="date" defaultValue={purchase.date||today()} required/><Field label="Expected date" name="expected" type="date" defaultValue={purchase.expected}/>
    <Field label="Freight / pickup cost ($)" name="freight" type="number" min="0" step="0.01" defaultValue={(purchase.freightCents||0)/100}/><Field label="Supplier amount paid ($)" name="paid" type="number" min="0" step="0.01" defaultValue={(purchase.paidCents||0)/100}/>
    <Field label="Supplier payment reference" name="reference" defaultValue={purchase.reference} maxLength={200}/>
  </div><p className={s.caption}>Enter all formulas on the same invoice. Leave bags ordered at zero to exclude a formula. Received bags are cumulative; increasing them records only the new shipment on the receipt date below.</p>
  {products.filter(p=>p.active||purchase.lines?.some(l=>l.productId===p.id)).map(p=>{const line=purchase.lines?.find(l=>l.productId===p.id);return <fieldset key={p.id} className={pstyle.line}><legend>{p.name} · {p.weight} lb</legend><div className={s.formGrid}>
    <Field label="Bags ordered" name={`ordered:${p.id}`} type="number" min={line?.ordered?1:0} max="100000" step="1" defaultValue={line?.ordered||0} required/>
    <Field label="Cost per bag ($)" name={`cost:${p.id}`} type="number" min="0" step="0.01" defaultValue={(line?.costCents??p.costCents??0)/100} required/>
    <Field label="Total bags received to date" name={`received:${p.id}`} type="number" min={line?.received||0} step="1" defaultValue={line?.received||0} required/>
    <Field label="Date for newly received bags" name={`receivedDate:${p.id}`} type="date" defaultValue={today()}/>
    <Field label="New shipment lot number" name={`lot:${p.id}`} defaultValue={line?.lot} maxLength={200}/>
    <Field label="New shipment best before" name={`bestBefore:${p.id}`} type="date" defaultValue={line?.bestBefore}/>
  </div></fieldset>;})}
  <label className={s.field}><span>Purchase notes</span><textarea name="notes" defaultValue={purchase.notes} rows="3" maxLength={4000}/></label>
  <p className={s.caption}>Supplier payments do not add stock. Physical receipts do. Earlier receipt dates and lots remain in the stock ledger; partial arrivals are never counted twice.</p></>;
}

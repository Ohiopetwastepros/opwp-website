'use client';
import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {FOOD_STATES} from '@/lib/dog-food-profile.mjs';
import s from './food-customer-dialog.module.css';
export const invitationLabel=status=>({queued:'Queued',sending:'Sending',accepted:'Accepted by provider',suppressed:'Not sent: SMS opt-out',uncertain:'Needs delivery review',failed:'Failed',cancelled:'Cancelled'}[status]||'Not invited');
export default function FoodCustomerDialog({endpoint='/api/food-sales/customers/',customer=null,onClose,onSaved,onRefresh}){
  const dialog=useRef(null),command=useRef(crypto.randomUUID()),submitted=useRef(null),saving=useRef(false),[mounted,setMounted]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[refreshRequired,setRefreshRequired]=useState(false);
  const a=customer?.addresses?.find(a=>a.is_primary)||customer?.addresses?.[0];
  const [values,setValues]=useState({firstName:customer?.first_name||'',lastName:customer?.last_name||'',email:customer?.email||'',phone:customer?.phone||'',address:a?.line1||'',city:a?.city||'',state:a?.state||'OH',zip:a?.postal_code||'',dogCount:customer?.dog_count||'',customerType:customer?.customer_type||'on_demand',frequency:customer?.service_frequency||'as_needed',fulfillment:customer?.preferred_fulfillment||'delivery',placement:a?.placement_preference||'Front door',placementOther:a?.placement_other||'',notes:customer?.notes||'',smsConsent:Boolean(customer?.sms_consent_at)});
  useEffect(()=>{setMounted(true);},[]);
  useEffect(()=>{if(!mounted)return;const previous=document.activeElement;dialog.current?.showModal();dialog.current?.querySelector('input')?.focus();return()=>previous?.focus?.();},[mounted]);
  const set=(key,value)=>setValues(v=>({...v,[key]:value,...(key==='phone'?{smsConsent:false}:{})}));
  async function save(event){
    event.preventDefault();if(saving.current||refreshRequired)return;saving.current=true;setBusy(true);setError('');
    const body=submitted.current||{action:customer?'update_customer':'create_customer',commandId:command.current,...values,...(customer?{customerId:customer.id,revision:customer.revision||0,version:customer.version}:{})};submitted.current=body;
    try{
      const r=await fetch(endpoint,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),v=await r.json();
      if(!r.ok){if(r.status===400||v.definitive===true)submitted.current=null;if(v.refreshRequired===true)setRefreshRequired(true);throw Error(v.error||'Customer could not be confirmed. Search the customer hub before trying another submission.');}
      await onSaved(v.customer,v.messages||[]);
    }catch(e){setError(e.message);}finally{saving.current=false;setBusy(false);}
  }
  if(!mounted)return null;
  return createPortal(<dialog ref={dialog} className={s.dialog} onCancel={e=>{e.preventDefault();if(!busy)onClose();}} aria-labelledby='food-customer-title'><form onSubmit={save}>
    <header><div><small>EXTREME DOG FUEL / CUSTOMER RECORD</small><h2 id='food-customer-title'>{customer?'Edit customer information':'Add a new customer'}</h2></div><button type='button' disabled={busy} onClick={onClose} aria-label='Close customer form'>×</button></header>
    <p>{customer?'Changes stay linked to this customer’s sales and portal.':'Submit this record before the sale. We will email portal login instructions and send a welcome text. The customer verifies their email and chooses their password.'}</p>
    <fieldset disabled={busy}><legend>Contact information</legend><div className={s.grid}>
      {[['firstName','First name','text','given-name'],['lastName','Last name','text','family-name'],['email','Customer email','email','email'],['phone','Mobile phone','tel','tel']].map(([key,label,type,auto])=><label key={key}>{label}<input required name={key} type={type} autoComplete={auto} maxLength={key==='email'?254:80} readOnly={key==='email'&&Boolean(customer?.account_id)} value={values[key]} onChange={e=>set(key,e.target.value)}/></label>)}
    </div></fieldset>
    <fieldset disabled={busy}><legend>Customer address</legend><label>Street address<input required name='address' autoComplete='street-address' maxLength={200} value={values.address} onChange={e=>set('address',e.target.value)}/></label><div className={s.grid}>
      <label>City<input required name='city' autoComplete='address-level2' maxLength={100} value={values.city} onChange={e=>set('city',e.target.value)}/></label><label>State<select required name='state' autoComplete='address-level1' value={values.state} onChange={e=>set('state',e.target.value)}>{FOOD_STATES.map(v=><option key={v}>{v}</option>)}</select></label><label>ZIP code<input required name='zip' autoComplete='postal-code' inputMode='numeric' pattern='[0-9]{5}' maxLength={5} value={values.zip} onChange={e=>set('zip',e.target.value)}/></label>
    </div></fieldset>
    <fieldset disabled={busy}><legend>Food and service information</legend><div className={s.grid}>
      <label>Number of dogs<input required name='dogCount' type='number' min='1' max='99' step='1' value={values.dogCount} onChange={e=>set('dogCount',e.target.value)}/></label>
      <label>Customer type<select required name='customerType' value={values.customerType} onChange={e=>set('customerType',e.target.value)}><option value='on_demand'>Individual / food only</option><option value='scoop'>Existing scooping customer</option><option value='route_partner'>Route partner customer</option></select></label>
      <label>Service frequency<select required name='frequency' value={values.frequency} onChange={e=>set('frequency',e.target.value)}><option value='as_needed'>As needed</option><option value='weekly'>Weekly</option><option value='biweekly'>Every two weeks</option><option value='monthly'>Monthly</option></select></label>
      <label>Preferred handoff<select required name='fulfillment' value={values.fulfillment} onChange={e=>set('fulfillment',e.target.value)}><option value='delivery'>Delivery</option><option value='pickup'>Pickup</option></select></label>
      <label>Preferred delivery placement<select required name='placement' value={values.placement} onChange={e=>set('placement',e.target.value)}>{['Front door','Side door','Garage','Other'].map(v=><option key={v}>{v}</option>)}</select></label>
      {values.placement==='Other'&&<label>Delivery instructions<input required name='placementOther' maxLength={300} value={values.placementOther} onChange={e=>set('placementOther',e.target.value)}/></label>}
    </div><label>Notes (optional)<textarea name='notes' rows='3' maxLength={4000} value={values.notes} onChange={e=>set('notes',e.target.value)}/></label><small>Service frequency records the customer’s preference; billing and monthly plans are set separately.</small></fieldset>
    <label className={s.check}><input required name='smsConsent' type='checkbox' checked={values.smsConsent} onChange={e=>set('smsConsent',e.target.checked)}/>The customer agreed to receive portal setup and service texts at this mobile number.</label>
    {error&&<p role='alert' className={s.error}>{error}</p>}
    <footer><button type='button' disabled={busy} onClick={onClose}>Cancel</button>{refreshRequired?<button type='button' className={s.primary} disabled={busy} onClick={onRefresh||onClose}>Reload customer record</button>:<button className={s.primary} disabled={busy}>{busy?'Saving customer…':customer?'Save customer information':'Submit new customer & send portal access'}</button>}</footer>
  </form></dialog>,document.body);
}

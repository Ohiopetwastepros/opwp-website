'use client';
import {useEffect,useRef,useState} from 'react';
import styles from './staff-access.module.css';
const pendingKey='opwp-food-staff-invitation';
const labels={active:'Active',invited:'Awaiting setup',expired:'Setup expired',revoked:'Revoked',blocked:'Account blocked'};
const emails={accepted:'Accepted by email provider',uncertain:'Email needs review',sending:'Email acceptance unconfirmed',cancelled:'Invitation cancelled'};
const date=value=>value?new Date(value.replace(' ','T')+'Z').toLocaleString():'—';
async function api(body){
  const r=await fetch('/api/admin/dog-food/staff-access/',{cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})}),d=await r.json();
  if(!r.ok){const e=Error(d.error||'Staff access could not be confirmed.');e.definitive=[400,403,404,409,413].includes(r.status)||d.error?.includes('No account or password was changed.');throw e;}return d;
}
export default function StaffAccessClient(){
  const submitting=useRef(false);
  const [staff,setStaff]=useState([]),[emailConfigured,setEmailConfigured]=useState(false),[loading,setLoading]=useState(true);
  const [adding,setAdding]=useState(false),[name,setName]=useState(''),[email,setEmail]=useState(''),[plan,setPlan]=useState(null);
  const [confirm,setConfirm]=useState(false),[fieldAccess,setFieldAccess]=useState(false),[reset,setReset]=useState(false);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[query,setQuery]=useState(''),[filter,setFilter]=useState('all');
  const [revoking,setRevoking]=useState(null),[pending,setPending]=useState(null);
  async function load(){const d=await api();setStaff(d.staff);setEmailConfigured(d.emailConfigured);}
  useEffect(()=>{
    let active=true;
    api().then(d=>{if(active){setStaff(d.staff);setEmailConfigured(d.emailConfigured);}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});
    try{const saved=JSON.parse(sessionStorage.getItem(pendingKey)||'null');if(saved?.action==='invite'&&saved.commandId)setPending(saved);}catch{/* No mutation without a retained request. */}
    return()=>{active=false;};
  },[]);
  function begin(m=null){setName(m?.display_name||'');setEmail(m?.email||'');setPlan(null);setConfirm(false);setReset(false);setFieldAccess(false);setAdding(true);setRevoking(null);setError('');setMessage('');}
  async function prepare(e){e.preventDefault();setBusy(true);setError('');setConfirm(false);setReset(false);setFieldAccess(false);try{setPlan((await api({action:'prepare',email})).result);}catch(e){setError(e.message);}finally{setBusy(false);}}
  async function invite(payload=null){
    if(submitting.current)return;submitting.current=true;
    const request=payload||{action:'invite',commandId:crypto.randomUUID(),email:plan.email,name,confirm,acknowledgeExistingFieldAccess:fieldAccess,replaceExistingPassword:reset};
    setBusy(true);setError('');setMessage('');
    try{sessionStorage.setItem(pendingKey,JSON.stringify(request));setPending(request);const d=await api(request);sessionStorage.removeItem(pendingKey);setPending(null);setMessage(d.result.message);setPlan(null);setAdding(false);setConfirm(false);await load();}
    catch(e){if(e.definitive){sessionStorage.removeItem(pendingKey);setPending(null);}setError(e.message);}finally{submitting.current=false;setBusy(false);}
  }
  async function revoke(id){setBusy(true);setError('');setMessage('');try{const d=await api({action:'revoke',memberId:id,confirm:true});setMessage(d.result.message);setRevoking(null);await load();}catch(e){setError(e.message+' Refresh to confirm the current access status.');}finally{setBusy(false);}}
  const visible=staff.filter(m=>(filter==='all'||m.access_status===filter)&&`${m.display_name} ${m.email}`.toLowerCase().includes(query.trim().toLowerCase())),locked=busy||Boolean(pending);
  return <main className={styles.page}>
    <header className={styles.heading}><div><span className={styles.eyebrow}>DOG FOOD / STAFF ACCESS</span><h1>Staff accounts</h1><p>Approve individual accounts to add dog-food customers, edit eligible intake details and record new food sales.</p></div><button className={styles.primary} disabled={locked||loading} onClick={()=>begin()}>+ Add staff account</button></header>
    <div className={styles.summary} aria-label='Account summary'><span><strong>{staff.filter(m=>m.access_status==='active').length}</strong> Active</span><span><strong>{staff.filter(m=>['invited','expired'].includes(m.access_status)).length}</strong> Awaiting setup / expired</span><span><strong>{staff.filter(m=>m.access_status==='revoked').length}</strong> Revoked</span><a href='/food-sales/'>Staff sign-in ↗</a></div>
    {message&&<div className={styles.notice} role='status'>{message}</div>}{error&&<div className={styles.error} role='alert'>{error}</div>}
    {pending&&<section className={styles.warning}><h2>Confirm this invitation first</h2><p>{pending.email} · The previous response was not confirmed. Checking the same request will not send another email.</p><button disabled={busy} onClick={()=>invite(pending)}>Check invitation result</button></section>}
    {!loading&&!emailConfigured&&<div className={styles.warning} role='status'>Invitation email is unavailable. Existing accounts still work; new invitations wait until email service is available.</div>}
    {adding&&!pending&&<section className={styles.panel} aria-labelledby='staff-add-heading'>
      <div className={styles.panelHeading}><div><h2 id='staff-add-heading'>Add or renew staff access</h2><p>You approve the account. They receive an email and choose their own password.</p></div><button disabled={busy} onClick={()=>{setAdding(false);setPlan(null);}}>Cancel</button></div>
      <form onSubmit={prepare}><fieldset disabled={busy}><div className={styles.fields}><label>Name<input autoComplete='name' required maxLength={100} value={name} onChange={e=>{setName(e.target.value);setPlan(null);}}/></label><label>Individual email<input type='email' autoComplete='email' required maxLength={254} value={email} onChange={e=>{setEmail(e.target.value);setPlan(null);}}/></label></div><button disabled={!emailConfigured}>Review account</button></fieldset></form>
      {plan&&<div className={styles.approval}><h3>Review approval</h3><p><strong>{name}</strong> · {plan.email}</p><p>{plan.newMember?'New individual account.':'Existing individual account.'} Access: <strong>Dog-food customer intake and new sales.</strong></p><ul>{plan.permissions.map(permission=><li key={permission}>{permission}</li>)}</ul><p>Customer deletion, portal invitations, account linking or status changes, billing, later sale changes, receipts or handoffs, refunds, inventory management, reports and staff administration require the office. Staff cannot edit a customer after portal profile takeover.</p>
        {plan.existingFieldAccess&&<label className={styles.check}><input type='checkbox' checked={fieldAccess} disabled={busy} onChange={e=>setFieldAccess(e.target.checked)}/>This person already has separate field access. I confirm that existing access is intended.</label>}
        {plan.passwordSet&&<label className={styles.check}><input type='checkbox' checked={reset} disabled={busy} onChange={e=>setReset(e.target.checked)}/>Reset this food-sales password and sign out existing food-sales sessions.</label>}
        <label className={styles.check}><input type='checkbox' checked={confirm} disabled={busy} onChange={e=>setConfirm(e.target.checked)}/>I approve this person and the listed dog-food customer intake and sale permissions, and authorize the invitation email.</label>
        <button className={styles.primary} disabled={busy||!confirm||!emailConfigured||plan.existingFieldAccess&&!fieldAccess||plan.passwordSet&&!reset} onClick={()=>invite()}>Approve & email invitation</button><p className={styles.fine}>One-use link · Expires in 24 hours · Minimum 12-character password. No access until password setup is complete.</p>
      </div>}
    </section>}
    <section className={styles.panel} aria-labelledby='staff-directory-heading'>
      <div className={styles.panelHeading}><div><h2 id='staff-directory-heading'>All staff accounts</h2><p>Revoking access signs the person out and invalidates unused setup links.</p></div><button disabled={locked} onClick={()=>{setError('');load().catch(e=>setError(e.message));}}>Refresh</button></div>
      <div className={styles.filters}><label>Find an account<input type='search' placeholder='Name or email' value={query} onChange={e=>setQuery(e.target.value)}/></label><label>Status<select value={filter} onChange={e=>setFilter(e.target.value)}><option value='all'>All accounts</option>{Object.entries(labels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label></div>
      {loading?<p role='status'>Loading accounts…</p>:!visible.length?<p>No matching staff accounts.</p>:<div className={styles.directory}>{visible.map(m=><article className={styles.account} key={m.id}>
        <div className={styles.identity}><h3>{m.display_name}</h3><a href={'mailto:'+m.email}>{m.email}</a><span className={styles.scope}>Dog-food customer intake and new sales</span></div>
        <div className={styles.details}><span className={styles.badge} data-status={m.access_status}>{labels[m.access_status]}</span><p>Last sign-in: {date(m.last_login_at)}</p>{m.access_status==='invited'&&<p>Setup expires: {date(m.invitation_expires_at)}</p>}{m.email_status&&['invited','expired'].includes(m.access_status)&&<p>{emails[m.email_status]||'Email status unavailable'}</p>}</div>
        <div className={styles.actions}>{m.access_status!=='blocked'&&<button disabled={locked||!emailConfigured} onClick={()=>begin(m)}>{m.access_status==='revoked'?'Review reactivation':m.access_status==='active'?'Reset / send setup':'Review new invitation'}</button>}{Boolean(m.enabled)&&<button className={styles.danger} disabled={locked} onClick={()=>setRevoking(m.id)}>Revoke access</button>}</div>
        {revoking===m.id&&<div className={styles.revoke}><p><strong>Revoke {m.display_name}’s food-sales access now?</strong> Existing sales remain recorded under their name.</p><button className={styles.danger} disabled={locked} onClick={()=>revoke(m.id)}>Confirm revocation</button><button disabled={locked} onClick={()=>setRevoking(null)}>Keep access</button></div>}
      </article>)}</div>}
    </section>
  </main>;
}

"use client";
import { useEffect,useState } from 'react';
import s from './sandbox.module.css';
export default function SandboxFrame({children}){
 const [session,setSession]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[confirm,setConfirm]=useState(false);
 useEffect(()=>{fetch('/api/field-sandbox/session/',{cache:'no-store',signal:AbortSignal.timeout(15000)}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error);setSession(d);}).catch(e=>{if(!navigator.onLine)setSession({authenticated:true});else setError(e.message);});},[]);
 async function start(reset=false,keepSetup=false){setBusy(true);setError('');try{const r=await fetch('/api/field-sandbox/session/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:reset?'reset':'start',keepSetup})});const d=await r.json();if(!r.ok)throw new Error(d.error);window.location.assign('/field-sandbox/');}catch(e){setError(e.message);setBusy(false);}}
 return <><aside className={s.banner}>
  <div><b>OPWP TEST ENVIRONMENT</b><span>Fictional data · no customer texts, billing or payroll</span></div>
  <nav><a href='/field-sandbox/'>Technician</a><a href='/field-sandbox/office/'>Admin / office</a>{session?.authenticated?<><button onClick={()=>window.location.reload()}>Refresh view</button><a href='/api/field-sandbox/record/' target='_blank' rel='noreferrer'>Export test record</a><button onClick={()=>setConfirm(!confirm)}>Restart test</button></>:null}</nav>
 </aside>
 {error?<p className={s.error} role='alert'>{error}</p>:null}
 {confirm?<section className={s.intro}>
  <h2>Restart this browser’s training route?</h2><p>Export the test record first if you want to keep it. This starts a new fictional route for today. Existing office and technician tabs must reload; unsynced work stays with the previous session.</p>
  <button disabled={busy} onClick={()=>start(true,true)}>Restart route (keep setup)</button><button disabled={busy} onClick={()=>start(true,false)}>Reset route and catalog</button><button onClick={()=>setConfirm(false)}>Cancel</button>
 </section>:null}
 {session?.authenticated?children:<main className={s.intro}>
  <span>OHIO PET WASTE PROS · TRAINING</span><h1>Try the complete workday.</h1>
  <p>Four fictional properties: yard cleanup and sanitization, three litter boxes and haul-away, food delivery, and an access review.</p>
  <ol><li>Start the test day. Clock in with a sample odometer, finish loading checks and start your route.</li><li>Use sample proof to complete services. Try breaks, private notes, issues and end-of-day reconciliation.</li><li>Open Admin / office in another tab of this browser. Add services, propose a return visit, verify access or respond to an issue. Accept the changes in the technician screen.</li></ol>
  <p>Refresh reads saved progress. Restart test creates a new route. Each browser gets its own private test session, retained for seven days. No real account or PIN is needed.</p>
  <button disabled={busy||!session} onClick={()=>start()}>{busy?'Starting…':session?'Start test day':'Connecting…'}</button>
  <p><a href='https://www.ohiopetwastepros.com/admin/route-partner/workdays/' target='_blank' rel='noreferrer'>Open protected live office backend</a> · Requires your office login.</p>
 </main>}
 </>;
}

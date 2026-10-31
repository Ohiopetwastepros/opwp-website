"use client";

import { useState } from 'react';
import QRCode from 'qrcode';
import styles from './login.module.css';

export default function LoginForm({ next='/admin/', security=false, username='' }) {
  const [step,setStep]=useState(security?'security':'password');
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [setup,setSetup]=useState(null);
  const [codes,setCodes]=useState([]);
  const [recovery,setRecovery]=useState(false);
  const [saved,setSaved]=useState(false);
  async function submit(event){
    event.preventDefault();if(loading)return;setLoading(true);setError('');
    const form=new FormData(event.currentTarget);
    const action=step==='password'?'password':step==='security'?form.get('action'):'verify';
    try{
      const response=await fetch('/api/admin/session/',{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',body:JSON.stringify({action,username:form.get('username')||username,password:form.get('password'),code:form.get('code'),trustDevice:form.get('trustDevice')==='on'})});
      const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||'Sign-in could not be completed.');
      if(data.step==='revoked'){window.location.assign('/admin/login/');return;}
      if(data.step==='complete'){window.location.assign(data.recovery?'/admin/security/':next);return;}
      if(data.step==='enroll')setSetup({secret:data.secret,qr:await QRCode.toDataURL(data.uri,{width:240,margin:2,errorCorrectionLevel:'M'})});
      else setSetup(null);
      if(data.recoveryCodes?.length)setCodes(data.recoveryCodes);
      setStep(data.step);setLoading(false);
    }catch(e){setError(e.message||'Sign-in could not be completed.');setLoading(false);}
  }
  function downloadCodes(){
    const url=URL.createObjectURL(new Blob(['Ohio Pet Waste Pros recovery codes\nEach code works once, together with your password. Keep these somewhere safe, separate from your phone.\n\n'+codes.join('\n')],{type:'text/plain'}));
    const link=document.createElement('a');link.href=url;link.download='Ohio-Pet-Waste-Pros-recovery-codes.txt';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  if(step==='recovery_codes')return <div className={styles.form}><h3>Save your recovery codes</h3><p>Each code works once if you lose access to your authenticator. Store them somewhere safe, separate from your phone. These codes are shown only now.</p><pre className={styles.recoveryCodes}>{codes.join('\n')}</pre><button type="button" onClick={downloadCodes}>Download recovery codes</button><label className={styles.check}><input type="checkbox" checked={saved} onChange={e=>setSaved(e.target.checked)} /><span>I have saved my recovery codes</span></label><button type="button" disabled={!saved} onClick={()=>window.location.assign(next)}>Continue to workspace</button></div>;
  return <form key={step} className={styles.form} onSubmit={submit} aria-busy={loading}>
    {step==='password'||step==='security'?<>
      {step==='security'?<p>Confirm your password and a fresh authenticator code (or an unused recovery code) to change device security.</p>:null}
      <label><span>Username</span><input name="username" type="text" autoComplete="username" defaultValue={username} required autoFocus disabled={loading} maxLength={160}/></label>
      <label><span>Password</span><input name="password" type="password" autoComplete="current-password" required disabled={loading} maxLength={256}/></label>
      {step==='security'?<><label><span>Authenticator or recovery code</span><input name="code" autoComplete="one-time-code" required maxLength={40} disabled={loading}/></label><label><span>Security action</span><select name="action"><option value="revoke_all">Sign out every device</option><option value="reset">Replace my authenticator and recovery codes</option></select></label></>:null}
    </>:<>
      <h3>{step==='enroll'?'Set up your authenticator':'Verify your sign-in'}</h3>
      {setup?<><p>In your authenticator app, add an account and scan this QR code.</p><img className={styles.qr} src={setup.qr} width="240" height="240" alt="Scan this setup code with your authenticator app"/><details><summary>Enter a setup key instead</summary><code className={styles.setupKey}>{setup.secret}</code></details><p>Enter the six-digit code from your app to finish setup.</p></>:<p>{recovery?'Enter one of the recovery codes you saved during setup.':'Enter the current six-digit code from your authenticator app.'}</p>}
      <label><span>{recovery?'Recovery code':'Authenticator code'}</span><input name="code" type="text" inputMode={recovery?'text':'numeric'} autoComplete="one-time-code" required autoFocus maxLength={recovery?40:6} pattern={recovery?undefined:'[0-9]{6}'} disabled={loading}/></label>
      {!recovery?<label className={styles.check}><input name="trustDevice" type="checkbox" defaultChecked disabled={loading}/><span>Trust this browser for 30 days. Only use this on a device you control.</span></label>:<p>Recovery signs out your other devices and gives you a 12-hour session to review your security settings.</p>}
      {step==='verify'?<button className={styles.secondary} type="button" onClick={()=>setRecovery(!recovery)}>{recovery?'Use my authenticator instead':'Use a recovery code'}</button>:null}
    </>}
    {error?<div className={styles.formError} role="alert">{error}</div>:null}
    <button type="submit" disabled={loading}>{loading?'Checking…':step==='password'?'Continue':step==='security'?'Confirm security action':step==='enroll'?'Verify and enable authenticator':'Verify and sign in'}</button>
    {step!=='password'&&step!=='security'?<a href="/admin/login/">Start sign-in again</a>:null}
  </form>;
}

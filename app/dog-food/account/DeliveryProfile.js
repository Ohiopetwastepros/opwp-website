'use client';
import { useState } from 'react';
import { FOOD_STATES } from '@/lib/dog-food-profile.mjs';
import styles from './account.module.css';

const fields = [
  ['firstName','First name','given-name',80],
  ['lastName','Last name','family-name',80],
  ['phone','Phone','tel',40],
  ['address','Street address','address-line1',200],
  ['city','City','address-level2',100],
  ['zip','ZIP code','postal-code',5],
];

export default function DeliveryProfile({ profile, required, email, busy, error, onSave }) {
  const [placement,setPlacement] = useState(profile.placement);
  return <form className={styles.card} onSubmit={async event => {
    event.preventDefault();
    // Autofill can update the DOM without firing React change events. Capture
    // the displayed fields before any asynchronous work or state updates.
    const values = new FormData(event.currentTarget);
    const savedProfile = Object.fromEntries([...fields.map(([name])=>name),'state','fulfillmentMethod','placement','placementOther','dogCount','frequency'].map(name=>[name,String(values.get(name)||'')]));
    await onSave(savedProfile);
  }}>
    <div className={styles.profileIntro}><h2>Delivery & pickup profile</h2>{required&&<p role='status'>Welcome! Complete and save this profile before continuing. Your details will be remembered next time you sign in.</p>}<p className={styles.muted}>Verified email: {email}. Contact the office to change it.</p></div>
    <div className={styles.profileSections}>
      <fieldset className={styles.profileSection}><legend>Contact</legend><div className={styles.profileGrid}>{fields.filter(([name])=>['firstName','lastName','phone'].includes(name)).map(([name,label,autoComplete,maxLength])=><label key={name}>{label}<input name={name} autoComplete={autoComplete} required maxLength={maxLength} type={name==='phone'?'tel':'text'} inputMode={name==='zip'?'numeric':undefined} defaultValue={profile[name]} /></label>)}</div></fieldset>
      <fieldset className={styles.profileSection}><legend>Your address</legend><p>This is your contact and delivery address. The office confirms the pickup location separately.</p><div className={styles.profileGrid}>{fields.filter(([name])=>['address','city','zip'].includes(name)).map(([name,label,autoComplete,maxLength])=><label key={name}>{label}<input name={name} autoComplete={autoComplete} required maxLength={maxLength} type={name==='phone'?'tel':'text'} inputMode={name==='zip'?'numeric':undefined} defaultValue={profile[name]} /></label>)}<label>State<select name='state' autoComplete='address-level1' defaultValue={profile.state}>{FOOD_STATES.map(state=><option key={state} value={state}>{state}</option>)}</select></label></div></fieldset>
      <fieldset className={styles.profileSection}><legend>Your dogs & food routine</legend><div className={styles.profileGrid}><label>Number of dogs<input name='dogCount' type='number' min='1' max='99' step='1' required defaultValue={profile.dogCount}/></label><label>Food service frequency<select name='frequency' required defaultValue={profile.frequency||'as_needed'}><option value='as_needed'>As needed</option><option value='weekly'>Weekly</option><option value='biweekly'>Every two weeks</option><option value='monthly'>Monthly</option></select></label></div><p className={styles.muted}>This saves your preference. It does not start or change recurring billing.</p></fieldset>
      <fieldset className={styles.profileSection}><legend>Handoff preferences</legend><div className={styles.profileGrid}>      <label>Preferred handoff<select name='fulfillmentMethod' defaultValue={profile.fulfillmentMethod}><option value='delivery'>Delivery to my address</option><option value='pickup'>Pickup by arrangement (no delivery fee)</option></select></label>
      <label>Leave delivery bags at<select name='placement' defaultValue={profile.placement} onChange={event=>setPlacement(event.target.value)}>{['Front door','Side door','Garage','Other'].map(value=><option key={value}>{value}</option>)}</select></label>
      {placement==='Other'&&<label>Placement instructions<input name='placementOther' required maxLength={200} defaultValue={profile.placementOther} /></label>}
</div></fieldset>
    </div>
    <p className={`${styles.fine} ${styles.profileFootnote}`}>Changing this profile applies to new orders. Contact the office to change the address on existing orders or monthly plans. Pickup is available outside our delivery area, by arrangement with the office. We do not post specific pickup hours. New delivery areas and dates require office confirmation.</p>
    {error&&<p className={styles.error} role='alert'>{error}</p>}
    <button className={styles.primary} disabled={busy}>{busy?'Saving profile…':'Save delivery profile'}</button>
  </form>;
}

'use client';
import { useState } from 'react';
import { foodPasswordCriteria } from '@/lib/dog-food-password.mjs';
import styles from './account.module.css';

export default function PasswordFields({ creating }) {
  const [show,setShow]=useState(false),[values,setValues]=useState({password:'',confirm:''});
  const criteria=foodPasswordCriteria(values.password);
  function changed(event) {
    const form=event.currentTarget.form;
    const password=form.elements.namedItem('password').value;
    const confirmation=form.elements.namedItem('passwordConfirm');
    const confirm=confirmation?.value||'';
    confirmation?.setCustomValidity(confirm&&confirm!==password?'Both passwords must match.':'');
    setValues({password,confirm});
  }
  const requirements=[['length','At least 8 characters',criteria.length],['capital','One capital letter',criteria.capital],['special','One special character',criteria.special],['match','Passwords match',Boolean(values.password)&&values.password===values.confirm]];
  return <>
    <label htmlFor='food-password'>Password</label>
    <div className={styles.passwordField}><input id='food-password' name='password' type={show?'text':'password'} required minLength={creating?8:1} maxLength={256} autoComplete={creating?'new-password':'current-password'} onInput={changed} aria-describedby={creating?'food-password-requirements':undefined}/><button type='button' aria-label={show?'Hide password':'Show password'} aria-pressed={show} onClick={()=>setShow(value=>!value)}>{show?'Hide':'Show'}</button></div>
    {creating&&<>
      <label htmlFor='food-password-confirm'>Confirm password<input id='food-password-confirm' name='passwordConfirm' type={show?'text':'password'} required minLength={8} maxLength={256} autoComplete='new-password' onInput={changed} aria-describedby='food-password-requirements'/></label>
      <ul id='food-password-requirements' className={styles.passwordRequirements} aria-label='Password requirements'>{requirements.map(([key,label,met])=><li key={key} data-met={met}><span aria-hidden='true'>{met?'✓':'○'}</span><span>{label}<span className={styles.screenReader}>{met?' — met':' — not yet met'}</span></span></li>)}</ul>
    </>}
  </>;
}

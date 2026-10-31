import { TOTP, Secret } from 'otpauth';

export const TRUST_SECONDS = 30 * 86400;
export const SESSION_SECONDS = 12 * 3600;
export const CHALLENGE_SECONDS = 600;
export const MFA_SESSION_COOKIE = '__Host-opwp_admin_mfa';
export const MFA_CHALLENGE_COOKIE = '__Host-opwp_admin_challenge';
const encoder = new TextEncoder();
const nowSeconds = () => Math.floor(Date.now() / 1000);
export class MfaError extends Error {
  constructor(message, status = 401) { super(message); this.status = status; }
}
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const randomToken = () => hex(crypto.getRandomValues(new Uint8Array(32)));
export const hashToken = async value => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
const accountEmail = env => String(env.ADMIN_USERNAME || '').trim().toLowerCase();
function configured(env) {
  if (!env.DB || !env.ADMIN_USERNAME || !env.ADMIN_PASSWORD || !env.ADMIN_SESSION_SECRET || !env.ADMIN_MFA_ENCRYPTION_KEY) throw new MfaError('Secure sign-in is temporarily unavailable. Please try again later.', 503);
}
async function encryptionKey(env) {
  let bytes; try { bytes = Uint8Array.from(atob(env.ADMIN_MFA_ENCRYPTION_KEY), c => c.charCodeAt(0)); } catch {}
  if (bytes?.length !== 32) throw new MfaError('Secure sign-in is temporarily unavailable. Please try again later.', 503);
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt','decrypt']);
}
async function encryptSecret(env, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(accountEmail(env))}, await encryptionKey(env), encoder.encode(value)));
  return btoa(String.fromCharCode(...iv)) + '.' + btoa(String.fromCharCode(...encrypted));
}
async function decryptSecret(env, value) {
  const [iv, encrypted] = value.split('.').map(v => Uint8Array.from(atob(v), c => c.charCodeAt(0)));
  return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:encoder.encode(accountEmail(env))}, await encryptionKey(env), encrypted));
}
async function credentialTag(env) {
  const key=await crypto.subtle.importKey('raw',encoder.encode(env.ADMIN_SESSION_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(JSON.stringify([env.ADMIN_USERNAME,env.ADMIN_PASSWORD])))));
}
async function passwordValid(env, username, password) {
  if(typeof username !== 'string'||typeof password !== 'string'||username.length>160||password.length>256)return false;
  const [a,b]=await Promise.all([hashToken(JSON.stringify([username.trim(),password])),hashToken(JSON.stringify([env.ADMIN_USERNAME,env.ADMIN_PASSWORD]))]);
  let difference=0;for(let i=0;i<a.length;i++)difference|=a.charCodeAt(i)^b.charCodeAt(i);return difference===0;
}
function totp(secret, email) { return new TOTP({issuer:'Ohio Pet Waste Pros',label:email,algorithm:'SHA1',digits:6,period:30,secret:Secret.fromBase32(secret)}); }
function counterFor(secret,email,code,now) {
  if(typeof code!=='string'||!/^\d{6}$/.test(code))return null;
  const delta=totp(secret,email).validate({token:code,window:1,timestamp:now*1000});
  return delta===null?null:Math.floor(now/30)+delta;
}
export function mfaCookie(name,value,seconds) {
  return {name,value,httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:seconds};
}
export function readMfaCookie(headers,name) {
  const value=(headers.get('cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1)||'';
  return /^[a-f0-9]{64}$/.test(value)?value:'';
}
async function accountLimit(env,now) {
  const start=Math.floor(now/300)*300;
  const row=await env.DB.prepare(`INSERT INTO api_rate_limits(scope,client_key,window_start,request_count,expires_at) VALUES ('admin_mfa_account',?,?,1,datetime(?,'unixepoch')) ON CONFLICT(scope,client_key,window_start) DO UPDATE SET request_count=request_count+1 RETURNING request_count`).bind(await hashToken(accountEmail(env)),start,start+600).first();
  if(!row||row.request_count>20)throw new MfaError('Too many sign-in attempts. Wait five minutes and try again.',429);
}
async function account(env) {return env.DB.prepare('SELECT * FROM admin_mfa_accounts WHERE email=?').bind(accountEmail(env)).first();}
async function consumeFactor(env,record,code,now) {
  const step=counterFor(await decryptSecret(env,record.secret_cipher),record.email,code,now);
  if(step!==null){
    const changed=await env.DB.prepare('UPDATE admin_mfa_accounts SET last_counter=? WHERE email=? AND version=? AND last_counter<?').bind(step,record.email,record.version,step).run();
    if(changed.meta?.changes===1)return 'totp';
    return null;
  }
  const normalized=String(code||'').replace(/-/g,'').toLowerCase();
  if(!/^[a-f0-9]{32}$/.test(normalized))return null;
  const changed=await env.DB.prepare('UPDATE admin_mfa_recovery_codes SET used_at=? WHERE code_hash=? AND email=? AND auth_version=? AND used_at IS NULL').bind(now,await hashToken(normalized),record.email,record.version).run();
  return changed.meta?.changes===1?'recovery':null;
}
async function newChallenge(env,kind,record,now) {
  const token=randomToken();const secret=kind==='verify'?null:new Secret({size:20}).base32;
  const cipher=secret?await encryptSecret(env,secret):null;
  await env.DB.prepare('INSERT INTO admin_mfa_challenges(token_hash,email,kind,secret_cipher,auth_version,credential_tag,expires_at) VALUES (?,?,?,?,?,?,?)').bind(await hashToken(token),accountEmail(env),kind,cipher,record?.version||0,await credentialTag(env),now+CHALLENGE_SECONDS).run();
  await env.DB.prepare('DELETE FROM admin_mfa_challenges WHERE expires_at<?').bind(now-86400).run();
  return {challengeToken:token,step:kind==='verify'?'verify':'enroll',secret,uri:secret?totp(secret,accountEmail(env)).toString():null};
}
export async function beginMfaLogin(env,{username,password},now=nowSeconds()) {
  configured(env);await encryptionKey(env);await accountLimit(env,now);
  if(!await passwordValid(env,username,password))throw new MfaError('That username or password is not correct.');
  const record=await account(env);
  return newChallenge(env,record?'verify':'enroll',record,now);
}
export async function finishMfaLogin(env,token,{code,trustDevice=false},deviceLabel='',now=nowSeconds()) {
  configured(env);await accountLimit(env,now);
  if(!/^[a-f0-9]{64}$/.test(token||''))throw new MfaError('Sign in again to start a new verification.');
  const tokenHash=await hashToken(token);
  const challenge=await env.DB.prepare('UPDATE admin_mfa_challenges SET attempts=attempts+1 WHERE token_hash=? AND used_at IS NULL AND expires_at>? AND attempts<8 RETURNING *').bind(tokenHash,now).first();
  if(!challenge||challenge.email!==accountEmail(env)||challenge.credential_tag!==await credentialTag(env))throw new MfaError('Verification expired or too many attempts. Sign in again.');
  let record=await account(env);let recoveryCodes=[];let recovery=false;
  if(challenge.kind==='verify'){
    if(!record||record.version!==challenge.auth_version)throw new MfaError('Sign in again to start a new verification.');
    const factor=await consumeFactor(env,record,code,now);
    if(!factor)throw new MfaError('Code is invalid or already used. Try a fresh code.');
    recovery=factor==='recovery';
  }else{
    const step=counterFor(await decryptSecret(env,challenge.secret_cipher),challenge.email,code,now);
    if(step===null)throw new MfaError('The code did not match. Check the app and try again.');
    const claimed=await env.DB.prepare('UPDATE admin_mfa_challenges SET used_at=? WHERE token_hash=? AND used_at IS NULL AND expires_at>?').bind(now,tokenHash,now).run();
    if(claimed.meta?.changes!==1)throw new MfaError('Verification has already been used. Sign in again.');
    const version=challenge.auth_version+1;
    recoveryCodes=Array.from({length:10},()=>hex(crypto.getRandomValues(new Uint8Array(16))));
    // Atomic account version update plus conditionally associated codes makes
    // parallel enrollment/reset confirmations unable to replace each other.
    const statement=challenge.kind==='enroll'
      ? env.DB.prepare('INSERT OR IGNORE INTO admin_mfa_accounts(email,secret_cipher,version,last_counter,enabled_at) VALUES (?,?,?,?,?)').bind(challenge.email,challenge.secret_cipher,version,step,now)
      : env.DB.prepare('UPDATE admin_mfa_accounts SET secret_cipher=?,version=?,last_counter=?,enabled_at=? WHERE email=? AND version=?').bind(challenge.secret_cipher,version,step,now,challenge.email,challenge.auth_version);
    const codes=await Promise.all(recoveryCodes.map(async raw=>env.DB.prepare('INSERT INTO admin_mfa_recovery_codes(code_hash,email,auth_version) SELECT ?,email,version FROM admin_mfa_accounts WHERE email=? AND secret_cipher=? AND version=?').bind(await hashToken(raw),challenge.email,challenge.secret_cipher,version)));
    const results=await env.DB.batch([statement,...codes]);
    if(results[0].meta?.changes!==1)throw new MfaError('Authenticator settings changed. Sign in again.');
    // Keep the version whose factor was actually verified. Reading the latest
    // account here could resurrect this login after a concurrent revocation.
    record={email:challenge.email,version};
  }
  if(challenge.kind==='verify'){
    const consumed=await env.DB.prepare('UPDATE admin_mfa_challenges SET used_at=? WHERE token_hash=? AND used_at IS NULL AND expires_at>?').bind(now,tokenHash,now).run();
    if(consumed.meta?.changes!==1)throw new MfaError('Verification has already been used. Sign in again.');
  }
  if(recovery)record=await advanceVersion(env,record,now);
  const sessionToken=randomToken();const duration=trustDevice===true&&!recovery?TRUST_SECONDS:SESSION_SECONDS;
  const issued=await env.DB.prepare('INSERT INTO admin_mfa_sessions(token_hash,email,auth_version,credential_tag,created_at,expires_at,trusted,device_label) SELECT ?,email,version,?,?,?,?,? FROM admin_mfa_accounts WHERE email=? AND version=?').bind(await hashToken(sessionToken),await credentialTag(env),now,now+duration,duration===TRUST_SECONDS?1:0,String(deviceLabel).slice(0,160),challenge.email,record.version).run();
  if(issued.meta?.changes!==1)throw new MfaError('Security settings changed. Sign in again.');
  return {sessionToken,duration,expiresAt:now+duration,recoveryCodes:recoveryCodes.map(s=>s.match(/.{8}/g).join('-')),recovery};
}
export async function verifyMfaSession(env,token,now=nowSeconds()) {
  try{
    configured(env);await encryptionKey(env);
    if(!/^[a-f0-9]{64}$/.test(token||''))return {authorized:false};
    const row=await env.DB.prepare('SELECT s.* FROM admin_mfa_sessions s JOIN admin_mfa_accounts a ON a.email=s.email AND a.version=s.auth_version WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>?').bind(await hashToken(token),now).first();
    if(!row||row.email!==accountEmail(env)||row.credential_tag!==await credentialTag(env)||row.created_at>now||row.expires_at-row.created_at>TRUST_SECONDS)return {authorized:false};
    return {authorized:true,email:row.email,method:'mfa',expiresAt:row.expires_at};
  }catch{return {authorized:false};}
}
export async function revokeMfaSession(env,token,now=nowSeconds()) {
  configured(env);if(!/^[a-f0-9]{64}$/.test(token||''))return;
  await env.DB.prepare('UPDATE admin_mfa_sessions SET revoked_at=? WHERE token_hash=?').bind(now,await hashToken(token)).run();
}
export async function listMfaDevices(env,now=nowSeconds()) {
  configured(env);
  return (await env.DB.prepare('SELECT s.device_label,s.created_at,s.expires_at,s.trusted FROM admin_mfa_sessions s JOIN admin_mfa_accounts a ON a.email=s.email AND a.version=s.auth_version WHERE s.email=? AND s.revoked_at IS NULL AND s.expires_at>? ORDER BY s.created_at DESC LIMIT 50').bind(accountEmail(env),now).all()).results;
}
async function advanceVersion(env,record,now){
  // D1 batches are transactions. Every side effect is conditional on the
  // expected version, and the version advances last within that transaction.
  // A losing concurrent action must not touch newly established sessions.
  const changed=await env.DB.batch([
    env.DB.prepare('UPDATE admin_mfa_recovery_codes SET auth_version=? WHERE email=? AND auth_version=? AND EXISTS (SELECT 1 FROM admin_mfa_accounts WHERE email=? AND version=?)').bind(record.version+1,record.email,record.version,record.email,record.version),
    env.DB.prepare('UPDATE admin_mfa_sessions SET revoked_at=? WHERE email=? AND auth_version<=? AND revoked_at IS NULL AND EXISTS (SELECT 1 FROM admin_mfa_accounts WHERE email=? AND version=?)').bind(now,record.email,record.version,record.email,record.version),
    env.DB.prepare('UPDATE admin_mfa_challenges SET used_at=? WHERE email=? AND auth_version<=? AND used_at IS NULL AND EXISTS (SELECT 1 FROM admin_mfa_accounts WHERE email=? AND version=?)').bind(now,record.email,record.version,record.email,record.version),
    env.DB.prepare('UPDATE admin_mfa_accounts SET version=version+1 WHERE email=? AND version=?').bind(record.email,record.version),
  ]);
  if(changed[3].meta?.changes!==1)throw new MfaError('Security settings changed. Sign in again.');
  return {...record,version:record.version+1};
}
export async function changeMfaSecurity(env,{username,password,code,action},now=nowSeconds()) {
  configured(env);await accountLimit(env,now);
  if(!['revoke_all','reset'].includes(action))throw new MfaError('Choose a valid security action.',400);
  let record=await account(env);
  if(!await passwordValid(env,username,password)||!record||!await consumeFactor(env,record,code,now))throw new MfaError('Password or verification code is invalid or already used.');
  record=await advanceVersion(env,record,now);
  return action==='reset'?newChallenge(env,'reset',record,now):{revoked:true};
}

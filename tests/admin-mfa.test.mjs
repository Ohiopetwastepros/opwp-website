import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import vm from 'node:vm';
import { TOTP, Secret } from 'otpauth';
import * as mfa from '../lib/admin-mfa.mjs';
const now=1800000000,credentials={username:'owner@example.test',password:'test-password-long'};
function fixture(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(`CREATE TABLE api_rate_limits(scope TEXT,client_key TEXT,window_start INTEGER,request_count INTEGER,expires_at TEXT,PRIMARY KEY(scope,client_key,window_start));`);
 sqlite.exec(fs.readFileSync(new URL('../tmp/test-migrations/0041_admin_mfa.sql',import.meta.url),'utf8'));
 const DB={prepare(sql){const stmt=sqlite.prepare(sql);let args=[];return {bind(...values){args=values;return this;},async first(){return stmt.get(...args)||null;},async all(){return {results:stmt.all(...args)};},async run(){return {meta:stmt.run(...args)};}};},async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 const env={DB,ADMIN_USERNAME:credentials.username,ADMIN_PASSWORD:credentials.password,ADMIN_SESSION_SECRET:'test-signing-secret',ADMIN_MFA_ENCRYPTION_KEY:Buffer.alloc(32,5).toString('base64')};
 return {env,sqlite};
}
function code(secret,time=now){return new TOTP({secret:Secret.fromBase32(secret),algorithm:'SHA1',digits:6,period:30}).generate({timestamp:time*1000});}
async function enroll(env){const challenge=await mfa.beginMfaLogin(env,credentials,now);const result=await mfa.finishMfaLogin(env,challenge.challengeToken,{code:code(challenge.secret),trustDevice:true},'Test browser',now);return {...result,secret:challenge.secret};}
test('RFC 6238 reference vector and encrypted setup; password alone cannot create a session',async()=>{
 const reference=new TOTP({secret:Secret.fromUTF8('12345678901234567890'),digits:8,algorithm:'SHA1',period:30});assert.equal(reference.generate({timestamp:59000}),'94287082');
 const {env,sqlite}=fixture();await assert.rejects(mfa.beginMfaLogin(env,{...credentials,password:'wrong'},now));
 const challenge=await mfa.beginMfaLogin(env,credentials,now);assert.equal(challenge.step,'enroll');assert.match(challenge.uri,/^otpauth:\/\/totp\//);
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM admin_mfa_sessions').get().n,0);
 assert.equal((await mfa.verifyMfaSession(env,challenge.challengeToken,now)).authorized,false);
 assert.ok(!JSON.stringify(sqlite.prepare('SELECT * FROM admin_mfa_challenges').all()).includes(challenge.secret));
 await assert.rejects(mfa.finishMfaLogin(env,challenge.challengeToken,{code:'abcdef'},'',now));
});
test('trusted sessions expire at exactly 30 days without sliding renewal; logout revokes copied tokens',async()=>{
 const {env}=fixture();const result=await enroll(env);
 assert.equal(result.duration,30*86400);assert.equal(result.recoveryCodes.length,10);
 assert.equal((await mfa.verifyMfaSession(env,result.sessionToken,now+result.duration-1)).authorized,true);
 assert.equal((await mfa.verifyMfaSession(env,result.sessionToken,now+result.duration)).authorized,false);
 await mfa.revokeMfaSession(env,result.sessionToken,now+60);assert.equal((await mfa.verifyMfaSession(env,result.sessionToken,now+61)).authorized,false);
});
test('untrusted browser requires fresh MFA after 12 hours and TOTP replay cannot create another session',async()=>{
 const {env}=fixture();const first=await enroll(env);const challenge=await mfa.beginMfaLogin(env,credentials,now+60);
 const session=await mfa.finishMfaLogin(env,challenge.challengeToken,{code:code(first.secret,now+60)},'',now+60);assert.equal(session.duration,43200);
 await assert.rejects(mfa.finishMfaLogin(env,challenge.challengeToken,{code:code(first.secret,now+60)},'',now+60));
 const other=await mfa.beginMfaLogin(env,credentials,now+60);await assert.rejects(mfa.finishMfaLogin(env,other.challengeToken,{code:code(first.secret,now+60)},'',now+60),/already used/);
 assert.equal((await mfa.verifyMfaSession(env,session.sessionToken,now+60+43200)).authorized,false);
});
test('recovery codes are hashed, single-use, revoke old trust and invalidate pending logins',async()=>{
 const {env,sqlite}=fixture();const first=await enroll(env);const pending=await mfa.beginMfaLogin(env,credentials,now+60);const recovery=await mfa.beginMfaLogin(env,credentials,now+60);
 const result=await mfa.finishMfaLogin(env,recovery.challengeToken,{code:first.recoveryCodes[0],trustDevice:true},'',now+60);
 assert.equal(result.recovery,true);assert.equal(result.duration,43200);assert.equal((await mfa.verifyMfaSession(env,first.sessionToken,now+61)).authorized,false);
 await assert.rejects(mfa.finishMfaLogin(env,pending.challengeToken,{code:code(first.secret,now+60)},'',now+60));
 const again=await mfa.beginMfaLogin(env,credentials,now+60);await assert.rejects(mfa.finishMfaLogin(env,again.challengeToken,{code:first.recoveryCodes[0]},'',now+60));
 assert.ok(!JSON.stringify(sqlite.prepare('SELECT * FROM admin_mfa_recovery_codes').all()).includes(first.recoveryCodes[0].replaceAll('-','')));
});
test('revoke-all invalidates sessions and outstanding challenges; reset keeps MFA required',async()=>{
 const {env}=fixture();const first=await enroll(env);const pending=await mfa.beginMfaLogin(env,credentials,now+60);
 await mfa.changeMfaSecurity(env,{...credentials,action:'revoke_all',code:code(first.secret,now+60)},now+60);
 assert.equal((await mfa.verifyMfaSession(env,first.sessionToken,now+61)).authorized,false);await assert.rejects(mfa.finishMfaLogin(env,pending.challengeToken,{code:code(first.secret,now+90)},'',now+90));
 const reset=await mfa.changeMfaSecurity(env,{...credentials,action:'reset',code:first.recoveryCodes[0]},now+120);assert.equal(reset.step,'enroll');
 assert.equal((await mfa.beginMfaLogin(env,credentials,now+120)).step,'verify');
 const changed=await mfa.finishMfaLogin(env,reset.challengeToken,{code:code(reset.secret,now+120)},'',now+120);
 assert.equal((await mfa.verifyMfaSession(env,changed.sessionToken,now+121)).authorized,true);
 const old=await mfa.beginMfaLogin(env,credentials,now+120);await assert.rejects(mfa.finishMfaLogin(env,old.challengeToken,{code:first.recoveryCodes[1]},'',now+120));
});
test('expired challenges, attempt limits, missing configuration and password changes fail closed',async()=>{
 const {env}=fixture();const first=await enroll(env);const challenge=await mfa.beginMfaLogin(env,credentials,now+60);
 for(let i=0;i<8;i++)await assert.rejects(mfa.finishMfaLogin(env,challenge.challengeToken,{code:'bad'},'',now+60));
 await assert.rejects(mfa.finishMfaLogin(env,challenge.challengeToken,{code:code(first.secret,now+60)},'',now+60));
 const expired=await mfa.beginMfaLogin(env,credentials,now+600);await assert.rejects(mfa.finishMfaLogin(env,expired.challengeToken,{code:code(first.secret,now+1200)},'',now+1200));
 assert.equal((await mfa.verifyMfaSession({...env,ADMIN_PASSWORD:'new-password'},first.sessionToken,now+60)).authorized,false);
 for(const name of ['DB','ADMIN_MFA_ENCRYPTION_KEY','ADMIN_SESSION_SECRET']){assert.equal((await mfa.verifyMfaSession({...env,[name]:null},first.sessionToken,now)).authorized,false);await assert.rejects(mfa.beginMfaLogin({...env,[name]:null},credentials,now));}
});
test('competing initial enrollments cannot overwrite the first verified authenticator',async()=>{
 const {env,sqlite}=fixture();const first=await mfa.beginMfaLogin(env,credentials,now);const second=await mfa.beginMfaLogin(env,credentials,now);
 await mfa.finishMfaLogin(env,first.challengeToken,{code:code(first.secret)},'',now);
 await assert.rejects(mfa.finishMfaLogin(env,second.challengeToken,{code:code(second.secret)},'',now));
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM admin_mfa_recovery_codes').get().n,10);
});
test('Basic auth and legacy cookies are rejected, secure cookies are host-only, and there is no localhost prefix bypass',async()=>{
 const {env}=fixture();const source=fs.readFileSync(new URL('../lib/admin-auth.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
 const auth=runPrivateInNewContext(source+'\nverifyAdminRequest',{...mfa,getRuntimeEnv:()=>env,isProductionEnvironment:()=>true});
 assert.equal((await auth(new Headers({authorization:'Basic '+btoa(credentials.username+':'+credentials.password),cookie:'opwp_admin_session=old-token'}))).authorized,false);
 const cookie=mfa.mfaCookie(mfa.MFA_SESSION_COOKIE,'example',mfa.TRUST_SECONDS);assert.equal(cookie.secure,true);assert.equal(cookie.httpOnly,true);assert.equal(cookie.path,'/');assert.equal(cookie.domain,undefined);assert.ok(cookie.name.startsWith('__Host-'));
});

test('a revocation between enrollment and session issuance cannot grant the new security version',async()=>{
 const {env}=fixture();const challenge=await mfa.beginMfaLogin(env,credentials,now);
 const batch=env.DB.batch.bind(env.DB);let interrupted=false;
 env.DB.batch=async statements=>{
  const result=await batch(statements);
  if(!interrupted){interrupted=true;await mfa.changeMfaSecurity(env,{...credentials,action:'revoke_all',code:code(challenge.secret,now+60)},now+60);}
  return result;
 };
 await assert.rejects(mfa.finishMfaLogin(env,challenge.challengeToken,{code:code(challenge.secret)},'',now),/settings changed/i);
});

test('a stale security action cannot revoke a session created after a competing revocation',async()=>{
 const {env}=fixture();const first=await enroll(env);const batch=env.DB.batch.bind(env.DB);let interrupted=false,newSession;
 env.DB.batch=async statements=>{
  if(!interrupted){
   interrupted=true;
   await mfa.changeMfaSecurity(env,{...credentials,action:'revoke_all',code:first.recoveryCodes[0]},now+60);
   const pending=await mfa.beginMfaLogin(env,credentials,now+90);
   newSession=await mfa.finishMfaLogin(env,pending.challengeToken,{code:code(first.secret,now+90)},'',now+90);
  }
  return batch(statements);
 };
 await assert.rejects(mfa.changeMfaSecurity(env,{...credentials,action:'revoke_all',code:code(first.secret,now+60)},now+60),/settings changed/i);
 assert.equal((await mfa.verifyMfaSession(env,newSession.sessionToken,now+91)).authorized,true);
});

test('forged tokens, alternate cookie types and spoofed development hosts never authorize',async()=>{
 const {env}=fixture();await enroll(env);env.APP_ENV='development';env.ADMIN_DEV_BYPASS='true';
 const source=fs.readFileSync(new URL('../lib/admin-auth.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
 const auth=runPrivateInNewContext(source+'\nverifyAdminRequest',{...mfa,getRuntimeEnv:()=>env,isProductionEnvironment:()=>false});
 for(const host of ['localhost','127.0.0.1','localhost.evil.test','ohiopetwastepros.com']){
  for(const cookie of ['', 'opwp_admin_session=fake','opwp_office_session='+ 'a'.repeat(64),'opwp_field_session='+ 'a'.repeat(64),mfa.MFA_SESSION_COOKIE+'='+ 'a'.repeat(64)]){
   assert.equal((await auth(new Headers({host,cookie,'x-forwarded-host':'localhost','x-middleware-subrequest':'middleware:middleware:middleware:middleware:middleware'}))).authorized,false);
  }
 }
});

test('rate limits persist across new challenges and client changes',async()=>{
 const {env}=fixture();for(let n=0;n<20;n++)await assert.rejects(mfa.beginMfaLogin(env,{...credentials,password:'wrong'},now));
 await assert.rejects(mfa.beginMfaLogin(env,credentials,now),error=>error.status===429);
 assert.equal((await mfa.beginMfaLogin(env,credentials,now+300)).step,'enroll');
});

test('password and signing-key changes invalidate both pending challenges and established sessions',async()=>{
 for(const update of [{ADMIN_PASSWORD:'replacement-password'},{ADMIN_SESSION_SECRET:'replacement-signing-key'},{ADMIN_USERNAME:'different-owner@example.test'}]){
  const {env}=fixture();const first=await enroll(env);const pending=await mfa.beginMfaLogin(env,credentials,now+60);
  const changed={...env,...update};assert.equal((await mfa.verifyMfaSession(changed,first.sessionToken,now+60)).authorized,false);
  await assert.rejects(mfa.finishMfaLogin(changed,pending.challengeToken,{code:code(first.secret,now+60)},'',now+60));
 }
});

test('a stolen session alone cannot reset MFA; wrong passwords do not consume recovery codes',async()=>{
 const {env}=fixture();const first=await enroll(env);
 for(const action of ['reset','revoke_all']){
  await assert.rejects(mfa.changeMfaSecurity(env,{username:credentials.username,password:'wrong',code:first.recoveryCodes[0],action},now+60));
 }
 assert.equal((await mfa.changeMfaSecurity(env,{...credentials,code:first.recoveryCodes[0],action:'reset'},now+60)).step,'enroll');
});

test('corrupt encryption, missing storage and malformed factor input fail closed',async()=>{
 const {env,sqlite}=fixture();const first=await enroll(env);const pending=await mfa.beginMfaLogin(env,credentials,now+60);
 for(const code of [null,{},[],123456,'1234567','<script>alert(1)</script>'])await assert.rejects(mfa.finishMfaLogin(env,pending.challengeToken,{code},'',now+60));
 sqlite.prepare('UPDATE admin_mfa_accounts SET secret_cipher=?').run('corrupt.cipher');
 await assert.rejects(mfa.finishMfaLogin(env,pending.challengeToken,{code:code(first.secret,now+60)},'',now+60));
 for(const patch of [{DB:{prepare(){throw Error('offline');}}},{ADMIN_MFA_ENCRYPTION_KEY:'invalid'}])assert.equal((await mfa.verifyMfaSession({...env,...patch},first.sessionToken,now+60)).authorized,false);
});

test('trust values cannot extend the 30-day server limit and expired challenges cannot be revived',async()=>{
 const {env}=fixture();const first=await enroll(env);const pending=await mfa.beginMfaLogin(env,credentials,now+60);
 const result=await mfa.finishMfaLogin(env,pending.challengeToken,{code:code(first.secret,now+60),trustDevice:'true',duration:999999999,expiresAt:9999999999},'',now+60);
 assert.equal(result.duration,mfa.SESSION_SECONDS);
 const expired=await mfa.beginMfaLogin(env,credentials,now+300);
 await assert.rejects(mfa.finishMfaLogin(env,expired.challengeToken,{code:code(first.secret,now+900)},'',now+900));
});

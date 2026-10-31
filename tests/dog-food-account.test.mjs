import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import * as auth from '../lib/dog-food-account.mjs';
import {foodPasswordCriteria} from '../lib/dog-food-password.mjs';
import { nextFoodDelivery } from '../lib/dog-food-cadence.mjs';

export function accountFixture() {
  const sql = new DatabaseSync(':memory:');
  for (const file of ['0007_dog_food_foundation','0025_dog_food_stripe','0049_dog_food_operations','0050_dog_food_collections','0051_dog_food_customer_portal']) sql.exec(fs.readFileSync(new URL(`../tmp/test-migrations/${file}.sql`,import.meta.url),'utf8'));
  const db = {prepare:q => {
    function bound(args) {return {first:async()=>sql.prepare(q).get(...args)||null,all:async()=>({results:sql.prepare(q).all(...args)}),run:async()=>q.includes('RETURNING')?{results:sql.prepare(q).all(...args)}:{meta:sql.prepare(q).run(...args)}};}
    return {...bound([]),bind:(...args)=>bound(args)};
  },batch:async statements=>{sql.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};
  return {sql,db};
}
const now = 1800000000, password = 'A memorable dog food password!';
async function register(db,email='buyer@example.com') {
  let mail;
  await auth.beginFoodEmail(db,{email,kind:'verify',origin:'https://www.ohiopetwastepros.com',send:async m=>{mail=m;}},now);
  const temporary = mail.text.match(/Temporary password: (\S+)/)[1];
  const restricted = await auth.loginFoodAccount(db,{email,password:temporary},now+1);
  assert.equal(restricted.passwordChangeRequired,true);assert.equal(restricted.sessionToken,undefined);
  const session = await auth.redeemFoodEmail(db,{token:restricted.setupToken,password,passwordConfirm:password},now+2);
  return {session,temporary,restricted};
}
test('one-use temporary password verifies email but cannot access orders before mandatory password change',async()=>{
  const {db,sql}=accountFixture(),{session,temporary,restricted}=await register(db);
  assert.equal(sql.prepare('SELECT count(*) n FROM dog_food_accounts').get().n,1);
  assert.ok(!(sql.prepare('SELECT password_hash FROM dog_food_accounts').get().password_hash.includes(password)));
  const headers=new Headers({cookie:auth.foodCookie(session.sessionToken)}),account=await auth.foodAccountSession(db,headers,now+3);assert.equal(account.email,'buyer@example.com');
  await assert.rejects(auth.loginFoodAccount(db,{email:account.email,password:temporary},now+4));
  await assert.rejects(auth.redeemFoodEmail(db,{token:restricted.setupToken,password,passwordConfirm:password},now+4));
  assert.equal(await auth.foodAccountSession(db,headers,now+604803),null);
  assert.match(auth.foodCookie(session.sessionToken),/HttpOnly; Secure; SameSite=Lax/);
  assert.equal(await auth.foodAccountSession(db,new Headers({cookie:'opwp-admin=anything'}),now+3),null);
});
test('expired temporary passwords and failed email provider never create an account',async()=>{
  const {db,sql}=accountFixture();let mail;
  await auth.beginFoodEmail(db,{email:'new@example.com',kind:'verify',origin:'https://example.com',send:async m=>{mail=m;}},now);
  await assert.rejects(auth.loginFoodAccount(db,{email:'new@example.com',password:mail.text.match(/Temporary password: (\S+)/)[1]},now+1801));
  await assert.rejects(auth.beginFoodEmail(db,{email:'failed@example.com',kind:'verify',origin:'https://example.com',send:async()=>{throw Error('provider');}},now),/temporarily unavailable/);
  assert.equal(sql.prepare('SELECT count(*) n FROM dog_food_accounts').get().n,0);
  assert.ok(sql.prepare('SELECT used_at FROM dog_food_account_tokens WHERE email=?').get('failed@example.com').used_at);
});
test('verified email links exactly one existing profile, never a different email or ambiguous/archived profile',async()=>{
  const {db,sql}=accountFixture();sql.prepare("INSERT INTO dog_food_customers(id,first_name,last_name,email,phone) VALUES ('prior','Buyer','One','BUYER@example.com','4195550180')").run();
  const {session}=await register(db);const a=await auth.foodAccountSession(db,new Headers({cookie:auth.foodCookie(session.sessionToken)}),now+3);assert.equal(a.customer_id,'prior');
  assert.equal(sql.prepare('SELECT count(*) n FROM dog_food_customers').get().n,1);
  const f=accountFixture();f.sql.prepare("INSERT INTO dog_food_customers(id,first_name,last_name,email,phone,deleted_at) VALUES ('archived','B','O','buyer@example.com','4195550180',CURRENT_TIMESTAMP)").run();
  await assert.rejects(register(f.db),/office/);
});
test('reset links are hashed, single-use and revoke existing sessions; logout revokes copied cookies',async()=>{
  const {db,sql}=accountFixture(),{session}=await register(db);let mail;
  await auth.beginFoodEmail(db,{email:'buyer@example.com',kind:'reset',origin:'https://example.com',send:async m=>{mail=m;}},now+10);
  const raw=mail.text.match(/#reset=(\S+)/)[1];assert.ok(!JSON.stringify(sql.prepare('SELECT * FROM dog_food_account_tokens').all()).includes(raw));
  const newSession=await auth.redeemFoodEmail(db,{token:raw,password:password+'2',passwordConfirm:password+'2'},now+11);
  assert.equal(await auth.foodAccountSession(db,new Headers({cookie:auth.foodCookie(session.sessionToken)}),now+12),null);
  await assert.rejects(auth.redeemFoodEmail(db,{token:raw,password,passwordConfirm:password},now+12));
  await assert.rejects(auth.loginFoodAccount(db,{email:'buyer@example.com',password},now+12));
  const headers=new Headers({cookie:auth.foodCookie(newSession.sessionToken)});assert.ok(await auth.foodAccountSession(db,headers,now+12));await auth.logoutFoodAccount(db,headers,now+13);assert.equal(await auth.foodAccountSession(db,headers,now+14),null);
});
test('password bounds, forged cookies, SQL-shaped emails and weak passwords fail closed',async()=>{
  const {db}=accountFixture();await assert.rejects(auth.hashFoodPassword('short'));await assert.rejects(auth.hashFoodPassword('x'.repeat(257)));
  assert.equal(await auth.verifyFoodPassword('x'.repeat(100000),'bad'),false);assert.equal(await auth.foodAccountSession(db,new Headers({cookie:'__Host-opwp-food=forged'}),now),null);
  assert.equal(auth.foodEmail(" BAD@example.test\n"),"bad@example.test");
  assert.throws(()=>auth.foodEmail("x' OR 1=1 --"));
});

test('eight-character capital/special password and matching confirmation are enforced before consuming an activation or reset',async()=>{
  const {db,sql}=accountFixture();let mail;
  await auth.beginFoodEmail(db,{email:'confirmed@example.com',kind:'verify',origin:'https://example.com',send:async value=>{mail=value;}},now);
  const temporary=mail.text.match(/Temporary password: (\S+)/)[1];
  const restricted=await auth.loginFoodAccount(db,{email:'confirmed@example.com',password:temporary},now+1);
  const token=restricted.setupToken,valid='Abcdefg!';
  for(const password of ['Abcdef!','abcdefg!','Abcdefgh','Abcdefg ','Ábcdefg!','Abcdefg'+ '😀'.repeat(100)]) {
    await assert.rejects(auth.redeemFoodEmail(db,{token,password,passwordConfirm:password},now+2),/8 characters/);
  }
  for(const passwordConfirm of [undefined,'Abcdefg?','Abcdefg! '])await assert.rejects(auth.redeemFoodEmail(db,{token,password:valid,passwordConfirm},now+2),/must match/);
  assert.equal(sql.prepare('SELECT count(*) n FROM dog_food_accounts').get().n,0);
  assert.deepEqual(foodPasswordCriteria(valid),{length:true,capital:true,special:true,bounded:true});
  assert.equal(foodPasswordCriteria('Abcdefg_').special,true);
  assert.equal(foodPasswordCriteria('Abcdefg ').special,false);
  const session=await auth.redeemFoodEmail(db,{token,password:valid,passwordConfirm:valid},now+3);
  assert.ok(session.sessionToken);assert.ok(await auth.loginFoodAccount(db,{email:'confirmed@example.com',password:valid},now+4));
  await auth.beginFoodEmail(db,{email:'confirmed@example.com',kind:'reset',origin:'https://example.com',send:async value=>{mail=value;}},now+5);
  const resetToken=mail.text.match(/#reset=(\S+)/)[1];
  await assert.rejects(auth.redeemFoodEmail(db,{token:resetToken,password:'Resetme!',passwordConfirm:'different!'},now+6),/must match/);
  assert.ok(await auth.foodAccountSession(db,new Headers({cookie:auth.foodCookie(session.sessionToken)}),now+6));
  await auth.redeemFoodEmail(db,{token:resetToken,password:'Resetme!',passwordConfirm:'Resetme!'},now+7);
  assert.equal(await auth.foodAccountSession(db,new Headers({cookie:auth.foodCookie(session.sessionToken)}),now+8),null);
});
test('monthly dates preserve the original 31st anchor and fourth-week service weekday',()=>{
  assert.equal(nextFoodDelivery({next_delivery_date:'2027-01-31',billing_anchor_day:31}),'2027-02-28');
  assert.equal(nextFoodDelivery({next_delivery_date:'2027-02-28',billing_anchor_day:31}),'2027-03-31');
  assert.equal(nextFoodDelivery({next_delivery_date:'2026-10-22',delivery_cadence:'service_week',service_week:4,service_weekday:4}),'2026-11-26');
  assert.throws(()=>nextFoodDelivery({next_delivery_date:'2026-10-22',delivery_cadence:'service_week',service_week:5,service_weekday:4}));
  assert.throws(()=>nextFoodDelivery({next_delivery_date:'2026-02-31',billing_anchor_day:31}));
  assert.throws(()=>nextFoodDelivery({next_delivery_date:'2026-10-22',billing_anchor_day:32}));
});

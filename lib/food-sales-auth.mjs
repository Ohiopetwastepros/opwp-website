import {salesHash} from './food-sales-ledger.mjs';
import {hashFoodPassword,verifyFoodPassword} from './dog-food-account.mjs';
import {FoodError} from './dog-food-operations.mjs';

export const FOOD_SALES_COOKIE='opwp_food_sales_session';
const dummyHash=`scrypt:16384:8:5:${'A'.repeat(43)}:${'0'.repeat(64)}`;
const tokenFrom=headers=>{
  const part=String(headers.get('cookie')||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(FOOD_SALES_COOKIE+'='));
  try{return decodeURIComponent(part?.slice(FOOD_SALES_COOKIE.length+1)||'');}catch{return '';}
};
export function foodSalesCookie(token,url) {
  return {name:FOOD_SALES_COOKIE,value:token,httpOnly:true,secure:new URL(url).protocol==='https:',sameSite:'strict',path:'/',maxAge:8*3600};
}
export async function hashFoodSalesPassword(password) {
  if(typeof password!=='string'||password.length<8||password.length>12)throw new FoodError('Use 8-12 characters, including one capital letter and one symbol.');
  try{return await hashFoodPassword(password);}catch{throw new FoodError('Use 8-12 characters, including one capital letter and one symbol.');}
}
export async function authenticateFoodSales(db,email,password,verifyPassword=verifyFoodPassword) {
  if(typeof password!=='string'||new TextEncoder().encode(password).length>256)return {authorized:false};
  const row=await db.prepare(`SELECT m.id,m.display_name,m.email,c.password_hash,c.password_version,c.locked_until,g.revision
    FROM route_partner_members m JOIN dog_food_sales_credentials c ON c.member_id=m.id
    JOIN dog_food_sales_grants g ON g.member_id=m.id AND g.organization_id=m.organization_id
    JOIN route_partner_organizations o ON o.id=m.organization_id
    WHERE lower(m.email)=? AND m.organization_id='org-opwp' AND m.status='active' AND o.status='active' AND g.enabled=1 LIMIT 1`).bind(String(email).trim().toLowerCase()).first();
  const valid=await verifyPassword(password,row?.password_hash||dummyHash);
  if(!row||!row.password_hash)return {authorized:false};
  if(row.locked_until&&Date.parse(row.locked_until.replace(' ','T')+'Z')>Date.now())return {authorized:false,locked:true};
  if(!valid) {
    const updated=await db.prepare(`UPDATE dog_food_sales_credentials SET failed_attempts=failed_attempts+1,
      locked_until=CASE WHEN failed_attempts+1>=5 THEN datetime('now','+15 minutes') ELSE locked_until END,
      updated_at=CURRENT_TIMESTAMP WHERE member_id=? AND password_version=? RETURNING failed_attempts`).bind(row.id,row.password_version).first();
    return {authorized:false,locked:Number(updated?.failed_attempts)>=5};
  }
  const token=[...crypto.getRandomValues(new Uint8Array(32))].map(v=>v.toString(16).padStart(2,'0')).join('');
  const results=await db.batch([
    db.prepare(`INSERT INTO dog_food_sales_sessions(id,member_id,token_hash,grant_revision,credential_version,expires_at)
      SELECT ?,m.id,?,g.revision,c.password_version,datetime('now','+8 hours') FROM route_partner_members m
      JOIN dog_food_sales_credentials c ON c.member_id=m.id JOIN dog_food_sales_grants g ON g.member_id=m.id
      JOIN route_partner_organizations o ON o.id=m.organization_id
      WHERE m.id=? AND m.status='active' AND m.organization_id='org-opwp' AND o.status='active'
      AND g.enabled=1 AND g.organization_id=m.organization_id AND c.password_version=? AND c.password_hash IS NOT NULL
      AND (c.locked_until IS NULL OR c.locked_until<CURRENT_TIMESTAMP)`)
      .bind(crypto.randomUUID(),await salesHash(token),row.id,row.password_version),
    db.prepare("UPDATE dog_food_sales_credentials SET failed_attempts=0,locked_until=NULL,last_login_at=CURRENT_TIMESTAMP WHERE member_id=? AND password_version=? AND (locked_until IS NULL OR locked_until<CURRENT_TIMESTAMP)").bind(row.id,row.password_version),
  ]);
  if(!results[0]?.meta?.changes)return {authorized:false};
  return {authorized:true,token,member:{id:row.id,name:row.display_name||row.email}};
}
export async function activateFoodSalesPassword(db,{token,password,passwordConfirm}) {
  if(password!==passwordConfirm)throw new FoodError('Both passwords must match.');
  if(!/^[a-f0-9]{64}$/.test(token||''))throw new FoodError('This setup link is invalid or expired. Ask the office for a new link.');
  const tokenHash=await salesHash(token);
  const row=await db.prepare(`SELECT i.member_id,i.credential_version FROM dog_food_sales_invitations i
    JOIN dog_food_sales_credentials c ON c.member_id=i.member_id AND c.password_version=i.credential_version
    JOIN route_partner_members m ON m.id=i.member_id JOIN route_partner_organizations o ON o.id=m.organization_id
    JOIN dog_food_sales_grants g ON g.member_id=m.id AND g.organization_id=m.organization_id
    WHERE i.token_hash=? AND i.used_at IS NULL AND i.expires_at>CURRENT_TIMESTAMP AND g.enabled=1
    AND m.organization_id='org-opwp' AND m.status='active' AND o.status='active'`).bind(tokenHash).first();
  if(!row)throw new FoodError('This setup link is invalid or expired. Ask the office for a new link.');
  const passwordHash=await hashFoodSalesPassword(password),guard=crypto.randomUUID();
  try{await db.batch([
    db.prepare(`INSERT INTO dog_food_sales_write_guards(id,valid) VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM dog_food_sales_invitations i
      JOIN dog_food_sales_credentials c ON c.member_id=i.member_id AND c.password_version=i.credential_version
      JOIN route_partner_members m ON m.id=i.member_id JOIN dog_food_sales_grants g ON g.member_id=m.id AND g.organization_id=m.organization_id
      JOIN route_partner_organizations o ON o.id=m.organization_id
      WHERE i.token_hash=? AND i.used_at IS NULL AND i.expires_at>CURRENT_TIMESTAMP AND i.credential_version=?
      AND m.organization_id='org-opwp' AND m.status='active' AND o.status='active' AND g.enabled=1) THEN 1 ELSE 0 END)`).bind(guard,tokenHash,row.credential_version),
    db.prepare('UPDATE dog_food_sales_credentials SET password_hash=?,password_version=password_version+1,failed_attempts=0,locked_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE member_id=? AND password_version=?').bind(passwordHash,row.member_id,row.credential_version),
    db.prepare('UPDATE dog_food_sales_invitations SET used_at=CURRENT_TIMESTAMP WHERE member_id=? AND used_at IS NULL').bind(row.member_id),
    db.prepare('UPDATE dog_food_sales_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE member_id=? AND revoked_at IS NULL').bind(row.member_id),
    db.prepare("INSERT INTO dog_food_ops_audit(id,actor,action,entity_id,details) VALUES(?,?,'food_sales_password_set',?,'{}')").bind(crypto.randomUUID(),row.member_id,row.member_id),
    db.prepare('DELETE FROM dog_food_sales_write_guards WHERE id=?').bind(guard),
  ]);}catch{throw new FoodError('This setup link could not be confirmed. Try signing in, or ask the office for a new link.',409);}
  return {message:'Your password is set. Sign in with your email and password.'};
}
export async function verifyFoodSalesRequest(headers,db) {
  const token=tokenFrom(headers);if(!db||!/^[a-f0-9]{64}$/.test(token))return {authorized:false};
  const row=await db.prepare(`SELECT s.id session_id,m.id,m.display_name,m.email FROM dog_food_sales_sessions s
    JOIN route_partner_members m ON m.id=s.member_id JOIN route_partner_organizations o ON o.id=m.organization_id
    JOIN dog_food_sales_grants g ON g.member_id=m.id AND g.organization_id=m.organization_id
    JOIN dog_food_sales_credentials c ON c.member_id=m.id
    WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>CURRENT_TIMESTAMP
    AND s.last_seen_at>datetime('now','-30 minutes') AND m.status='active' AND m.organization_id='org-opwp' AND o.status='active'
    AND g.enabled=1 AND g.revision=s.grant_revision AND c.password_version=s.credential_version AND c.password_hash IS NOT NULL LIMIT 1`).bind(await salesHash(token)).first();
  if(!row)return {authorized:false};
  await db.prepare('UPDATE dog_food_sales_sessions SET last_seen_at=CURRENT_TIMESTAMP WHERE id=? AND revoked_at IS NULL').bind(row.session_id).run();
  return {authorized:true,sessionId:row.session_id,member:{id:row.id,name:row.display_name||row.email}};
}
export async function revokeFoodSalesSession(headers,db) {
  const token=tokenFrom(headers);if(token&&db)await db.prepare('UPDATE dog_food_sales_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE token_hash=?').bind(await salesHash(token)).run();
}

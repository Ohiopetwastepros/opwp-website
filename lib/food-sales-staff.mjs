import {FoodError,text} from './dog-food-operations.mjs';
import {salesHash,salesUuid} from './food-sales-ledger.mjs';

function staffEmail(value) {
  const email=typeof value==='string'?value.trim().toLowerCase():'';
  if(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new FoodError('Enter the staff member’s individual email address.');
  return email;
}
export async function prepareFoodSalesStaff(db,body) {
  const email=staffEmail(body.email),members=(await db.prepare(`SELECT m.id,m.email,m.display_name,m.role,m.status,g.enabled,
    CASE WHEN c.password_hash IS NOT NULL THEN 1 ELSE 0 END password_set,c.password_version
    FROM route_partner_members m LEFT JOIN dog_food_sales_grants g ON g.member_id=m.id
    LEFT JOIN dog_food_sales_credentials c ON c.member_id=m.id
    WHERE m.organization_id='org-opwp' AND lower(m.email)=? LIMIT 2`).bind(email).all()).results||[];
  if(members.length>1)throw new FoodError('Duplicate staff email identities need office review.',409);
  const member=members[0]||null;
  if(member&&(!['viewer','technician'].includes(member.role)||member.status!=='active'))throw new FoodError('This existing identity needs separate access review. It cannot be reused for a food-sales invitation.',409);
  return {email,member,newMember:!member,baseRole:member?.role||'viewer',permissions:['Find/add food customers','Record food sales','Record receipts and handoffs on own orders','Request office corrections'],existingFieldAccess:member?.role==='technician',passwordSet:Boolean(member?.password_set)};
}
export async function inviteFoodSalesStaff(db,body,actor,origin) {
  if(!actor||body.confirm!==true||!salesUuid(body.commandId))throw new FoodError('Review the exact staff identity and permissions, then confirm with a unique request ID.');
  const url=new URL(origin);if(url.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(url.hostname))throw new FoodError('A secure setup origin is required.');
  const hash=await salesHash(body),prior=await db.prepare('SELECT actor,payload_hash,result FROM dog_food_sales_commands WHERE id=?').bind(body.commandId).first();
  if(prior){if(prior.actor!==actor||prior.payload_hash!==hash)throw new FoodError('Request ID conflict.',409);return {...JSON.parse(prior.result),reused:true,message:'Setup was already issued. If the original link was not retained, explicitly issue a new setup link.'};}
  const plan=await prepareFoodSalesStaff(db,body),name=text(body.name,100)||plan.member?.display_name;
  if(!name)throw new FoodError('Enter the staff member’s name.');
  if(plan.existingFieldAccess&&body.acknowledgeExistingFieldAccess!==true)throw new FoodError('Confirm that this existing technician’s field access is intended.',409);
  if(plan.passwordSet&&body.replaceExistingPassword!==true)throw new FoodError('This account already has a password. Explicitly confirm a password reset.',409);
  const id=plan.member?.id||crypto.randomUUID(),version=(plan.member?.password_version||0)+1,guard=crypto.randomUUID();
  const token=[...crypto.getRandomValues(new Uint8Array(32))].map(v=>v.toString(16).padStart(2,'0')).join('');
  const result={memberId:id,email:plan.email,name,baseRole:plan.baseRole,permissions:plan.permissions,issued:true,expiresInHours:24};
  const statements=[db.prepare(`INSERT INTO dog_food_sales_write_guards(id,valid) VALUES(?,CASE WHEN EXISTS(
    SELECT 1 FROM route_partner_organizations WHERE id='org-opwp' AND status='active')
    AND (SELECT COUNT(*) FROM route_partner_members WHERE organization_id='org-opwp' AND lower(email)=?)=?
    AND COALESCE((SELECT password_version FROM dog_food_sales_credentials WHERE member_id=?),0)=? THEN 1 ELSE 0 END)`)
    .bind(guard,plan.email,plan.member?1:0,id,plan.member?.password_version||0)];
  if(!plan.member)statements.push(db.prepare("INSERT INTO route_partner_members(id,organization_id,email,display_name,role,status) VALUES(?,'org-opwp',?,?,'viewer','active')").bind(id,plan.email,name));
  else statements.push(db.prepare(`INSERT INTO dog_food_sales_write_guards(id,valid) VALUES(?,CASE WHEN EXISTS(
    SELECT 1 FROM route_partner_members WHERE id=? AND organization_id='org-opwp' AND status='active' AND role=? AND lower(email)=?) THEN 1 ELSE 0 END)`)
    .bind(guard+':identity',id,plan.baseRole,plan.email));
  statements.push(
    db.prepare(`INSERT INTO dog_food_sales_credentials(member_id,password_version) VALUES(?,1)
      ON CONFLICT(member_id) DO UPDATE SET password_hash=NULL,password_version=password_version+1,failed_attempts=0,locked_until=NULL,updated_at=CURRENT_TIMESTAMP`).bind(id),
    db.prepare(`INSERT INTO dog_food_sales_grants(member_id,organization_id,enabled,approved_by) VALUES(?,'org-opwp',1,?)
      ON CONFLICT(member_id) DO UPDATE SET enabled=1,revision=revision+1,approved_by=excluded.approved_by,approved_at=CURRENT_TIMESTAMP`).bind(id,actor),
    db.prepare('UPDATE dog_food_sales_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE member_id=? AND revoked_at IS NULL').bind(id),
    db.prepare('UPDATE dog_food_sales_invitations SET used_at=CURRENT_TIMESTAMP WHERE member_id=? AND used_at IS NULL').bind(id),
    db.prepare("INSERT INTO dog_food_sales_invitations(token_hash,member_id,credential_version,expires_at,issued_by) VALUES(?,?,?,datetime('now','+24 hours'),?)").bind(await salesHash(token),id,version,actor),
    db.prepare("INSERT INTO dog_food_ops_audit(id,actor,action,entity_id,details) VALUES(?,?,'food_sales_access_invited',?,?)").bind(crypto.randomUUID(),actor,id,JSON.stringify({email:plan.email,baseRole:plan.baseRole,permissions:plan.permissions,reset:plan.passwordSet,commandId:body.commandId})),
    // Deliberately retain neither the raw setup token nor a password in command/audit records.
    db.prepare('INSERT INTO dog_food_sales_commands(id,actor,payload_hash,result) VALUES(?,?,?,?)').bind(body.commandId,actor,hash,JSON.stringify(result)),
    db.prepare('DELETE FROM dog_food_sales_write_guards WHERE id IN(?,?)').bind(guard,guard+':identity'),
  );
  try{await db.batch(statements);}catch{throw new FoodError('Account setup could not be confirmed. Refresh the staff list before retrying.',409);}
  return {...result,setupUrl:url.origin+'/food-sales/#setup='+token,message:'Setup link created. Give it directly to this staff member so they can choose their own password. No email was sent.'};
}
export async function revokeFoodSalesStaff(db,memberId,actor) {
  const member=await db.prepare("SELECT id FROM route_partner_members WHERE id=? AND organization_id='org-opwp'").bind(memberId).first();
  if(!member)throw new FoodError('Staff identity not found.',404);
  await db.batch([
    db.prepare('UPDATE dog_food_sales_grants SET enabled=0,revision=revision+1 WHERE member_id=?').bind(member.id),
    db.prepare('UPDATE dog_food_sales_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE member_id=? AND revoked_at IS NULL').bind(member.id),
    db.prepare('UPDATE dog_food_sales_invitations SET used_at=CURRENT_TIMESTAMP WHERE member_id=? AND used_at IS NULL').bind(member.id),
    db.prepare("INSERT INTO dog_food_ops_audit(id,actor,action,entity_id,details) VALUES(?,?,'food_sales_access_revoked',?,'{}')").bind(crypto.randomUUID(),actor,member.id),
  ]);
  return {message:'Food-sales access revoked. Other existing staff permissions were not changed.'};
}

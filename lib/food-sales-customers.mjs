import {active,choice,text} from './dog-food-operations.mjs';
import {salesHash} from './food-sales-ledger.mjs';

const clean=v=>text(v,200).replace(/\s+/g,' ').trim();
const nameOf=c=>clean(`${c.first_name} ${c.last_name}`).toLowerCase();
const phoneOf=v=>String(v||'').replace(/\D/g,'').replace(/^1(?=\d{10}$)/,'');
const emailOf=v=>clean(v).toLowerCase();
const emailValid=v=>!v||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

// This creates directory contacts only. It never creates accounts, tokens, orders or receipts.
export async function planFoodSalesCustomers(snapshot,existing,sourceLinks=[]) {
  const customers=existing.map(c=>({...c})),creates=[],links=[],review=[];
  const mapped=new Map(sourceLinks.map(l=>[`${l.source_table}:${l.source_record_id}`,l.customer_id]));
  const records=[...(snapshot.tables?.Customers||[]).filter(active).filter(r=>!['inactive','paused'].includes(choice(r.fields['Customer Status']).toLowerCase())).map(r=>({table:'Customers',row:r,name:clean(r.fields['Customer Name']),email:emailOf(r.fields.Email),phone:clean(r.fields.Phone)})),
    ...(snapshot.tables?.Sales||[]).filter(active).map(r=>({table:'Sales',row:r,name:clean(r.fields['Sold To']),email:'',phone:''}))];
  for(const source of records){
    if(!source.name)continue;
    const key=`${source.table}:${source.row.id}`,old=mapped.get(key);
    if(old){if(!customers.some(c=>c.id===old))review.push({key,reason:'Existing source link has no customer'});continue;}
    if(!emailValid(source.email)||source.phone&&phoneOf(source.phone).length!==10){review.push({key,name:source.name,reason:'Contact details need review'});continue;}
    const byEmail=source.email?customers.filter(c=>emailOf(c.email)===source.email):[];
    const byPhone=source.phone?customers.filter(c=>phoneOf(c.phone)===phoneOf(source.phone)):[];
    const byName=customers.filter(c=>nameOf(c)===source.name.toLowerCase());
    let matches=byEmail.length?byEmail:byPhone.length?byPhone:byName;
    if(matches.length>1){review.push({key,name:source.name,reason:'More than one possible customer'});continue;}
    let match=matches[0];
    if(match&&(match.deleted_at||match.status!=='active')){review.push({key,name:source.name,reason:'Existing customer is archived or inactive'});continue;}
    if(match&&((source.email&&match.email&&emailOf(match.email)!==source.email)||(source.phone&&match.phone&&phoneOf(match.phone)!==phoneOf(source.phone)))){
      review.push({key,name:source.name,reason:'Contact conflicts with existing customer'});continue;
    }
    if(!match){
      const [first,...last]=source.name.split(' ');
      match={id:crypto.randomUUID(),first_name:first,last_name:last.join(' '),email:source.email,phone:source.phone,status:'active',deleted_at:null,airtable_record_id:source.table==='Customers'?source.row.id:null};
      customers.push(match);creates.push(match);
    }
    // Never overwrite an existing name, contact detail, account or profile address.
    links.push({source_table:source.table,source_record_id:source.row.id,customer_id:match.id,source_hash:await salesHash(source.row)});
    mapped.set(key,match.id);
  }
  return {version:1,existingHash:await salesHash(existing),creates,links,review,summary:{existing:existing.length,create:creates.length,sourceLinks:links.length,review:review.length,withoutEmail:creates.filter(c=>!c.email).length}};
}

export async function readFoodSalesCustomerDirectory(db) {
  return (await db.prepare('SELECT id,first_name,last_name,email,phone,status,deleted_at,airtable_record_id FROM dog_food_customers ORDER BY id').all()).results||[];
}
export async function applyFoodSalesCustomerPlan(db,plan,actor) {
  if(!actor||plan.version!==1||await salesHash(await readFoodSalesCustomerDirectory(db))!==plan.existingHash)throw Error('Customer directory changed; regenerate and review the import plan.');
  const statements=[];
  for(const c of plan.creates)statements.push(db.prepare("INSERT INTO dog_food_customers(id,first_name,last_name,email,phone,customer_type,airtable_record_id) VALUES(?,?,?,?,?,'on_demand',?)").bind(c.id,c.first_name,c.last_name,c.email,c.phone,c.airtable_record_id));
  for(const l of plan.links)statements.push(db.prepare('INSERT INTO dog_food_sales_customer_sources(source_table,source_record_id,customer_id,source_hash,imported_by) VALUES(?,?,?,?,?)').bind(l.source_table,l.source_record_id,l.customer_id,l.source_hash,actor));
  statements.push(db.prepare("INSERT INTO dog_food_ops_audit(id,actor,action,entity_id,details) VALUES(?,?,'food_sales_customer_directory_import','org-opwp',?)").bind(crypto.randomUUID(),actor,JSON.stringify(plan.summary)));
  await db.batch(statements);
  return plan.summary;
}

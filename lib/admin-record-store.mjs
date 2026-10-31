import { readBoundedProviderJson } from './bounded-body.mjs';
import { refreshSavedReviewAudit } from './google-review-state.mjs';
import { RECORD_BASES, RECORD_ID, TABLE_ID, RecordError, schemaForClient, validateRecordFields, recordVersion, stableJson, RECORD_TABLE_PATHS, nativeRecordWorkflow, fieldEditable } from './admin-record-policy.mjs';

const ROOT = 'https://api.airtable.com/v0';
const keyFor = id => 'admin_record_change:' + id;
const hasBase = base => RECORD_BASES.some(b=>b.id === base);
export async function recordProvider(env, path, options = {}) {
  if (!env.AIRTABLE_API_KEY || !env.DB) throw new RecordError('Record storage is unavailable.',503);
  const response = await fetch(ROOT + path, { ...options, headers: { Authorization: 'Bearer ' + env.AIRTABLE_API_KEY, Accept: 'application/json', ...(options.body ? {'Content-Type':'application/json'} : {}) }, cache: 'no-store', signal: AbortSignal.timeout(20000) });
  const data = await readBoundedProviderJson(response,2 * 1024 * 1024);
  if (!response.ok) throw new RecordError(response.status === 404 ? 'Record not found in this table.' : response.status === 422 ? 'The data store rejected a field or linked record. Reload the record and check your selections.' : 'The data store is unavailable. Your save has not been confirmed.',response.status === 404 ? 404 : 502);
  return data;
}
export async function savePrivateState(db,key,payload,status = 'success') {
  await db.prepare(`INSERT INTO airtable_cockpit_snapshots (snapshot_key,payload,status,captured_at,updated_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(snapshot_key) DO UPDATE SET payload=excluded.payload,status=excluded.status,captured_at=excluded.captured_at,updated_at=CURRENT_TIMESTAMP`)
    .bind(key,JSON.stringify(payload),status,new Date().toISOString()).run();
}
export async function readPrivateState(db,key) {
  const row = await db.prepare('SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key=?').bind(key).first();
  return row?.payload ? JSON.parse(row.payload) : null;
}
export async function recordCatalog(env) {
  const bases = [];
  for (const base of RECORD_BASES) {
    const schema = await baseSchema(env,base.id);
    bases.push({...base,tables:schema.tables.map(t=>({id:t.id,name:t.name,workflow:nativeRecordWorkflow(t.id)}))});
  }
  return bases;
}
export async function baseSchema(env,base) {
  if (!hasBase(base)) throw new RecordError('This business data store is not available.',404);
  const key = 'admin_record_schema:' + base;
  const cached = await readPrivateState(env.DB,key);
  if (cached?.capturedAt && Date.now()-Date.parse(cached.capturedAt)<600000) return cached;
  const data = await recordProvider(env,'/meta/bases/'+base+'/tables');
  const schema = {capturedAt:new Date().toISOString(),tables:(data.tables || []).slice(0,100)};
  await savePrivateState(env.DB,key,schema);
  return schema;
}
export async function ownedTable(env,base,tableId) {
  if (!TABLE_ID.test(tableId || '')) throw new RecordError('Choose a valid record table.',400);
  const schema = await baseSchema(env,base);
  const table = schema.tables.find(t=>t.id === tableId);
  if (!table) throw new RecordError('Table not found in this business data store.',404);
  return table;
}
function publicRecord(table,record) {
  const schema = schemaForClient(table,record);
  const fields = Object.fromEntries(schema.fields.map(f=>[f.name,record.fields?.[f.name] ?? null]));
  return {...record,fields};
}
export async function readBusinessRecord(env,base,tableId,id) {
  const table = await ownedTable(env,base,tableId);
  if (!RECORD_ID.test(id || '')) throw new RecordError('Choose a valid record.',400);
  const record = await recordProvider(env,'/'+base+'/'+tableId+'/'+id);
  if (record.id !== id) throw new RecordError('The returned record did not match your selection.',502);
  return {table:schemaForClient(table,record),record:publicRecord(table,record),version:await recordVersion(record)};
}
export async function listBusinessRecords(env,{base,table:tableId,search='',cursor='',ids=[]}) {
  const table = await ownedTable(env,base,tableId);
  if (typeof search !== 'string' || search.length>120 || typeof cursor !== 'string' || cursor.length>500 || /[\r\n\0]/.test(cursor)) throw new RecordError('The record search is too long.');
  const params = new URLSearchParams({pageSize:'50'});
  if (!Array.isArray(ids) || ids.length>20 || ids.some(id=>!RECORD_ID.test(id))) throw new RecordError('Choose up to 20 valid linked records.');
  if (cursor) params.set('offset',cursor);
  if (ids.length) params.set('filterByFormula','OR('+ids.map(id=>`RECORD_ID()='${id}'`).join(',')+')');
  else if (search.trim()) {
    const fields = table.fields.filter(f=>['singleLineText','multilineText','email','phoneNumber'].includes(f.type) && !/(password|secret|token|api.?key)/i.test(f.name)).slice(0,6);
    if (fields.length) {
      const query = search.trim().toLowerCase().replaceAll('\\','\\\\').replaceAll("'","\\'");
      params.set('filterByFormula','OR('+fields.map(f=>`FIND('${query}',LOWER({${f.name.replace(/[{}]/g,'')}}&''))`).join(',')+')');
    }
  }
  const data = await recordProvider(env,'/'+base+'/'+tableId+'?'+params);
  return {table:schemaForClient(table),records:(data.records || []).slice(0,50).map(r=>publicRecord(table,r)),cursor:data.offset || null};
}
export async function patchCockpitRecord(db,tableId,record,{created = false} = {}) {
  const parts = RECORD_TABLE_PATHS[tableId];
  if (!parts) return;
  const path = '$.'+parts.join('.');
  if (created) {
    await db.prepare(`UPDATE airtable_cockpit_snapshots SET payload=json_insert(payload,?,json(?)),updated_at=CURRENT_TIMESTAMP
      WHERE snapshot_key='business_cockpit' AND json_type(payload,?)='array' AND NOT EXISTS(SELECT 1 FROM json_each(payload,?) WHERE json_extract(value,'$.id')=?)`)
      .bind(path+'[#]',JSON.stringify(record),path,path,record.id).run();
  } else {
    await db.prepare(`UPDATE airtable_cockpit_snapshots SET payload=json_set(payload,
      ?||'['||(SELECT key FROM json_each(payload,?) WHERE json_extract(value,'$.id')=? LIMIT 1)||'].fields',
      json_patch((SELECT json_extract(value,'$.fields') FROM json_each(payload,?) WHERE json_extract(value,'$.id')=? LIMIT 1),json(?))),updated_at=CURRENT_TIMESTAMP
      WHERE snapshot_key='business_cockpit' AND EXISTS(SELECT 1 FROM json_each(payload,?) WHERE json_extract(value,'$.id')=?)`)
      .bind(path,path,record.id,path,record.id,JSON.stringify(record.fields),path,record.id).run();
  }
}
export async function withRecordLease(db,key,callback,ttlMs=900000) {
  const token = crypto.randomUUID();
  const result = await db.prepare(`INSERT INTO airtable_cockpit_snapshots (snapshot_key,payload,status,captured_at,updated_at) VALUES (?,?,'lock',?,CURRENT_TIMESTAMP)
    ON CONFLICT(snapshot_key) DO UPDATE SET payload=excluded.payload,captured_at=excluded.captured_at,updated_at=CURRENT_TIMESTAMP WHERE captured_at<?`)
    .bind('admin_record_lock:'+key,token,new Date(Date.now()+ttlMs).toISOString(),new Date().toISOString()).run();
  if (result.meta?.changes !== 1) throw new RecordError('Another save is in progress. Reload before trying again.',409);
  try { return await callback(); }
  finally { await db.prepare('DELETE FROM airtable_cockpit_snapshots WHERE snapshot_key=? AND payload=?').bind('admin_record_lock:'+key,token).run(); }
}
function byIdFields(table,fields) {
  return Object.fromEntries(table.fields.map(f=>[f.id,fields?.[f.name] ?? null]));
}
async function verifyLinks(env,base,table,fields) {
  let checks=0;
  for (const [id,value] of Object.entries(fields)) {
    const field=table.fields.find(f=>f.id === id);
    if (field.type !== 'multipleRecordLinks' || !value?.length) continue;
    const linked=await ownedTable(env,base,field.options?.linkedTableId);
    for (const recordId of new Set(value)) {
      if (++checks>20) throw new RecordError('Save at most 20 linked records at a time.');
      const record=await recordProvider(env,'/'+base+'/'+linked.id+'/'+recordId);
      if (record.id !== recordId) throw new RecordError('A linked record is not in the selected table.');
    }
  }
}
function sameField(field,actual,expected) {
  if (expected === null) return actual === null || actual === undefined || actual === '' || (Array.isArray(actual)&&!actual.length) || (field.type==='checkbox'&&actual===false);
  if (field.type === 'multipleAttachments') return expected.every(item=>item.id ? actual?.some(a=>a.id===item.id) : actual?.some(a=>a.filename===item.filename || a.url===item.url)) && actual?.length===expected.length;
  if (field.type === 'dateTime') return Date.parse(actual) === Date.parse(expected);
  return stableJson(actual) === stableJson(expected);
}
export async function saveBusinessRecord(env,body,actor) {
  const {base,table:tableId,recordId='',version,commandId,action='update'}=body;
  if (!/^[a-f0-9-]{36}$/.test(commandId || '') || !['create','update','undo'].includes(action)) throw new RecordError('This save request is invalid.');
  const table=await ownedTable(env,base,tableId);
  if (action!=='create'&&!RECORD_ID.test(recordId)) throw new RecordError('Choose a valid record.');
  return withRecordLease(env.DB,tableId==='tblzRg9DZKdIRQDrn'?'google-reviews':base+':'+tableId+':'+(recordId||'create'),async()=>{
    const prior=await readPrivateState(env.DB,keyFor(commandId));
    if (prior) {
      if (prior.base!==base || prior.table!==tableId || prior.actor!==actor || prior.recordId!==(recordId||prior.recordId) || prior.action!==action) throw new RecordError('This save identifier belongs to another change.',409);
      if (prior.state==='applied') { const result=await readBusinessRecord(env,base,tableId,prior.recordId); await patchCockpitRecord(env.DB,tableId,result.record,{created:action==='create'}); if(tableId==='tblzRg9DZKdIRQDrn')await refreshSavedReviewAudit(env.DB); return {...result,changeId:commandId,replayed:true}; }
      throw new RecordError('The earlier save has an unconfirmed outcome. Inspect the record and change history before starting a new save.',409);
    }
    const current=action==='create'?null:await recordProvider(env,'/'+base+'/'+tableId+'/'+recordId);
    if (current && (typeof version!=='string'||version!==await recordVersion(current))) throw new RecordError('This record changed since you opened it. Reload and review the latest values.',409);
    let supplied=body.fields;
    if (action==='undo') {
      const change=await readPrivateState(env.DB,keyFor(body.changeId));
      if (!change || change.state!=='applied' || change.base!==base || change.table!==tableId || change.recordId!==recordId || !change.before || change.action==='create') throw new RecordError('This change cannot be restored here.');
      const values=byIdFields(table,current.fields);
      if (!Object.entries(change.fields).every(([id,value])=>sameField(table.fields.find(f=>f.id===id),values[id],value))) throw new RecordError('These fields have changed again. Review and edit the current record instead of restoring an older value.',409);
      supplied=Object.fromEntries(Object.keys(change.fields).map(id=>{
        const f=table.fields.find(field=>field.id===id),before=change.before[id]??null;
        if(f?.type!=='multipleAttachments'||!Array.isArray(before))return [id,before];
        const currentAttachments=current.fields[f.name]||[];
        return [id,before.map(item=>currentAttachments.some(a=>a.id===item.id)?{id:item.id}:{url:item.url,filename:item.filename})];
      }));
    }
    const fields=validateRecordFields(table,current,supplied);
    const primary=table.fields.find(f=>f.id===table.primaryFieldId);
    if(action==='create'&&primary&&fieldEditable(primary,table.id,null)&&(fields[primary.id]===null||fields[primary.id]===undefined||fields[primary.id]===''))throw new RecordError('Enter '+primary.name+' before creating this record.');
    await verifyLinks(env,base,table,fields);
    const audit={id:commandId,base,table:tableId,tableName:table.name,recordId,action,actor,createdAt:new Date().toISOString(),state:'pending',before:current?byIdFields(table,current.fields):null,fields};
    await savePrivateState(env.DB,keyFor(commandId),audit,'pending');
    try {
      const returned=await recordProvider(env,'/'+base+'/'+tableId+(current?'/'+recordId:''),{method:current?'PATCH':'POST',body:JSON.stringify({fields,typecast:false})});
      audit.recordId=returned.id;
      if (!RECORD_ID.test(returned.id)) throw new RecordError('The saved record could not be verified.',502);
      const verified=await recordProvider(env,'/'+base+'/'+tableId+'/'+returned.id);
      const values=byIdFields(table,verified.fields);
      if (!Object.entries(fields).every(([id,value])=>sameField(table.fields.find(f=>f.id===id),values[id],value))) throw new RecordError('The saved values did not pass read-back verification. Inspect this record before another change.',502);
      audit.state='applied'; audit.verifiedAt=new Date().toISOString();
      await savePrivateState(env.DB,keyFor(commandId),audit);
      await patchCockpitRecord(env.DB,tableId,publicRecord(table,verified),{created:action==='create'});
      if(tableId==='tblzRg9DZKdIRQDrn')await refreshSavedReviewAudit(env.DB);
      return {record:publicRecord(table,verified),table:schemaForClient(table,verified),version:await recordVersion(verified),changeId:commandId};
    } catch(error) {
      if (audit.state!=='applied') { audit.state='unconfirmed'; await savePrivateState(env.DB,keyFor(commandId),audit,'failed'); }
      throw error;
    }
  });
}
export async function recordHistory(env,base,tableId,recordId) {
  const table=await ownedTable(env,base,tableId);
  if (!RECORD_ID.test(recordId)) throw new RecordError('Choose a valid record.');
  const result=await env.DB.prepare(`SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key LIKE 'admin_record_change:%'
    AND json_extract(payload,'$.base')=? AND json_extract(payload,'$.table')=? AND json_extract(payload,'$.recordId')=? ORDER BY captured_at DESC LIMIT 25`).bind(base,tableId,recordId).all();
  return (result.results||[]).map(row=>{const c=JSON.parse(row.payload);return {id:c.id,action:c.action,state:c.state,actor:c.actor,createdAt:c.createdAt,fields:Object.keys(c.fields).map(id=>({name:table.fields.find(f=>f.id===id)?.name||id,before:c.before?.[id]??null,after:c.fields[id]})),canUndo:c.state==='applied'&&Boolean(c.before)};});
}

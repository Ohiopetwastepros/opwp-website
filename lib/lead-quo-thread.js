import {readInboxRow,LeadInboxError} from './lead-inbox-store';
import {normalizePhone} from './lead-assistant.mjs';
import {readBoundedProviderJson} from './bounded-body.mjs';

// A provider read only: never replays historical messages through webhook automation,
// changes consent/unread state, or writes customer messages into another lead.
export async function loadQuoThread(db,env,id,body={},fetcher=fetch){
  const row=await readInboxRow(db,id);
  if(!row)throw new LeadInboxError('Lead not found.',404);
  const participant=normalizePhone(row.phone),from=normalizePhone(env.QUO_FROM_NUMBER);
  if(!participant)throw new LeadInboxError('Save a valid phone number before loading its text thread.');
  if(!from||!env.QUO_API_KEY)throw new LeadInboxError('Quo is not configured for this website.',503);
  if(body.pageToken!=null&&(typeof body.pageToken!=='string'||!body.pageToken||body.pageToken.length>2048))throw new LeadInboxError('Invalid message page. Refresh the thread.');
  const origin=env.QUO_API_BASE_URL||'https://api.openphone.com';
  if(!['https://api.openphone.com','https://api.quo.com'].includes(origin))throw new LeadInboxError('Quo connection configuration needs review.',503);
  async function read(path){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
    try{
      const response=await fetcher(origin+path,{method:'GET',headers:{Authorization:env.QUO_API_KEY,Accept:'application/json'},redirect:'manual',signal:controller.signal});
      if(!response.ok){await response.body?.cancel();throw new LeadInboxError(response.status===429?'Quo is busy. Wait a moment and try again.':'Quo could not load the thread. Try again or check the connection.',response.status===429?429:502);}
      return await readBoundedProviderJson(response,512*1024);
    }catch(e){if(e instanceof LeadInboxError)throw e;throw new LeadInboxError('Quo could not load the thread. Try again.',502);}
    finally{clearTimeout(timer);}
  }
  const numbers=await read('/v1/phone-numbers');
  const inbox=Array.isArray(numbers.data)&&numbers.data.find(n=>normalizePhone(n.number)===from&&typeof n.id==='string'&&/^PN[A-Za-z0-9_-]{1,100}$/.test(n.id));
  if(!inbox)throw new LeadInboxError('The configured OPWP number was not found in this Quo account.',503);
  const query=new URLSearchParams({phoneNumberId:inbox.id,participants:participant,maxResults:'100'});
  if(body.pageToken)query.set('pageToken',body.pageToken);
  const page=await read('/v1/messages?'+query);
  if(!Array.isArray(page.data)||page.data.length>100||!(page.nextPageToken==null||(typeof page.nextPageToken==='string'&&page.nextPageToken.length<=2048)))throw new LeadInboxError('Quo returned an invalid message page.',502);
  const messages=page.data.map(m=>{
    // Verify every result independently of the opaque provider pagination token.
    const incoming=m.direction==='incoming',outgoing=m.direction==='outgoing';
    if(m.phoneNumberId!==inbox.id||(!incoming&&!outgoing)||normalizePhone(m.from)!==(incoming?participant:from)||!Array.isArray(m.to)||m.to.length!==1||normalizePhone(m.to[0])!==(incoming?from:participant)||typeof m.id!=='string'||!/^AC[A-Za-z0-9_-]{1,150}$/.test(m.id)||!Number.isFinite(Date.parse(m.createdAt))||typeof m.text!=='string'||m.text.length>20000)throw new LeadInboxError('Quo returned a message outside this contact’s thread. Refresh the thread.',502);
    const media=(Array.isArray(m.media)?m.media:[]).slice(0,20).flatMap(item=>{
      try{const url=new URL(item.url);return url.protocol==='https:'&&!url.username&&!url.password&&item.url.length<=4096?[{url:item.url,type:typeof item.type==='string'?item.type.slice(0,100):'Attachment'}]:[];}catch{return [];}
    });
    return {id:'quo:'+m.id,provider_message_id:m.id,direction:incoming?'inbound':'outbound',body:m.text,created_at:new Date(m.createdAt).toISOString(),delivery_status:['queued','sent','delivered','undelivered','received'].includes(m.status)?m.status:'recorded',media};
  });
  // Do not display data if the owner corrected the contact while Quo was loading.
  const current=await readInboxRow(db,id);
  if(!current||normalizePhone(current.phone)!==participant)throw new LeadInboxError('The lead phone changed. Reload the lead before loading its thread.',409);
  return {messages,nextPageToken:page.nextPageToken||null,loadedAt:new Date().toISOString(),phone:participant};
}

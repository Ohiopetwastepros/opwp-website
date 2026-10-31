// Provider history overrides matching local webhook/send receipts, without hiding
// office notes or website events. A phone correction immediately hides old history.
export function mergeLeadThread(local=[],remote=[]){
  const messages=new Map();
  for(const message of [...local,...remote]){
    const key=message.provider_message_id?'quo:'+message.provider_message_id:message.id;
    messages.set(key,{...messages.get(key),...message});
  }
  return [...messages.values()].sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at)||a.id.localeCompare(b.id));
}

import {beginFoodEmail,foodTokenHash} from './dog-food-account.mjs';

// Each channel is claimed once. An uncertain send requires office review, never an automatic duplicate.
export async function processFoodCustomerMessages(db,{emailConfigured,smsConfigured,sendEmail,sendSms,origin,customerId=null,limit=4}={}){
  await db.prepare("UPDATE dog_food_customer_messages SET status='uncertain',detail='Sending was interrupted; check the provider before resending' WHERE status='sending' AND attempted_at<datetime('now','-10 minutes')").run();
  const rows=(await db.prepare("SELECT * FROM dog_food_customer_messages WHERE status='queued' AND (? IS NULL OR customer_id=?) ORDER BY created_at,id LIMIT ?").bind(customerId,customerId,Math.min(10,Math.max(1,limit))).all()).results||[];
  for(const row of rows){
    if(row.channel==='email'?!emailConfigured:!smsConfigured)continue;
    const current=await db.prepare(`SELECT c.email,c.phone,c.status,c.deleted_at,p.sms_consent_at FROM dog_food_customers c
      LEFT JOIN dog_food_customer_profiles p ON p.customer_id=c.id WHERE c.id=?`).bind(row.customer_id).first();
    if(!current||current.deleted_at||current.status!=='active'||row.recipient!==(row.channel==='email'?current.email:current.phone)){
      await db.prepare("UPDATE dog_food_customer_messages SET status='cancelled',detail='Customer contact or account status changed' WHERE id=? AND status='queued'").bind(row.id).run();continue;
    }
    if(row.channel==='sms'){
      const stopped=await db.prepare('SELECT suppressed FROM field_message_suppression WHERE phone=?').bind(row.recipient).first();
      const leadStop=await db.prepare("SELECT 1 blocked FROM lead_suppressions WHERE organization_id='org-opwp' AND phone_hash=? LIMIT 1").bind(await foodTokenHash(row.recipient)).first();
      if(!current.sms_consent_at||stopped?.suppressed||leadStop){await db.prepare("UPDATE dog_food_customer_messages SET status='suppressed',detail='SMS permission unavailable or recipient opted out' WHERE id=? AND status='queued'").bind(row.id).run();continue;}
    }
    const window=Math.floor(Date.now()/86400000)*86400;
    const budget=await db.prepare(`INSERT INTO api_rate_limits(scope,client_key,window_start,request_count,expires_at) VALUES('food_customer_invites',?,?,1,datetime(?,'unixepoch'))
      ON CONFLICT(scope,client_key,window_start) DO UPDATE SET request_count=request_count+1 WHERE request_count<100 RETURNING request_count`).bind(row.channel,window,window+172800).first();
    if(!budget)continue;
    const claimed=await db.prepare("UPDATE dog_food_customer_messages SET status='sending',attempted_at=CURRENT_TIMESTAMP WHERE id=? AND status='queued' AND EXISTS(SELECT 1 FROM dog_food_customers c WHERE c.id=dog_food_customer_messages.customer_id AND c.status='active' AND c.deleted_at IS NULL) RETURNING id").bind(row.id).first();if(!claimed)continue;
    try{
      let providerId;
      if(row.channel==='email'){
        await beginFoodEmail(db,{email:row.recipient,kind:'verify',origin,send:async message=>{providerId=await sendEmail({...message,subject:'Your Extreme Dog Fuel customer portal',text:'Your Extreme Dog Fuel customer profile is ready. Below are the instructions for accessing your online portal.\n\n'+message.text,idempotencyKey:'food-customer-welcome:'+row.id});}});
      }else{
        providerId=await sendSms({to:row.recipient,text:`Ohio Pet Waste Pros: Your Extreme Dog Fuel customer profile is ready. Check your email for your portal access instructions. Sign in: ${origin}/dog-food/account/ Questions? Call 419-262-2371. Reply STOP to opt out.`});
      }
      if(!providerId)throw Error('Provider acceptance was not confirmed');
      await db.prepare("UPDATE dog_food_customer_messages SET status='accepted',provider_message_id=?,detail='Accepted by provider; delivery is not independently confirmed',completed_at=CURRENT_TIMESTAMP WHERE id=? AND status='sending'").bind(providerId,row.id).run();
    }catch{
      await db.prepare("UPDATE dog_food_customer_messages SET status='uncertain',detail='Acceptance could not be confirmed. Check the provider before sending another invitation',completed_at=CURRENT_TIMESTAMP WHERE id=? AND status='sending'").bind(row.id).run();
    }
  }
}

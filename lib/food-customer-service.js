import {processFoodCustomerMessages} from './food-customer-messages.mjs';
import {sendTransactionalEmail,transactionalEmailConfig} from './submission-notifications';
import {outboundFetch} from './outbound-request';
import {readBoundedProviderJson} from './bounded-body.mjs';
import {applicationConfig} from './app-config';
export async function flushFoodCustomerMessages(env,{customerId=null,limit=4}={}){
  if(!env.DB)return;
  return processFoodCustomerMessages(env.DB,{
    customerId,limit,origin:applicationConfig(env).siteOrigin,
    emailConfigured:transactionalEmailConfig(env).configured,
    smsConfigured:env.SMS_PROVIDER==='quo'&&Boolean(env.QUO_API_KEY&&env.QUO_FROM_NUMBER),
    sendEmail:message=>sendTransactionalEmail(env,message),
    sendSms:async message=>{
      const response=await outboundFetch(new URL('/v1/messages',env.QUO_API_BASE_URL||'https://api.openphone.com'),{method:'POST',headers:{Authorization:env.QUO_API_KEY,Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({content:message.text,from:env.QUO_FROM_NUMBER,to:[message.to]})},{provider:'quo',operation:'food_customer_portal_invite',timeoutMs:12000,retries:0});
      const data=await readBoundedProviderJson(response,65536);const id=data?.data?.id||data?.id;if(!response.ok||!id)throw Error('SMS provider did not confirm acceptance');return id;
    }
  });
}

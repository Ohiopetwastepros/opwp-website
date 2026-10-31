// Read-only provider configuration review. Secret values and account credentials are never output.
import fs from 'node:fs';
const values = Object.fromEntries(fs.readFileSync('.dev.vars','utf8').split(/\r?\n/).filter(l=>/^[A-Z][A-Z0-9_]*\s*=/.test(l)).map(l=>{const at=l.indexOf('=');return [l.slice(0,at).trim(),l.slice(at+1).trim().replace(/^['"]|['"]$/g,'')];}));
export const providerEnv = {...values,...process.env};
if (process.argv[1]?.endsWith('dog-food-provider-check.mjs')) {
  for (const [provider, url, secret, auth] of [
    ['stripe','https://api.stripe.com/v1/webhook_endpoints','STRIPE_SECRET_KEY','Bearer '],
    ['resend','https://api.resend.com/domains','RESEND_API_KEY','Bearer '],
    ['airtable','https://api.airtable.com/v0/bases/appc40e3mlfOt2HoA/webhooks','AIRTABLE_API_KEY','Bearer '],
  ]) {
    if (!providerEnv[secret]) {console.log(JSON.stringify({provider,configured:false}));continue;}
    const response=await fetch(url,{headers:{Authorization:auth+providerEnv[secret]},signal:AbortSignal.timeout(15000)});
    const data=await response.json();
    console.log(JSON.stringify({provider,status:response.status,mode:provider==='stripe'?(providerEnv[secret].startsWith('sk_test_')?'test':'live'):undefined,
      endpoints:provider==='stripe'?data.data?.map(v=>({url:v.url,status:v.status,events:v.enabled_events})):undefined,
      domains:provider==='resend'?data.data?.map(v=>({name:v.name,status:v.status})):undefined,
      registered:provider==='airtable'?data.webhooks?.length:undefined}));
  }
}

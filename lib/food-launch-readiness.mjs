import {foodDate} from './dog-food-operations.mjs';
import release from './deployment-release.json' with {type:'json'};
export function applyFoodOpeningVerification(model,launch){
  if(!launch)return model;
  const threshold=launch.inventory_opening_verified_at?String(launch.inventory_opening_verified_at).slice(0,10):foodDate(new Date(String(launch.created_at).replace(' ','T').replace(/Z?$/,'Z'))),stale=[];
  for(const p of model.products.filter(p=>p.active))if(!p.countDate||p.countDate<threshold){stale.push(p.id);p.provisionalOnHand=p.onHand;p.provisionalAvailable=p.available;p.launchCountRequired=true;p.confirmed=false;p.onHand=null;p.available=null;model.issues.push({kind:'inventory',id:p.id,message:'A current physical opening count is required; old checkpoints are provisional.'});}
  if(stale.length){model.metrics.stockBags=null;model.metrics.stockValueCents=null;}
  model.inventoryOpening={requiredFromDate:threshold,verifiedAt:launch.inventory_opening_verified_at||null,staleProductIds:stale};return model;
}
export async function readFoodLaunchGate(db,env={}){
  const exists=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='dog_food_launch_readiness'").first(),row=exists?await db.prepare("SELECT * FROM dog_food_launch_readiness WHERE id='org-opwp'").first():null;
  const mode=String(env.STRIPE_SECRET_KEY||'').startsWith('sk_live_')?'live':String(env.STRIPE_SECRET_KEY||'').startsWith('sk_test_')?'test':'unconfigured';
  const settings=await db.prepare("SELECT posting_enabled,scheduling_enabled,email_enabled FROM dog_food_workflow_settings WHERE id='org-opwp'").first();
  const securitySourceMatches=Boolean(row?.security_reviewed_source_hash&&release.sourceHash&&row.security_reviewed_source_hash===release.sourceHash);
  const proof=Boolean(row?.inventory_opening_verified_at&&row.sources_reviewed_at&&row.checkout_test_verified_at&&row.saved_card_test_verified_at&&row.email_verified_at&&securitySourceMatches&&row.approved_by&&row.approved_at);
  return {orderingAvailable:Boolean(row?.public_ordering_enabled&&proof&&mode==='live'&&String(env.STRIPE_WEBHOOK_SECRET||'').startsWith('whsec_')&&settings?.posting_enabled&&settings?.scheduling_enabled&&settings?.email_enabled&&env.EMAIL_SENDING_ENABLED==='true'&&env.RESEND_API_KEY),mode,schemaReady:Boolean(exists),securitySourceMatches,releaseId:release.id,launch:row,workflow:settings};
}
export async function readFoodLaunchReadiness(db,env,model){
  const gate=await readFoodLaunchGate(db,env),today=foodDate(),products=model.products.filter(p=>p.active),lots=(await db.prepare('SELECT product_id,best_before,expiry_assumed,quarantined,counted_date,usable_bags FROM dog_food_stock_lots LIMIT 5001').all()).results||[];
  const checks=[
    {id:'schema',label:'Approved launch and customer migrations',passed:gate.schemaReady},
    {id:'independent',label:'Website operating ledger selected after reconciliation',passed:model.sync.backend==='website'},
    {id:'stripe',label:'Live Stripe key and webhook signing secret',passed:gate.mode==='live'&&String(env.STRIPE_WEBHOOK_SECRET||'').startsWith('whsec_'),detail:'Configured mode: '+gate.mode+'. Configuration alone does not prove successful payments.'},
    {id:'inventory',label:'Current usable stock and real lot / expiry evidence',passed:Boolean(products.length&&products.every(p=>p.confirmed&&p.countDate>=String(gate.launch?.inventory_opening_verified_at||today).slice(0,10)&&lots.some(l=>l.product_id===p.websiteId&&!l.expiry_assumed&&!l.quarantined&&l.best_before>=today&&l.counted_date>=p.countDate))),detail:'Old checkpoints and missing lot or expiration evidence cannot establish the launch opening balance.'},
    {id:'sources',label:'Cross-source sales, duplicate and fulfillment review',passed:Boolean(gate.launch?.sources_reviewed_at),detail:`${model.sourceReconciliation?.lines.filter(l=>!l.review||l.sourceChanged).length||0} archived food lines still need source review.`},
    {id:'checkout_test',label:'Stripe test-mode checkout and signed webhook evidence',passed:Boolean(gate.launch?.checkout_test_verified_at)},
    {id:'setup_test',label:'Stripe test-mode saved-card setup without a charge',passed:Boolean(gate.launch?.saved_card_test_verified_at)},
    {id:'email',label:'Verified email domain and synthetic transactional test',passed:Boolean(gate.launch?.email_verified_at&&env.RESEND_API_KEY&&env.EMAIL_SENDING_ENABLED==='true')},
    {id:'security',label:'Security and access checks tied to the release source',passed:gate.securitySourceMatches},
    {id:'capacity',label:'Office-confirmed future delivery or pickup capacity',passed:Boolean(await db.prepare('SELECT id FROM dog_food_delivery_capacity WHERE enabled=1 AND service_date>=? LIMIT 1').bind(today).first())},
    {id:'approval',label:'Separate owner approval to enable public ordering',passed:Boolean(gate.launch?.public_ordering_enabled&&gate.launch.approved_at)},
  ];
  return {...gate,checks,orderingAvailable:gate.orderingAvailable&&checks.every(c=>c.passed),asOf:new Date().toISOString(),sourceCoverage:{airtableLastVerified:model.sync.last_success_at||null,airtableDelayed:Boolean(model.sync.dirty||model.sync.last_error),sng:model.sourceReconciliation?.coverage.sng||null,stripe:model.sourceReconciliation?.coverage.stripe||null}};
}

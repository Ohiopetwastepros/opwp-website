import {FoodError,foodDate} from './dog-food-operations.mjs';
import {foodProfileComplete} from './dog-food-profile.mjs';
import {readLiveDensity} from './live-density-store.mjs';
import {foodInventoryDashboard,readInventoryCosts} from './dog-food-inventory.mjs';

export const FOOD_PLANNING_KEY='dog-food:planning:org-opwp:v1';
export const emptyFoodPlanning=()=>({existingStopMinutes:2,foodStopMinutes:2,supplierLeadDays:null,safetyDays:null,reviewDays:null,minimumOrderBags:null,orderMultipleBags:null,minimumOrderByColor:{Pink:null,Blue:null,Green:null,Red:null},mixedPalletMinimumBags:null,mixedPalletMultipleBags:null,mixedPalletMaxBags:null,freightCents:null,historyConfirmedFrom:null,historyConfirmedThrough:null,stockoutPeriods:[],routeMode:'both'});
const dayShift=(d,n)=>new Date(Date.parse(d+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
const round=n=>Math.round(n*10)/10;
const normalize=v=>String(v||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const utc=v=>Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(String(v))?v:String(v||'').replace(' ','T')+'Z');
const terminal=o=>Boolean(o.deleted_at)||['cancelled','refunded'].includes(o.status);
export function validateFoodPlanning(body) {
  const defaults=emptyFoodPlanning();
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!Object.hasOwn(defaults,k)))throw new FoodError('Choose valid planning settings.');
  const policy={...defaults};
  for(const [key,max,decimal] of [['existingStopMinutes',60,true],['foodStopMinutes',60,true],['supplierLeadDays',180,false],['safetyDays',180,false],['reviewDays',180,false],['minimumOrderBags',10000,false],['orderMultipleBags',10000,false],['mixedPalletMinimumBags',10000,false],['mixedPalletMultipleBags',10000,false],['mixedPalletMaxBags',10000,false],['freightCents',100000000,false]]) {
    const value=body[key];if(value===undefined||value===null||value===''){policy[key]=null;continue;}
    if(typeof value!=='number'&&typeof value!=='string')throw new FoodError('Planning values must be numbers.');
    const n=Number(value),min=key.endsWith('Bags')?1:key.endsWith('Minutes')?.1:0;
    if(!Number.isFinite(n)||n<min||n>max||!decimal&&!Number.isSafeInteger(n))throw new FoodError('Planning values are outside the supported range.');
    policy[key]=n;
  }
  for(const key of ['historyConfirmedFrom','historyConfirmedThrough']) {
    const value=body[key];if(value==null||value==='')continue;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T12:00:00Z'))||new Date(value+'T12:00:00Z').toISOString().slice(0,10)!==value||value>foodDate())throw new FoodError('Choose a valid past history coverage date.');
    policy[key]=value;
  }
  if(Boolean(policy.historyConfirmedFrom)!==Boolean(policy.historyConfirmedThrough)||policy.historyConfirmedFrom>policy.historyConfirmedThrough)throw new FoodError('Confirm both history dates in order.');
  if(body.stockoutPeriods!==undefined) {
    if(!Array.isArray(body.stockoutPeriods)||body.stockoutPeriods.length>24)throw new FoodError('Use up to 24 stockout periods.');
    policy.stockoutPeriods=body.stockoutPeriods.map(p=>{
      if(!p||typeof p!=='object'||Object.keys(p).some(k=>!['productId','start','end'].includes(k))||typeof p.productId!=='string'||p.productId.length>100)throw new FoodError('Choose a valid stockout product.');
      for(const v of [p.start,p.end])if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v+'T12:00:00Z'))||new Date(v+'T12:00:00Z').toISOString().slice(0,10)!==v||v>foodDate())throw new FoodError('Choose valid stockout dates.');
      if(p.start>p.end)throw new FoodError('Stockout dates must be in order.');return {productId:p.productId,start:p.start,end:p.end};
    });
  }
  if(body.routeMode!==undefined&&!['review','both','existing'].includes(body.routeMode))throw new FoodError('Choose an approved route planning mode.');
  const colorMinimum=body.minimumOrderByColor;
  if(colorMinimum!==undefined) {
    if(!colorMinimum||typeof colorMinimum!=='object'||Array.isArray(colorMinimum)||Object.keys(colorMinimum).some(k=>!Object.hasOwn(defaults.minimumOrderByColor,k)))throw new FoodError('Choose supported formula colors.');
    for(const color of Object.keys(defaults.minimumOrderByColor)) {
      const v=colorMinimum[color];if(v===null||v===undefined||v==='')continue;
      if(typeof v!=='string'&&typeof v!=='number'||!Number.isSafeInteger(Number(v))||Number(v)<1||Number(v)>10000)throw new FoodError('Formula minimums must be whole bags from 1 to 10,000.');
      policy.minimumOrderByColor[color]=Number(v);
    }
  }
  policy.routeMode=body.routeMode||'review';return policy;
}
export async function readFoodPlanning(db) {
  const row=await db.prepare('SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key=?').bind(FOOD_PLANNING_KEY).first();
  if(!row)return emptyFoodPlanning();
  if(typeof row.payload!=='string'||row.payload.length>16384)throw new FoodError('Planning configuration needs review.',503);
  const value=JSON.parse(row.payload);if(value.organizationId!=='org-opwp')throw new FoodError('Planning configuration needs review.',503);
  return validateFoodPlanning(value.policy);
}
export async function saveFoodPlanning(db,body,actor) {
  if(body.confirm!==true)throw new FoodError('Confirm the actual planning assumptions.');
  const policy=validateFoodPlanning(body.policy),payload=JSON.stringify({organizationId:'org-opwp',policy,updatedBy:actor});
  await db.prepare(`INSERT INTO airtable_cockpit_snapshots(snapshot_key,payload,status,captured_at,updated_at) VALUES (?,?,'success',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    ON CONFLICT(snapshot_key) DO UPDATE SET payload=excluded.payload,status='success',captured_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP`).bind(FOOD_PLANNING_KEY,payload).run();
  return {message:'Planning assumptions saved. Purchases, route changes and launch settings remain separate confirmed actions.'};
}
export function foodOrderStage(order) {
  if(terminal(order))return 'closed';
  if(order.status==='fulfilled'||order.delivery_status==='delivered'||order.pickup_status==='collected')return 'completed';
  if(order.delivery_status==='failed'||['payment_failed','payment_review'].includes(order.status)||order.automation_review)return 'exception';
  if(order.delivery_status==='out_for_delivery')return 'on_way';
  if(order.pickup_status==='ready')return 'pickup_ready';
  if(order.scheduled_date)return 'scheduled';
  if(['paid','scheduled'].includes(order.status))return 'paid_unscheduled';
  return 'awaiting_payment';
}
export function foodSalesIntelligence(model,{accounts=[],plans=[],planItems=[],projections=[],notices=[],settings={},routeSource=null,routePlans=[],policy=emptyFoodPlanning(),lots=[],costs=[],sync={},customerReviews=[],taskTimes=[],now=new Date()}={}) {
  const today=foodDate(now),month=today.slice(0,7),since=dayShift(today,-89),through=dayShift(today,30),orders=model.native?.orders||[];
  const sourceReady=Boolean(routeSource&&!routeSource.stale&&routeSource.status==='success');
  const months=Array.from({length:12},(_,i)=>{const d=new Date(month+'-15T12:00:00Z');d.setUTCMonth(d.getUTCMonth()-11+i);return d.toISOString().slice(0,7);});
  const fulfilled=(model.sales||[]).filter(s=>s.inventoryEligible&&s.stockDate<=today);
  const activePlans=plans.filter(p=>p.status==='active');
  const projectionByKey=new Map(projections.map(p=>[p.entity_key,p])),ordersByCustomer=new Map(),noticesByOrder=new Map();
  for(const o of orders){const rows=ordersByCustomer.get(o.customer_id)||[];rows.push(o);ordersByCustomer.set(o.customer_id,rows);}
  for(const n of notices){const rows=noticesByOrder.get(n.order_id)||[];rows.push(n);noticesByOrder.set(n.order_id,rows);}
  const reviewsByCustomer=new Map(customerReviews.map(r=>[r.customer_id,r]));
  const profiles=accounts.map(c=>{
    const own=(ordersByCustomer.get(c.id)||[]).filter(o=>!o.deleted_at),complete=Boolean(c.profile_completed_at&&foodProfileComplete(c,c));
    const projection=projectionByKey.get('customer:'+c.id);
    const candidates=(routeSource?.clients||[]).filter(r=>normalize(r.address)===normalize(c.line1)&&normalize(r.city)===normalize(c.city)&&r.zip===c.postal_code);
    const review=reviewsByCustomer.get(c.id);
    const linked=sourceReady&&review?.status==='reviewed'&&review.relationship==='linked'?candidates.filter(r=>r.id===review.opwp_record_id&&!r.duplicateProvider):[];
    return {id:c.id,name:[c.first_name,c.last_name].join(' ').trim(),email:c.email,phone:c.phone,address:[c.line1,c.city,c.state,c.postal_code].filter(Boolean).join(', '),placement:c.placement_preference==='Other'?c.placement_other:c.placement_preference,stage:!complete?'profile_required':own.length?'ordered':'profile_saved',createdAt:c.account_created_at,
      profileCompletedAt:c.profile_completed_at,orderCount:own.length,syncState:!projection?'not_queued':projection.last_error?'failed':projection.revision===projection.synced_revision?'verified':'pending',
      crmState:linked.length===1?'linked_active':review?.status==='pending'?'office_review_pending':review?.relationship==='food_only'?'food_only':candidates.length?'address_match_review':'relationship_unconfirmed',customerReview:review||null,currentRouteDays:linked.length===1?linked[0].serviceDays:[],preferredFulfillment:c.preferred_fulfillment||'delivery'};
  });
  const stages=['awaiting_payment','paid_unscheduled','scheduled','pickup_ready','on_way','completed','exception','closed'];
  const pipeline=orders.filter(o=>!o.deleted_at).map(o=>({...o,stage:foodOrderStage(o),syncState:(projectionByKey.get('order:'+o.id)||{}),
    noticeStates:(noticesByOrder.get(o.id)||[]).map(n=>({template:n.template,status:n.status,outcome:n.provider_outcome})),
    nextAction:foodOrderStage(o)==='paid_unscheduled'?'Confirm stock, route/capacity and first date':foodOrderStage(o)==='awaiting_payment'?'Customer completes secure payment':foodOrderStage(o)==='pickup_ready'?'Record actual pickup recipient':foodOrderStage(o)==='completed'?'Verify Airtable, stock and customer notice':foodOrderStage(o)==='exception'?'Resolve the recorded exception':foodOrderStage(o)==='scheduled'?'Verify load and release the assigned field task':'Review order history'}));
  const historicalProductIds=new Set(fulfilled.filter(s=>s.stockDate.slice(0,7)>=months[0]).map(s=>s.productId));
  const usage=months.map(m=>({month:m,formulas:(model.products||[]).filter(p=>p.active||historicalProductIds.has(p.id)).map(p=>({productId:p.id,color:p.color,formula:p.formula,weight:p.weight,bags:fulfilled.filter(s=>s.productId===p.id&&s.stockDate.slice(0,7)===m).reduce((n,s)=>n+s.quantity,0)}))}));
  const replenishment=(model.products||[]).filter(p=>p.active).map(p=>{
    const historyBags=fulfilled.filter(s=>s.productId===p.id&&s.stockDate>=since).reduce((n,s)=>n+s.quantity,0);
    const scheduledPlans=activePlans.filter(s=>s.next_delivery_date>=today&&s.next_delivery_date<=through);
    const scheduledPlanIds=new Set(scheduledPlans.map(s=>s.id)),activePlanIds=new Set(activePlans.map(s=>s.id));
    const planBags=planItems.filter(i=>i.is_active&&i.product_id===p.websiteId&&scheduledPlanIds.has(i.subscription_id)).reduce((n,i)=>n+Number(i.quantity),0);
    const monthlyPlanBags=planItems.filter(i=>i.is_active&&i.product_id===p.websiteId&&activePlanIds.has(i.subscription_id)).reduce((n,i)=>n+Number(i.quantity),0);
    const rate=Math.max(historyBags/90,monthlyPlanBags/30),lead=policy.supplierLeadDays,safety=policy.safetyDays,minimum=policy.minimumOrderByColor?.[p.color]??policy.minimumOrderBags;
    const incoming=(model.pos||[]).filter(po=>!['Cancelled','Received'].includes(po.status)).flatMap(po=>po.lines.filter(l=>l.productId===p.id&&l.ordered>l.received).map(l=>({quantity:l.ordered-l.received,expected:po.expected,po:po.number})));
    const timely=lead==null?0:incoming.filter(i=>i.expected>=today&&i.expected<=dayShift(today,lead)).reduce((n,i)=>n+i.quantity,0);
    const threshold=lead==null||safety==null?p.reorderPoint||0:Math.max(p.reorderPoint||0,Math.ceil(rate*(lead+safety)));
    const position=p.available==null?null:p.available+timely,configured=lead!=null&&safety!=null&&minimum!=null;
    const qty=position==null||!configured?null:position<=threshold?Math.ceil(Math.max(minimum,threshold-position)/minimum)*minimum:0;
    const cover=p.available==null||rate<=0?null:Math.max(0,p.available)/rate;
    const eligibleLots=lots.filter(l=>l.product_id===p.websiteId);
    return {productId:p.id,color:p.color,formula:p.formula,weight:p.weight,onHand:p.onHand,reserved:p.reserved,available:p.available,history90Bags:historyBags,recurring30Bags:planBags,recurringMonthlyBags:monthlyPlanBags,
      dailyDemand:Math.round(rate*100)/100,coverDays:cover==null?null:round(cover),threshold,incomingBags:incoming.reduce((n,i)=>n+i.quantity,0),incomingTimely:timely,undatedIncoming:incoming.filter(i=>!i.expected).reduce((n,i)=>n+i.quantity,0),suggestedBags:qty,
      reorderDate:cover==null||!configured?null:dayShift(today,Math.max(0,Math.floor(cover-lead-safety))),
      reorderAlert:p.available!=null&&p.available<=threshold,stockState:p.available==null?'count_needed':p.available<0?'reconcile':p.available<=threshold?'reorder':!configured?'planning_needed':'covered',
      lotState:!eligibleLots.length?'lots_needed':eligibleLots.reduce((n,l)=>n+Number(l.usable_bags),0)!==p.onHand?'reconcile':'count_matches',
      expiring30Bags:eligibleLots.filter(l=>l.best_before>=today&&l.best_before<=through).reduce((n,l)=>n+Number(l.usable_bags),0),expiredBags:eligibleLots.filter(l=>l.best_before<today).reduce((n,l)=>n+Number(l.usable_bags),0)};
  });
  const groups=new Map(),groupStops=new Map();
  for(const o of orders.filter(o=>!terminal(o)&&o.fulfillment_method!=='pickup'&&o.scheduled_date>=today&&o.scheduled_date<=through&&o.delivery_status!=='delivered')) {
    const key=o.scheduled_date+':'+(o.technician_id||'unassigned'),g=groups.get(key)||{date:o.scheduled_date,technician:o.technician_name||'Unassigned',technicianId:o.technician_id||'',orders:0,bags:0,existingStops:0,foodOnlyStops:0,unmatchedStops:0,routePlanCount:0,baseServiceMinutes:null,baseDriveMinutes:null,foodServiceMinutes:null,fullRouteMinutes:null};
    g.orders++;g.bags+=(o.itemDetails||[]).reduce((n,i)=>n+Number(i.quantity),0);
    const plans=routePlans.filter(p=>p.service_date===g.date&&p.technician_external_id===g.technicianId&&p.source_provider!=='dog_food_automation');
    const locations=plans.flatMap(p=>p.locations||[]).filter(l=>l.non_food_tasks===undefined||l.non_food_tasks>0),address=normalize([o.line1,o.city,o.state,o.postal_code].join(', '));
    const matches=locations.filter(l=>normalize(l.address)===address);
    const seen=groupStops.get(key)||new Set();
    if(!seen.has(address)){if(sourceReady&&plans.length===1&&matches.length===1)g.existingStops++;else if(sourceReady&&plans.length===1)g.foodOnlyStops++;else g.unmatchedStops++;seen.add(address);groupStops.set(key,seen);}
    g.routePlanCount=plans.length;
    if(plans.length===1){g.baseServiceMinutes=locations.reduce((n,l)=>n+Math.max(0,Number(l.estimated_service_minutes||0)-Number(l.food_service_minutes||0)),0);g.baseDriveMinutes=locations.length&&locations.every(l=>l.estimated_drive_minutes!=null)?locations.reduce((n,l)=>n+Number(l.estimated_drive_minutes),0):null;}
    groups.set(key,g);
  }
  const routeLoads=[...groups.values()].map(g=>{
    g.foodServiceMinutes=!g.unmatchedStops&&(!g.existingStops||policy.existingStopMinutes!=null)&&(!g.foodOnlyStops||policy.foodStopMinutes!=null)?round(g.existingStops*(policy.existingStopMinutes||0)+g.foodOnlyStops*(policy.foodStopMinutes||0)):null;
    // Food-only stops need an actual road insertion/matrix. A straight-line radius or weekday roster cannot establish total route time.
    g.fullRouteMinutes=g.foodServiceMinutes!=null&&g.baseDriveMinutes!=null&&g.baseServiceMinutes!=null&&!g.foodOnlyStops?round(g.baseServiceMinutes+g.baseDriveMinutes+g.foodServiceMinutes):null;
    g.reviewReason=!sourceReady?'Current OPWP route source unavailable':g.routePlanCount!==1?'Actual dated route needs review':g.foodServiceMinutes==null?'Confirm stop-time assumptions':g.foodOnlyStops?'Road insertion time is required':g.baseDriveMinutes==null?'Existing route drive time is missing':'Estimate uses the actual dated route';return g;
  }).sort((a,b)=>a.date.localeCompare(b.date)||a.technician.localeCompare(b.technician));
  const completed=orders.filter(o=>!o.deleted_at&&o.delivered_at),durations=completed.map(o=>(utc(o.delivered_at)-utc(o.created_at))/86400000).filter(n=>Number.isFinite(n)&&n>=0);
  const foodTimes=taskTimes.filter(t=>t.status==='completed'&&t.started_at&&t.completed_at).map(t=>(utc(t.completed_at)-utc(t.started_at))/60000).filter(n=>Number.isFinite(n)&&n>=0&&n<=480);
  return {asOf:today,policy,profiles,pipeline,funnel:stages.map(stage=>({stage,count:pipeline.filter(o=>o.stage===stage).length})),usage,replenishment,routeLoads,inventory:foodInventoryDashboard(model,{now,policy,lots,costs,plans,planItems,sync}),
    crmOptions:sourceReady?routeSource.clients.map(c=>({id:c.id,name:c.name,address:[c.address,c.city,c.zip].join(', ')})):[],
    summary:{verifiedAccounts:profiles.length,completeProfiles:profiles.filter(p=>p.stage!=='profile_required').length,profileWithoutOrder:profiles.filter(p=>p.stage==='profile_saved').length,
      billedMonthCents:(model.sales||[]).filter(s=>!s.cancelled&&s.date.slice(0,7)===month).reduce((n,s)=>n+s.totalCents,0),fulfilledMonthBags:fulfilled.filter(s=>s.stockDate.slice(0,7)===month).reduce((n,s)=>n+s.quantity,0),
      activePlans:activePlans.length,pastDuePlans:plans.filter(p=>p.status==='past_due').length,pausedPlans:plans.filter(p=>p.status==='paused').length,avgFulfillmentDays:durations.length?round(durations.reduce((n,v)=>n+v,0)/durations.length):null,
      pendingProjections:projections.filter(p=>p.revision>p.synced_revision).length,failedProjections:projections.filter(p=>p.last_error).length,failedNotices:notices.filter(n=>['failed','review'].includes(n.status)).length,
      reorderAlerts:replenishment.filter(r=>r.reorderAlert).length,sharedReviews:customerReviews.filter(r=>r.status==='pending').length,observedFoodStopMinutes:foodTimes.length?round(foodTimes.reduce((n,v)=>n+v,0)/foodTimes.length):null,observedFoodStops:foodTimes.length,overAllowanceFoodStops:foodTimes.filter(n=>n>2).length},
    connections:{posting:Boolean(settings.posting_enabled),scheduling:Boolean(settings.scheduling_enabled),email:Boolean(settings.email_enabled),routeReady:sourceReady,routeCapturedAt:routeSource?.capturedAt||null,activeRouteCustomers:routeSource?.clients?.length||0},
    coverage:{source:'Verified website accounts and native orders; historical Airtable sales in usage/revenue',usage:'Physical delivered/collected bags by completion date, including fulfilled refunds; cancellations before fulfillment excluded',forecast:'90-day physical usage and known active native plans; larger daily rate used. Imported history and legacy/SNG plans may be incomplete. Incoming POs affect reorder quantity only with an expected date within supplier lead time.',route:'Actual dated route plans; new-stop road insertion remains required before total duration can be claimed.'}};
}
export async function readFoodSalesIntelligence(db,model,sync={}) {
  const [accounts,plans,planItems,projections,notices,settings,lots,customerReviews]=await Promise.all([
    db.prepare(`SELECT c.id,c.first_name,c.last_name,c.phone,c.sng_client_id,a.email,a.created_at account_created_at,a.profile_completed_at,a.preferred_fulfillment,
      d.line1,d.city,d.state,d.postal_code,d.placement_preference,d.placement_other FROM dog_food_accounts a JOIN dog_food_customers c ON c.id=a.customer_id
      LEFT JOIN dog_food_addresses d ON d.customer_id=c.id AND d.is_primary=1 WHERE c.deleted_at IS NULL ORDER BY a.created_at DESC LIMIT 5001`).all(),
    db.prepare('SELECT id,status,next_delivery_date,payment_provider FROM dog_food_subscriptions WHERE customer_id IN (SELECT id FROM dog_food_customers WHERE deleted_at IS NULL) LIMIT 5001').all(),
    db.prepare('SELECT subscription_id,product_id,quantity,is_active FROM dog_food_subscription_items LIMIT 20001').all(),
    db.prepare('SELECT entity_key,revision,synced_revision,last_error,verified_at FROM dog_food_sync_outbox LIMIT 25001').all(),
    db.prepare('SELECT order_id,template,status,provider_outcome FROM dog_food_transactional_outbox ORDER BY created_at DESC LIMIT 5000').all(),
    db.prepare("SELECT posting_enabled,scheduling_enabled,email_enabled FROM dog_food_workflow_settings WHERE id='org-opwp'").first(),
    db.prepare('SELECT * FROM dog_food_stock_lots LIMIT 5001').all(),
    db.prepare('SELECT customer_id,revision,status,relationship,opwp_record_id,reviewed_at FROM dog_food_customer_reviews LIMIT 5001').all()
  ]);
  if(accounts.results.length>5000||plans.results.length>5000||planItems.results.length>20000||projections.results.length>25000||lots.results.length>5000||customerReviews.results.length>5000)throw new FoodError('Sales planning history exceeds its reviewed bound.',503);
  let policy,routeSource=null,routePlans=[],taskTimes=[];
  try{policy=await readFoodPlanning(db);}catch(error){if(error instanceof FoodError)throw error;policy=emptyFoodPlanning();}
  try{routeSource=await readLiveDensity(db);}catch{}
  try {
    const today=foodDate(),rows=await db.prepare(`SELECT p.id,p.service_date,p.technician_external_id,p.source_provider,l.address,l.estimated_service_minutes,l.estimated_drive_minutes,
      (SELECT COUNT(*) FROM route_partner_tasks t WHERE t.location_id=l.id AND t.organization_id=p.organization_id AND t.task_type<>'dog_food' AND t.status<>'cancelled') non_food_tasks,
      (SELECT COALESCE(SUM(t.estimated_minutes),0) FROM route_partner_tasks t WHERE t.location_id=l.id AND t.organization_id=p.organization_id AND t.source_provider='dog_food_automation' AND t.status<>'cancelled') food_service_minutes
      FROM route_partner_route_plans p JOIN route_partner_locations l ON l.route_plan_id=p.id AND l.organization_id=p.organization_id
      WHERE p.organization_id='org-opwp' AND p.status IN ('draft','finalized','in_progress') AND p.service_date>=? AND p.service_date<=? LIMIT 5001`).bind(today,dayShift(today,30)).all();
    if(rows.results.length<=5000){const map=new Map();for(const r of rows.results){const p=map.get(r.id)||{...r,locations:[]};p.locations.push(r);map.set(r.id,p);}routePlans=[...map.values()];}
  }catch{}
  try{taskTimes=(await db.prepare("SELECT started_at,completed_at,status FROM route_partner_tasks WHERE organization_id='org-opwp' AND task_type='dog_food' AND completed_at>=datetime('now','-90 days') ORDER BY completed_at DESC LIMIT 5000").all()).results;}catch{}
  const costs=await readInventoryCosts(db);
  return foodSalesIntelligence(model,{accounts:accounts.results,plans:plans.results,planItems:planItems.results,projections:projections.results,notices:notices.results,settings:settings||{},lots:lots.results,costs,sync,customerReviews:customerReviews.results,taskTimes,policy,routeSource,routePlans});
}

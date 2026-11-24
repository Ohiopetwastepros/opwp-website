import {PRICING, PRICING_VERSION, YARD_TIERS, monthly, oneTimeRange, frequencyId} from './lead-pricing.mjs';
import {cities, getCityByZip} from '../data/cities.js';
import {FAQ_TEMPLATES} from './lead-playbook-faq.mjs';

// The model classifies meaning. Every factual customer-facing sentence below
// comes from the reviewed playbook or the shared, versioned website rate grid.
// No model-supplied price, coverage claim, booking promise or URL is rendered.
export const STRUCTURED_REPLY_POLICY_VERSION = 'lead-conversation-v2-20261123';
export const STRUCTURED_REPLY_TEMPLATE = 'structured_playbook_v2';
export const STRUCTURED_SIGNUP_PATH = 'https://www.ohiopetwastepros.com/free-quote/';
export const STRUCTURED_SAFE_FALLBACK = "Thanks for your message. I'll have Craig follow up with you directly.";
export const STRUCTURED_UNCLEAR_REPLIES = Object.freeze([
  "Sorry, I didn't quite catch that. How can I help you today?",
  'No problem! Are you looking for a price, or do you have a question about our service?',
  "I'll have Craig reach out to you directly.",
]);

const frequencyLabels = Object.freeze({once_a_week:'Weekly',twice_a_week:'Twice-weekly',every_other_week:'Biweekly',once_a_month:'Monthly'});
const detailKeys = ['dogs','frequency','zip','name','city','address','yardTier','yardAcres','lastCleaned','email','gateSide','trashLocation'];
const ownerReasons = new Set(['price_pushback','complaint','cash','off_playbook','uncertain','spanish','requested_owner']);
const knownIntents = new Set(['confirm_yes','correction','question_price','question_service_area','question_service_day','question_what_included','question_contract','question_haul_away','question_pets_safety','question_gate_access','question_payment','request_cash','objection_price','objection_thinking','objection_competitor','ready_to_sign_up','not_interested','reschedule_timing','is_this_ai','wrong_number','complaint','spanish','off_playbook','unclear','stop','faq_question','address_given','question_referral','question_bundles']);
const topicIntents=Object.freeze({published_plan_rate:'question_price',
  payment:'question_payment',payment_review:'question_payment',billing:'question_payment',signup_path_review:'ready_to_sign_up',
  included:'question_what_included',disposal_rates:'question_haul_away',pets:'question_pets_safety',access:'question_gate_access',
  time_of_day:'question_service_day',contract_answer:'question_contract',try_month:'question_contract',
  identity_line:'is_this_ai',who:'is_this_ai',
  referral:'question_referral',referral_policy:'question_referral',combo:'question_bundles'});
const staticInformationTopics=new Set(['front_yard','included_front','treatments','rain_snow','winter_weather','treatments_weather','holiday','home','dog_food','first_visit','frequency_policy','frequency_options','dog_comparison','unavailable_frequency','proof','clarify_unit','do_it_myself','service_area_prompt','emoji_greeting','photo']);
const fold = value => String(value || '').normalize('NFKC').toLowerCase().trim().replace(/\s+/g,' ');
const unique = values => [...new Set(values)];
export const INFORMATION_PLAYBOOK_TOPIC_KEYS=Object.freeze(unique([...staticInformationTopics,...Object.keys(topicIntents)]).filter(topic=>Object.hasOwn(FAQ_TEMPLATES,topic)));
const safeCity = value => cities.find(city=>fold(city.city)===fold(value))?.city || ({elmore:'Elmore',genoa:'Genoa',tontogany:'Tontogany'})[fold(value)] || '';
const clone = value => JSON.parse(JSON.stringify(value));

function cleanDetails(value={}) {
  const result={};
  for(const key of detailKeys) {
    const item=value[key];
    if(item===null||item===undefined||item==='')continue;
    if(key==='dogs'){if(Number.isInteger(Number(item))&&Number(item)>=0&&Number(item)<=99)result[key]=Number(item);}
    else if(key==='yardAcres'){if(Number.isFinite(Number(item))&&Number(item)>0&&Number(item)<=100)result[key]=Number(item);}
    else if(key==='frequency'){const id=frequencyId(item);if(['once_a_week','twice_a_week','every_other_week','once_a_month','one_time'].includes(id))result[key]=id;}
    else if(key==='zip'){if(/^\d{5}(?:-\d{4})?$/.test(String(item)))result[key]=String(item).slice(0,5);}
    else if(key==='yardTier'){if(YARD_TIERS.some(t=>t.id===item)||item==='unsure')result[key]=item;}
    else if(typeof item==='string'&&item.length<=200&&!/[\r\n\u0000-\u001f]/.test(item))result[key]=item;
  }
  return result;
}

function initialDetails(lead={},state={},details) {
  let payload=lead.payload||{};
  if(typeof payload==='string'){try{payload=JSON.parse(payload);}catch{payload={};}}
  const values={...payload,...(payload.quote_context||{}),...(payload.lead_workspace?.intake||{}),...lead,...(state.details||{}),...(details||{})};
  return cleanDetails({...values,dogs:values.dogs??values.number_of_dogs,frequency:values.frequency||values.clean_up_frequency,yardTier:values.yardTier||values.yard_size_tier});
}

function publicAreaFacts(serviceArea={}) {
  if(!serviceArea||typeof serviceArea!=='object')serviceArea={};
  const sourceSnapshotAt=typeof serviceArea.sourceSnapshotAt==='string'?serviceArea.sourceSnapshotAt:'';
  const statusHealthy=serviceArea.statusHealthy===true||serviceArea.verified===true;
  return {sourceSnapshotAt,statusHealthy,
    activeClientTowns:unique((Array.isArray(serviceArea.activeClientTowns)?serviceArea.activeClientTowns:[]).map(safeCity).filter(Boolean)).slice(0,100),
    activeClientZips:unique((Array.isArray(serviceArea.activeClientZips)?serviceArea.activeClientZips:[]).map(String).filter(v=>/^\d{5}$/.test(v))).slice(0,200)};
}

function freshArea(facts,now) {
  const captured=Date.parse(facts.sourceSnapshotAt),time=new Date(now).getTime();
  return facts.statusHealthy&&Number.isFinite(captured)&&Number.isFinite(time)&&captured<=time+60000&&time-captured<=24*60*60*1000;
}

function normalizedContext(input={}) {
  // This bounded context is durable draft evidence, never a browser asset.
  const classification=input.classification||{},state=input.state||{};
  const intents=unique((Array.isArray(classification.intents)?classification.intents:[classification.intent]).filter(i=>knownIntents.has(i)));
  const topics=unique((Array.isArray(classification.playbook_topics)?classification.playbook_topics:[]).filter(topic=>INFORMATION_PLAYBOOK_TOPIC_KEYS.includes(topic))).slice(0,6);
  if(intents.some(intent=>['unclear','stop','wrong_number'].includes(intent)))topics.length=0;
  for(const topic of topics){
    const intent=topicIntents[topic];
    if(intent&&intents.includes('faq_question')&&!intents.includes(intent))intents.push(intent);
  }
  if(['stop','wrong_number'].includes(classification.intent)&&!intents.includes(classification.intent))intents.unshift(classification.intent);
  return {
    policyVersion:STRUCTURED_REPLY_POLICY_VERSION,pricingVersion:PRICING_VERSION,
    classification:{intents:intents.length?intents:['unclear'],confirms_details:['yes','no','partial'].includes(classification.confirms_details)?classification.confirms_details:'no',
      corrections:cleanDetails(classification.corrections||{}),extracted:cleanDetails(classification.extracted||classification.slots||{}),
      confidence:Number.isFinite(classification.confidence)?Math.max(0,Math.min(1,classification.confidence)):0,
      needs_owner:classification.needs_owner===true,owner_reason:ownerReasons.has(classification.owner_reason)?classification.owner_reason:'none',
      sentiment:['positive','neutral','negative','angry'].includes(classification.sentiment)?classification.sentiment:'neutral',fallbackReply:classification.fallbackReply===true,playbook_topics:topics},
    details:initialDetails(input.lead,state,input.details),
    state:{stage:state.stage||'confirm_details_sent',details_confirmed:state.details_confirmed===true,unclear_count:Math.floor(Math.max(0,Math.min(2,Number(state.unclear_count)||0))),topic_holds:unique((Array.isArray(state.topic_holds)?state.topic_holds:[]).filter(v=>typeof v==='string'&&v.length<80)).slice(0,20)},
    serviceArea:publicAreaFacts(input.serviceArea||{}),
    owner:input.conversation?.owner||'backend',paused:input.conversation?.automation_mode==='paused'||input.paused===true,suppressed:input.suppressed===true,
  };
}

function missingDetailQuestion(details) {
  if(!details.dogs)return 'How many dogs use the yard?';
  if(!details.frequency)return 'Were you thinking weekly, every other week, twice weekly, monthly, or one cleanup?';
  if(!details.zip)return "What's the ZIP for the yard?";
  if(!details.lastCleaned)return 'About how long has it been since the yard was last thoroughly cleaned?';
  if(!details.yardTier||details.yardTier==='unsure')return 'About how big is the area your dogs use, or what is the address so I can check it?';
  return 'What would you like to know about pricing or service?';
}

function buildCanonical(context,now=new Date()) {
  const c=context.classification,intents=c.intents,has=i=>intents.includes(i),corrections=c.corrections;
  const details={...context.details,...corrections},state={...context.state,details};
  if(Object.keys(corrections).length||c.confirms_details!=='yes'&&has('correction'))state.details_confirmed=false;
  else if(c.confirms_details==='yes')state.details_confirmed=true;
  const blocks=[],notifyReasons=[];
  const add=(topic,body,prices=[])=>{if(body&&!blocks.some(x=>x.topic===topic))blocks.push({topic,body,prices});};
  const notify=reason=>{if(reason&&!notifyReasons.includes(reason))notifyReasons.push(reason);};
  const noSend=context.suppressed||context.paused||context.owner!=='backend'||has('stop')||has('wrong_number');
  if(noSend)return {body:'',state,notifyReasons:[],blocks:[],noSend:true,reason:context.suppressed?'suppressed':context.paused?'owner_paused':has('stop')?'stop':has('wrong_number')?'wrong_number':'owner_not_backend'};
  const meaningful=intents.filter(i=>!['unclear','confirm_yes','correction','address_given'].includes(i));
  const unclearOnly=has('unclear')&&!meaningful.length&&!has('confirm_yes')&&!has('correction')&&!has('address_given');
  if(unclearOnly){
    const attempt=context.state.unclear_count;
    state.unclear_count=Math.min(2,attempt+1);
    add('clarification',STRUCTURED_UNCLEAR_REPLIES[attempt]);
    if(attempt>=2){notify('unclear_repeated');state.topic_holds=unique([...state.topic_holds,'unclear_repeated']);}
    return {body:blocks.map(x=>x.body).join(' '),state,notifyReasons,blocks,noSend:false,reason:attempt>=2?'unclear_repeated':c.fallbackReply?'classifier_safe_reask':'unclear_reask'};
  }
  state.unclear_count=0;
  if(corrections.dogs===0)add('confirmation',"Thanks for letting me know. I've noted that there are no dogs using the yard.");
  else if(has('correction')||Object.keys(corrections).length)add('confirmation',"Thanks, I've corrected those details.");
  else if(c.confirms_details==='yes'||has('confirm_yes'))add('confirmation','Got it, thank you!');
  if(has('question_price')){
    const requested={...details,...c.extracted},dogs=Number(requested.dogs),frequency=frequencyId(requested.frequency);
    const rate=monthly(frequency,dogs),label=frequencyLabels[frequency];
    if(Number.isInteger(dogs)&&dogs>=1&&rate!==null&&rate!==undefined&&label){
      const basis=YARD_TIERS.find(t=>t.id==='tiny')?.label.toLowerCase()||'up to 1/8 acre';
      add('rates',`${label} service for ${dogs} ${dogs===1?'dog':'dogs'} starts at $${rate} per month for a cleanup area ${basis}. Larger areas cost more, and the first cleanup is priced separately based on buildup.`,[rate]);
    }else if(frequency==='one_time'&&Number.isInteger(dogs)&&dogs>=1&&oneTimeRange(dogs,requested.lastCleaned)){
      const [low,high]=oneTimeRange(dogs,requested.lastCleaned);
      add('rates',`The published one-time range for ${dogs} ${dogs===1?'dog':'dogs'} with that buildup is $${low} to $${high} for a standard cleanup area. The range depends on how much waste is there and how long it takes.`,[low,high]);
    }else if(!Number.isInteger(dogs)||dogs<1)add('rates','How many dogs use the yard, and how often would you like it cleaned?');
    else if(!frequency)add('rates','Were you thinking weekly, every other week, twice weekly, monthly, or one cleanup?');
    else if(frequency==='one_time')add('rates','For a one-time price, about how long has it been since the yard was thoroughly cleaned, and how large is the cleanup area?');
    else{add('rates',"That dog count and frequency need a custom quote. I'll have Craig follow up with you.");notify('off_playbook');}
  }
  if(has('question_service_area')){
    const inquiry=c.extracted,explicitCity=Boolean(inquiry.city),zip=inquiry.zip||'',city=explicitCity?safeCity(inquiry.city):getCityByZip(zip)?.city||'',normalized=fold(city);
    if(!inquiry.city&&!inquiry.zip)add('area',"What's the ZIP or town for the yard so I can check the service area?");
    else if(normalized==='elmore'||zip==='43416')add('area',"We don't service Elmore.");
    else if(normalized==='genoa'||zip==='43430'){
      add('area',"We only consider the far west side of Genoa. Send the street address and ZIP, and I'll have Craig check it before we promise service.");notify('coverage_review');
    }else if(normalized==='tontogany'||zip==='43565'){
      add('area',"I'll have Craig check Tontogany before confirming service. What's the street address and ZIP?");notify('coverage_review');
    }else if(freshArea(context.serviceArea,now)&&((city&&context.serviceArea.activeClientTowns.some(t=>fold(t)===fold(city)))||(!city&&context.serviceArea.activeClientZips.includes(zip)))){
      add('area',`We have active clients ${city?'in '+city:'in that ZIP'}. I still need to check the full address and route before confirming service.`);
    }else{
      add('area',"I need to check that location. Send the street address and ZIP, and I'll have Craig confirm whether we service it.");notify('coverage_review');
    }
  }
  if(has('question_service_day')||has('reschedule_timing'))add('time',"The service day is confirmed when we check your address and route. I can't promise a morning or any time of day. We'll text when we're on the way and when we're done.");
  if(has('question_what_included'))add('included','We scoop the area your dogs use, including patios and other hard surfaces there, then double-bag the waste and put it in your outdoor can. Front yard scooping and haul-away are optional add-ons.');
  if(has('question_contract'))add('contract',"It's month to month with no contract. Your first invoice includes the initial cleanup plus the following month of service, then billing runs on the 1st.");
  if(has('question_haul_away')){
    const addon=PRICING.addons.find(a=>a.id==='haul_away');
    add('disposal',`We double-bag the waste and use your outdoor trash can at no extra charge. Haul-away is $${addon.price} per month for 1 or 2 dogs or $${addon.price3Plus} per month for 3 or more.`,[addon.price,addon.price3Plus]);
  }
  if(has('question_pets_safety'))add('pets','Please keep the dogs secured while we are there. Nobody needs to be home as long as we have safe access.');
  if(has('question_gate_access'))add('access',"Nobody needs to be home if we have safe access. If you're facing the house, which side is the gate?");
  if(has('question_payment')||has('request_cash'))add('payment',(has('request_cash')?"A check works, or a card through the secure Sweep&Go portal. Cash would need to be handled offline with Craig. I'll have Craig follow up about that.":'A check works, or you can keep a card on file through the secure Sweep&Go portal.')+' Your first invoice includes the initial cleanup plus the following month of service, then billing runs on the 1st.');
  if(has('question_referral'))add('referral',"We don't have a referral credit or program, but thank you for thinking of us.");
  if(has('question_bundles'))add('bundles',"We price add-ons individually and don't have bundle rates.");
  if(has('ready_to_sign_up'))add('signup',`You can review the options and start signup at ${STRUCTURED_SIGNUP_PATH} This text doesn't book service or create an account.`);
  if(has('is_this_ai'))add('identity',"This is Ohio Pet Waste Pros, Craig's business text line. These replies use AI with the approved playbook. I can help with prices or service questions.");
  if(has('not_interested'))add('decline','No problem, thanks for letting me know. If you need us later, just text.');
  if(has('objection_thinking')||has('objection_competitor')&&!c.needs_owner)add('thinking',"No problem. Text me whenever you're ready or have questions.");
  for(const topic of c.playbook_topics){
    const addon=id=>PRICING.addons.find(item=>item.id===id)?.price;
    if(topic==='front_yard'||topic==='included_front')add('front_yard',`${topic==='included_front'?'We scoop the area your dogs use, including its patios and hard surfaces. ':''}Front yard scooping is $${addon('front_yard')} per month.`,[addon('front_yard')]);
    else if(topic==='treatments')add('treatments',`Sanitizing is $${addon('sani_monthly')} per month or $${addon('sani_onetime')} one time, and deodorizing is $${addon('deodorize')} per treatment.`,[addon('sani_monthly'),addon('sani_onetime'),addon('deodorize')]);
    else if(topic==='rain_snow')add('weather','We scoop rain or shine. After heavy snow, we usually pause while the waste is buried.');
    else if(topic==='winter_weather')add('weather','We usually pause after heavy snow while the waste is buried, and try to get yards done beforehand when a big snow is coming.');
    else if(topic==='treatments_weather')add('weather','We scoop rain or shine, but hold sanitizing until the active rain lets up.');
    else if(topic==='holiday')add('holiday','We adjust routes around major holidays and use a nearby service day. The first visit is confirmed during account setup.');
    else if(topic==='home')add('home',"Nobody needs to be home as long as we have safe access. We'll text when we're on the way and when the cleanup is done.");
    else if(topic==='proof')add('proof',"We'll text when we're on the way and when the cleanup is done, often with a gate photo.");
    else if(topic==='dog_food')add('dog_food',`We deliver Extreme Dog Fuel on a regular cleanup visit. A 40 lb bag is $${addon('food_blue')} plus tax; formulas are at https://www.ohiopetwastepros.com/dog-food/ .`,[addon('food_blue')]);
    else if(topic==='first_visit')add('first_visit','The initial cleanup gets the yard caught up before regular service. Your first invoice includes that cleanup plus the following month of service, then billing runs on the 1st.');
    else if(topic==='frequency_policy')add('frequency_policy','Weekly and twice weekly are available for up to 7 dogs, biweekly for up to 3, and monthly for 1 or 2. Which plan were you considering?');
    else if(topic==='frequency_options'||topic==='unavailable_frequency'){
      const dogs=Number(c.extracted.dogs??details.dogs),plans=Object.entries(frequencyLabels).flatMap(([frequency,label])=>{const amount=monthly(frequency,dogs);return amount===null||amount===undefined?[]:[{label,amount}];});
      if(!Number.isInteger(dogs)||dogs<1)add('frequency_options','How many dogs use the yard so I can show the available plans?');
      else if(plans.length)add('frequency_options',`For ${dogs} ${dogs===1?'dog':'dogs'} and a cleanup area up to 1/8 acre, ${plans.map(plan=>plan.label.toLowerCase()+' is $'+plan.amount+' per month').join(', ')}. Larger areas cost more and the first cleanup is priced separately.`,plans.map(plan=>plan.amount));
      else{add('frequency_options',"That dog count needs a custom quote. I'll have Craig follow up with you.");notify('off_playbook');}
    }
    else if(topic==='dog_comparison')add('dog_comparison','Which dog counts and service frequency would you like to compare?');
    else if(topic==='clarify_unit')add('clarify_unit','The recurring rates are prepaid monthly totals for that month of service, rather than a charge per visit.');
    else if(topic==='do_it_myself')add('thinking',"Nothing wrong with that. If you change your mind, we'd be happy to take it off your plate.");
    else if(topic==='service_area_prompt'&&!has('question_service_area'))add('area',"What's the ZIP for the yard so I can check the service area?");
    else if(topic==='emoji_greeting'||topic==='photo')add('clarification','What would you like help with today, a price or a question about the service?');
    else if(!topicIntents[topic]&&!staticInformationTopics.has(topic))notify('off_playbook');
  }
  if(has('objection_price'))notify('price_pushback');
  if(has('request_cash'))notify('cash');
  if(has('complaint')||c.sentiment==='angry'&&c.needs_owner)notify('complaint');
  if(has('spanish'))notify('spanish');
  if(has('off_playbook')||has('faq_question')&&!c.playbook_topics.length)notify('off_playbook');
  if(c.needs_owner&&ownerReasons.has(c.owner_reason))notify(c.owner_reason);
  if(c.needs_owner&&c.owner_reason==='none')notify('uncertain');
  if(c.confidence<0.8&&!c.fallbackReply)notify('uncertain');
  const nonCash=notifyReasons.filter(r=>r!=='cash'&&r!=='coverage_review');
  if(nonCash.length){
    const price=nonCash.includes('price_pushback'),complaint=nonCash.includes('complaint');
    add('owner',price?"I understand. I'll have Craig follow up with you about the price.":complaint?"I'm sorry about that. I'll have Craig follow up with you directly.":"I'll have Craig follow up with you directly.");
  }
  if(!blocks.length)add('next_question',missingDetailQuestion(details));
  state.topic_holds=unique([...state.topic_holds,...notifyReasons]);
  return {body:blocks.map(x=>x.body).join(' '),state,notifyReasons,blocks,noSend:false,reason:notifyReasons[0]||'structured_playbook_reply'};
}

export function composeStructuredPlaybookReply(input={}) {
  const context=normalizedContext(input),built=buildCanonical(context,input.now||new Date());
  const primary=context.classification.intents[0]||'unclear';
  return {intent:primary,intents:context.classification.intents,confidence:1,body:built.body,
    templateKey:STRUCTURED_REPLY_TEMPLATE,answerKey:null,pricingVersion:PRICING_VERSION,policyVersion:STRUCTURED_REPLY_POLICY_VERSION,
    slots:{...built.state.details,structuredContext:context},state:{...(input.state||{}),...built.state},
    escalate:built.notifyReasons.length>0,needsOwner:built.notifyReasons.length>0,notifyReasons:built.notifyReasons,reason:built.reason,
    groundedPrices:unique(built.blocks.flatMap(b=>b.prices)),noSend:built.noSend};
}

function contextForValidation(input) {
  const saved=input?.structuredContext||input?.slots?.structuredContext;
  if(saved?.policyVersion===STRUCTURED_REPLY_POLICY_VERSION){
    const value=clone(saved);
    return normalizedContext({classification:value.classification,state:value.state,details:value.details,serviceArea:value.serviceArea,
      conversation:{owner:value.owner,automation_mode:value.paused?'paused':'approved'},suppressed:value.suppressed});
  }
  return normalizedContext(input||{});
}

export function validateStructuredPlaybookReply(body,input={},options={}) {
  try {
  const text=String(body||''),context=contextForValidation(input),canonical=buildCanonical(context,options.now||input.now||new Date());
  const violations=[];
  if(canonical.noSend)return text?['send_prohibited']:[];
  if(!text.trim()||text.length>1000)violations.push('invalid_length');
  if(/[\u2013\u2014]/.test(text))violations.push('forbidden_dash');
  if(/[^\x00-\x7f]/.test(text))violations.push('non_ascii_reply');
  if(/\/api\/onboard\b/i.test(text))violations.push('onboarding_not_allowed');
  const prices=[...text.matchAll(/\$\s*(\d[\d,]*(?:\.\d{1,2})?)/g)].map(m=>Number(m[1].replaceAll(',',''))),allowed=canonical.blocks.flatMap(b=>b.prices);
  if(prices.some(p=>!allowed.includes(p)))violations.push('price_disagrees_with_grid');
  if(/\b(?:\d+\s*(?:%|dollars?)\s*off|give you (?:a )?discount|waive (?:the|your) (?:fee|charge)|match (?:that|their) price|bundle (?:deal|discount))\b/i.test(text))violations.push('discount_not_authorized');
  if(/\b(?:we(?:'ll| will)|i(?:'ll| will)|can (?:come|arrive)|will (?:come|arrive)).{0,40}\b(?:morning|afternoon|evening|noon|midnight|[0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm))\b/i.test(text)||/\b(?:arrive|be there|come|be out) (?:at|before|by) (?:\d{1,2}(?::\d{2})?\s*(?:am|pm)|noon|midnight)\b/i.test(text))violations.push('time_promise_not_allowed');
  if(/\b(?:cash is (?:fine|okay|ok)|we (?:take|accept) cash|pay (?:in|with) cash (?:online|here))\b/i.test(text))violations.push('cash_not_authorized');
  const neutralPrefixes=['','Sure. ','Got it. ','Thanks! '];
  if(!neutralPrefixes.some(prefix=>text===prefix+canonical.body))violations.push('ungrounded_reply');
  return unique(violations);
  } catch { return ['invalid_context']; }
}

// Optional drafting hook is deliberately subordinate to canonical grounding.
// A failed candidate is regenerated once, then a safe handoff is used. The
// runtime may omit the hook and directly render the validated playbook copy.
export async function generateValidatedStructuredPlaybookReply(input={}, {drafter,timeoutMs=4000}={}) {
  const canonical=composeStructuredPlaybookReply(input);
  if(canonical.noSend)return {...canonical,validationAttempts:0,regenerated:false,validationFallback:false};
  let violations=[];
  for(let attempt=0;attempt<2;attempt++){
    let body=canonical.body;
    if(drafter){
      const controller=new AbortController();let timer;
      try{
        const candidate=await Promise.race([
          Promise.resolve().then(()=>drafter({body:canonical.body,attempt,violations:[...violations],policyVersion:STRUCTURED_REPLY_POLICY_VERSION,signal:controller.signal})),
          new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('reply_drafter_timeout'));},Math.max(10,Math.min(5000,Number(timeoutMs)||4000)));}),
        ]);
        body=typeof candidate==='string'?candidate:candidate?.body||'';
      }catch{body='';}finally{clearTimeout(timer);}
    }
    violations=validateStructuredPlaybookReply(body,canonical.slots,{now:input.now});
    if(!violations.length)return {...canonical,body,validationAttempts:attempt+1,regenerated:attempt===1,validationFallback:false};
  }
  console.warn(JSON.stringify({event:'lead_reply_validation_fallback',policyVersion:STRUCTURED_REPLY_POLICY_VERSION,violations}));
  return {...canonical,body:STRUCTURED_SAFE_FALLBACK,reason:'invalid_reply_fallback',escalate:true,needsOwner:true,notifyReasons:unique([...canonical.notifyReasons,'invalid_reply_fallback']),
    slots:{...canonical.slots,structuredFallback:true},validationAttempts:2,regenerated:true,validationFallback:true,state:{...canonical.state,topic_holds:unique([...canonical.state.topic_holds,'invalid_reply_fallback'])}};
}

export function validateStructuredPlaybookDecision(body,slots={},options={}) {
  if(slots.structuredFallback===true){
    try{if(buildCanonical(contextForValidation(slots),options.now||new Date()).noSend)return body?['send_prohibited']:[];}catch{return ['invalid_context'];}
    return body===STRUCTURED_SAFE_FALLBACK?[]:['unsafe_fallback_reply'];
  }
  return validateStructuredPlaybookReply(body,slots,options);
}

// Exported only to make source authority inspectable by the deployment checks.
export const STRUCTURED_PLAYBOOK_AUTHORITIES = Object.freeze({pricingVersion:PRICING_VERSION,signupPath:STRUCTURED_SIGNUP_PATH,reviewedFaqCount:Object.keys(FAQ_TEMPLATES).length});

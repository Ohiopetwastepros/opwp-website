import {PRICING} from './lead-pricing.mjs';
import {CRAIG_ADDONS as ADDONS, CRAIG_FIRST_MONTH_DISCOUNT as DISCOUNT, CRAIG_PRICING_VERSION, craigRate, craigCleanupRange, craigRangeText} from './lead-craig-pricing.mjs';
import {cities} from '../data/cities.js';
import {prefilterPlaybookOptOut} from './lead-playbook-classifier-schema.mjs';
import {formatCustomerSms} from './customer-sms.mjs';
import {redactStaffExcerpt} from './playbook-redaction.mjs';

export const craigSignupEnabled = env => env.LEAD_CRAIG_SIGNUP_ENABLED === 'true' && env.LEAD_CONVERSATION_V2_ENABLED === 'true';
export function craigSignupMetaScopeAllowed(env,payload) {
  if(env.META_TEST_MODE!=='true')return true;
  const allowed=(value,id)=>Boolean(id)&&String(value||'').split(',').map(item=>item.trim()).includes(id);
  return allowed(env.META_TEST_FORM_IDS,payload.meta_form_id)&&allowed(env.META_ALLOWED_PAGE_IDS,payload.meta_page_id);
}
export const CRAIG_READY_LABEL = 'Ready for account setup';
const office = 'Our office will follow up with you directly.';
const officeQuestion = 'Great question, our office can answer that for you when they create your account.';
const timing = "It depends on the route that day, so we can't promise a time. Our office will confirm the cleanup day during setup.";
const yardReview = 'If your yard is larger than 1/8 acre, there is an upcharge for yard size, which our office reviews.';
const sanitizeOffer = "With that much buildup, I'd recommend a sanitization treatment to kill any bacteria left behind. Is that something you might be interested in?";
const sanitizeDetails = 'After we clean up, we treat the area your dogs use with a pet-safe treatment that kills the bacteria and germs left behind from the waste.';
const frequencyNames = {once_a_week:'weekly',twice_a_week:'twice a week',every_other_week:'every other week',once_a_month:'monthly',one_time:'a one-time cleanup'};
const frequencyAliases = {'weekly':'once_a_week','twice weekly':'twice_a_week','twice a week':'twice_a_week','two_times_a_week':'twice_a_week',biweekly:'every_other_week','bi-weekly':'every_other_week','bi_weekly':'every_other_week',monthly:'once_a_month','one time':'one_time'};
const longGaps = ['two_months','3_4_months','5_plus'];
const clean = (value, max=200) => String(value ?? '').replace(/[\p{Cc}\p{Cf}]/gu,' ').replace(/[\u2013\u2014?]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
const fold = value => clean(value).toLowerCase();
const unique = list => [...new Set(list)];
const affirmative = /^(?:ye[asp]+|yup|yeah|ya|y|yes please|correct|right|sure|okay|ok|ya ok|sounds good|sounds great|that works|that's right|i am|i do|go ahead|👍(?:\uFE0F)?)[.! ]*$/iu;
const negative = /^(?:no|nope|nah|no thanks|not now|not really|i don't)[.! ]*$/i;
const gaps = {one_week:'one_week',two_weeks:'two_weeks',three_weeks:'three_weeks',one_month:'one_month',two_months:'two_months','3_4_months':'3_4_months','5_plus':'5_plus','5_6_months':'5_plus','7_9_months':'5_plus','10_plus':'5_plus'};
const ledgerStages = {confirm:'confirm_details_sent',rate:'quote_sent',gap:'details_confirmed',trial:'quote_sent',after_cleanup:'quote_sent',sanitize:'quote_sent',setup:'ready',collect:'access_questions_sent',ready:'handoff_signup',closed:'closed_lost',coverage:'escalated',commercial:'collect_details',office_review:'escalated'};
const intakeFields = ['name','phone','dogs','frequency','zip','city','address','email','lastCleaned','gateSide','gateLock','disposal','dogBehavior','startPreference','yardTier','yardAcres'];
const questions = {
  dogs: 'How many dogs use the yard?',
  location: "What's the ZIP code for the yard?",
  frequency: 'How often would you like service?',
  address: "What's the service address?",
  email: "What's the best email address for your account?",
  gateSide: 'If you are facing your house, which side is the gate we will use?',
  gateLock: 'Is the gate locked or does it have a code?',
  dogBehavior: 'If your dogs were let out while we were in the yard, would they be nervous or have an issue with us being there?',
  startPreference: 'When would you like to get started?',
};

function normalizeFrequency(value) {
  const key = fold(value);
  return Object.hasOwn(frequencyNames,key) ? key : frequencyAliases[key];
}
export function craigGap(value) {
  const input = fold(value).replaceAll('-','_');
  if (Object.hasOwn(gaps,input)) return gaps[input];
  if (/\b(?:never|since (?:the )?(?:summer|spring|last year)|years?)\b/.test(input)) return '5_plus';
  if (/\b(?:today|yesterday|last week|(?:a few|[1-7]|one|two|three|four|five|six|seven) days?)\b/.test(input)) return 'one_week';
  const match = input.match(/\b(\d{1,2}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|couple)(?:[\s_]*(?:to|_|or)[\s_]*(\d{1,2}|two|three|four|five|six))?\s*(?:of\s+)?(weeks?|wks?|months?|mos?)\b/);
  if (!match) return /\b(?:a while|long time)\b/.test(input) ? 'custom' : undefined;
  const numbers = ['','one','two','three','four','five','six','seven','eight','nine','ten'];
  const count = value => Number(value) || ({a:1,an:1,couple:2}[value] ?? numbers.indexOf(value));
  const amount = Math.max(count(match[1]),count(match[2]));
  if (amount < 1) return;
  if (/^w/.test(match[3])) return amount<=3 ? ['','one_week','two_weeks','three_weeks'][amount] : amount<=6 ? 'one_month' : amount<=10 ? 'two_months' : amount<=18 ? '3_4_months' : '5_plus';
  return amount<=2 ? ['','one_month','two_months'][amount] : amount<=4 ? '3_4_months' : '5_plus';
}
function fact(key, value) {
  if (key==='dogs') return Number.isInteger(Number(value)) && +value>0 && +value<=99 ? +value : undefined;
  if (key==='frequency') return normalizeFrequency(value);
  if (key==='lastCleaned') return value==='custom' ? value : craigGap(value);
  if (key==='zip') return /^\d{5}$/.test(value || '') ? String(value) : undefined;
  if (key==='email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value || '') ? clean(value,254) : undefined;
  if (key==='gateSide') return ['left','right','no_gate','alley','other'].includes(value) ? value : undefined;
  if (key==='gateLock') return ['unlocked','locked','code','padlock','not_applicable'].includes(value) ? value : undefined;
  if (key==='dogBehavior') return ['comfortable','nervous','aggressive','unknown'].includes(value) ? value : undefined;
  if (key==='disposal') return ['trash','haul_away','declined_trash'].includes(value) ? value : undefined;
  if (key==='yardAcres') return typeof value==='number' && value>0 ? value : undefined;
  if (key==='address') return /^\d+\s+\S+\s+\S/.test(clean(value)) ? clean(value) : undefined;
  if (key==='city') return /^[\p{L} .'-]{2,55}$/u.test(clean(value)) ? clean(value) : undefined;
  return clean(value) || undefined;
}
function sanitizedFacts(input) {
  return Object.fromEntries(intakeFields.flatMap(key => {
    const value=fact(key,input?.[key]);
    return value===undefined?[]:[[key,value]];
  }));
}
function dogsLabel(count) { return count + (count===1 ? ' dog' : ' dogs'); }
function detailsQuestion(data, returning=false) {
  for (const [key, known] of [['dogs',data.dogs],['location',data.zip||data.city||returning],['frequency',data.frequency]]) {
    if (!known) return {key,body:questions[key]};
  }
  const where = data.city || (data.zip ? 'ZIP '+data.zip : '');
  const plan = frequencyNames[data.frequency] + (data.frequency==='one_time' ? '' : ' service');
  return {key:'confirm',body:'Just to confirm, you have '+dogsLabel(data.dogs)+(where ? ', live in '+where : '')+' and would like '+plan+(returning ? ' again' : '')+'?'};
}
export function buildCraigMetaOpener(lead,{firstMessage=true}={}) {
  const data=sanitizedFacts({...lead,dogs:lead.number_of_dogs??lead.dogs,frequency:lead.clean_up_frequency??lead.frequency});
  const first=data.name?.split(/\s/)[0];
  const greeting=first && /^[\p{L}][\p{L}'-]{0,39}$/u.test(first) ? 'Hi '+first+', ' : 'Hi, ';
  const body=formatCustomerSms(greeting+'this is Craig with Ohio Pet Waste Pros. Thanks for filling out our form! '+detailsQuestion(data).body);
  return firstMessage?body+'\n\nReply STOP to opt out':body;
}

function responseFacts(input, expected, raw, intents) {
  const c=input.classification||{};
  const extracted={...c.extracted,...c.corrections};
  // The classifier can copy spoken facts. Questions about a hypothetical plan
  // or town do not overwrite the actual pet count, location, or plan.
  const question = intents.some(intent=>intent==='question_price'||intent==='question_service_area');
  const copy={...extracted};
  if(question) {
    for(const key of ['dogs','frequency','city','zip']) if(!Object.hasOwn(c.corrections||{},key) &&
      (input.state?.craigSignup?.details?.[key] || input.lead?.[key])) delete copy[key];
  }
  if(intents.includes('question_service_area')) {
    for (const key of ['city','zip']) if(!Object.hasOwn(c.corrections||{},key) && expected!=='location') delete copy[key];
  }
  if (!c.fallbackReply) {
    const gap=craigGap(raw);
    if(gap && (expected==='gap'||/\b(?:last cleaned|last picked|last scooped|since|cleaned it|buildup|built up)\b/i.test(raw))) copy.lastCleaned=gap;
  }
  const email=raw.match(/[^\s<>,;]+@[^\s<>,;]+\.[a-z]{2,}/i)?.[0];
  if(email && !/\b(?:send|text|email) (?:me )?(?:to|at)\b/i.test(raw)) copy.email??=email.replace(/[.!?]+$/,'');
  return sanitizedFacts({...copy,...input.localFacts});
}

const areas = new Map(cities.map(row=>[fold(row.city),row.zips.split(',').map(zip=>zip.trim())]));
function areaFor(zip, city) {
  const town=fold(city);
  if(zip==='43416'||town==='elmore') return 'no';
  if(zip==='43430'||town==='genoa') return 'genoa';
  if(zip==='43565'||town==='tontogany') return 'tontogany';
  if(zip) return PRICING.serviceZips.includes(zip) ? 'yes' : 'review';
  const mapped=areas.get(town);
  return mapped?.some(zip=>PRICING.serviceZips.includes(zip)) ? 'yes' : 'review';
}

function billingText(state) {
  if (state.convertedTrial) return 'Your first invoice includes the lower initial cleanup rate, next month of service paid up front, and any add-ons you choose.';
  if (state.details.frequency==='one_time') return 'Your invoice covers the one-time cleanup and any add-ons you choose.';
  return 'Your first invoice includes the initial cleanup and your service for the rest of this month, prorated, plus any add-ons you choose. After that, your monthly invoice is processed on the 1st using your card on file.';
}
function rateOffer(state,plan=state.details.frequency,{infoOnly=false}={}) {
  const dogs=state.details.dogs, amount=craigRate(plan,dogs);
  if (amount===null) return null;
  const label=frequencyNames[plan];
  return 'Our rate for '+dogsLabel(dogs)+' with '+label+' service is $'+amount+' per month.'+(infoOnly?'':' Is that something you might be interested in?');
}
function cleanupCopy(state,kind) {
  const {dogs,lastCleaned}=state.details, range=craigCleanupRange(kind,lastCleaned,dogs);
  if (range) return (kind==='one_time'?'A one-time cleanup':'The initial cleanup')+' would be '+craigRangeText(range)+'. We provide a range based on how long it has been since the yard was last thoroughly cleaned up.';
  return dogs>=6 && dogs<=7 ? "Since we don't have a set range for "+dogsLabel(dogs)+', our office will give you an exact price once they look at the yard.' : "Since it's been a while, our office will give you an exact price for the cleanup once they look at the yard.";
}
function trialOffer(state) {
  const {dogs,lastCleaned}=state.details;
  const range=craigCleanupRange('initial',lastCleaned,dogs), rate=craigRate('once_a_week',dogs);
  if (!range||!rate) return null;
  return 'If you try our weekly service for a month, the initial cleanup drops to '+craigRangeText(range)+', and weekly service for '+dogsLabel(dogs)+' is $'+rate+' per month. Is that something you might be interested in?';
}
function disposalQuestion(state) {
  if(state.details.frequency==='one_time') return 'Can we use your outdoor trash can for this cleanup?';
  if(state.details.disposal==='declined_trash') {
    const rate=haulRate(state.details.dogs);
    return rate===null?'Would you like our office to review haul-away?':'Haul-away is $'+rate+' per month. Would you like to add that?';
  }
  return 'Is there an outdoor trash can on the gate side, or would you prefer haul-away?';
}
const haulRate = dogs => !dogs?null:dogs>=3?ADDONS.haulAwayLarge:ADDONS.haulAway;
function readyNext(state, ask, alert) {
  const d=state.details;
  let fields=['address','email','gateSide','gateLock','disposal','dogBehavior','startPreference'];
  if(d.gateSide==='no_gate') fields=fields.filter(key=>key!=='gateLock');
  for(const key of fields) {
    if (d[key] && !(key==='disposal'&&d.disposal==='declined_trash'&&!state.disposalReview)) continue;
    ask(key,key==='disposal'?disposalQuestion(state):questions[key]);
    return '';
  }
  state.phase='ready';
  state.expected=null;
  state.readyForAccountSetup=true;
  alert('signup_ready');
  return 'We will follow up once your account has been created to let you know your '+(d.frequency==='one_time'?'cleanup day':'service day and initial cleanup day')+', and send you a link to add your card on file, or we can give you a call.';
}
function setupOffer(state) {
  return state.returning?'If that all sounds good I can get you set back up.':state.details.frequency==='one_time'?'If that all sounds good I can get your one-time cleanup set up for you.':'If that all sounds good I can get your account set up for you.';
}
function gratitude(state) {
  const choices=['Thank you!','Perfect!','Sounds great!','Thanks!'];
  state.gratitudeIndex=((state.gratitudeIndex??-1)+1)%choices.length;
  return choices[state.gratitudeIndex];
}

export function composeCraigSignup(input={}) {
  const raw=String(input.text||'').slice(0,4000), c=input.classification||{}, intents=new Set(c.intents||[]);
  const topics=new Set(c.playbook_topics||[]), has=key=>intents.has(key), topic=key=>topics.has(key);
  const old=input.state?.craigSignup||{};
  const state={phase:'confirm',expected:'confirm',turns:0,unclear:0,...old,details:{...sanitizedFacts(input.lead),...old.details}};
  const notes=[], replies=[];
  const alert=reason=>{if(!notes.includes(reason)) notes.push(reason);};
  const add=body=>{if(body && !replies.includes(body)) replies.push(body);};
  const ask=(key,body)=>{if(!replies.some(reply=>reply.includes('?'))){state.expected=key;add(body);}};
  const finish=(reason='craig_signup_reply')=>{
    const body=formatCustomerSms(replies.join(' '));
    return {body,noSend:!body,reason,notifyReasons:notes,state:{...input.state,stage:ledgerStages[state.phase]||'intro_sent',craigSignup:state},intent:c.intent||[...intents][0]||'unclear'};
  };
  if(input.suppressed||prefilterPlaybookOptOut(raw)||has('stop')) return finish('opted_out');
  if(input.paused) return finish('automation_paused');
  if(state.phase==='closed') return finish('conversation_closed');
  if(has('wrong_number')) {
    add("Sorry about that, thank you for letting me know! We won't text you again.");
    alert('wrong_number');
    state.phase='closed';
    return {...finish('wrong_number'),suppressAfterReply:true};
  }
  if(has('spam')) {alert('spam');state.phase='closed';return finish('spam');}
  if(input.activeCustomer) {
    add('Thanks for letting us know! '+office);
    alert('existing_customer');
    state.phase='closed';
    return finish('existing_customer');
  }
  if (++state.turns>40) {
    state.phase='closed';add(office);alert('turn_limit');return finish('turn_limit');
  }
  if (has('spanish')) {
    add('¡Gracias! Nuestra oficina se comunicará con usted pronto.');
    alert('spanish');
    return finish('spanish');
  }
  const yes=c.confirms_details==='yes'||affirmative.test(raw.trim())||has('confirm_yes');
  const no=negative.test(raw.trim())||has('decline_step');
  const wantsSignup=has('ready_to_sign_up')&&!has('request_form_link');
  const explicitlyAsksPrice=/\b(?:price|cost|how much|rate|charge|extra|fee)\b|\$/.test(raw.toLowerCase());
  const sanitizePrice=has('question_sanitization_price')&&explicitlyAsksPrice&&
    (state.expected==='sanitize'||/\bsanitiz\w*\b/i.test(raw));
  const facts=responseFacts(input,state.expected,raw,[...intents]);
  if(c.fallbackReply) {
    for (const key of Object.keys(facts)) if(!Object.hasOwn(input.localFacts||{},key)) delete facts[key];
  }
  if (facts.city && state.details.city && fold(facts.city)!==fold(state.details.city) && !facts.zip) delete state.details.zip;
  if (facts.zip && state.details.zip && facts.zip!==state.details.zip && !facts.city) delete state.details.city;
  const termsChanged=old.details && ['dogs','frequency'].some(key=>facts[key]!==undefined&&facts[key]!==state.details[key]);
  // A proposed weekly replacement is accepted only by a reply to that offer.
  if(termsChanged && !['confirm','commercial','coverage'].includes(state.phase)){
    state.phase='confirm';state.expected='confirm';state.planAccepted=false;state.quotedCleanup=false;state.conversionOffered=false;state.convertedTrial=false;state.setupRequested=false;state.readyForAccountSetup=false;
    delete state.pendingFrequency;
  }
  Object.assign(state.details,facts);
  const d=state.details;
  if (has('heavy_buildup')) state.heavyBuildup=true;
  if (wantsSignup) state.setupRequested=true;
  if (state.phase==='collect'&&state.expected==='gateLock'&&!facts.gateLock&&(yes||no)) d.gateLock=yes?'locked':'unlocked';
  if (state.phase==='collect'&&state.expected==='dogBehavior'&&!facts.dogBehavior&&(yes||no)) d.dogBehavior=yes?'nervous':'comfortable';
  if (d.frequency==='one_time'&&d.disposal==='haul_away') d.disposal='declined_trash';
  if(d.dogBehavior==='nervous'||d.dogBehavior==='aggressive') {
    if(!state.dog_caution) {add('Thanks for telling me! Our office will reach out to you about that.');alert('dog_caution');}
    state.dog_caution=true;
  }
  if ((d.yardAcres>0.125||d.yardTier&& !['tiny','unsure'].includes(d.yardTier))&&!state.largeYard) {
    state.largeYard=true;
    add(yardReview);alert('property_walk');
  }
  if (has('spring_followup')||has('not_interested')&&!['trial','sanitize','addon','disposal','rate','setup'].includes(state.expected)) {
    if(has('spring_followup')) {state.spring_followup=true;alert('spring_followup');}
    state.phase='closed';
    add("No problem at all, thanks for letting me know! Just reach out whenever you're ready and we'll get you set up.");
    return finish('lead_declined');
  }
  const isNo=no||has('not_interested');
  if (has('complaint')) {add("Sorry about that, I'll look into it right away.");alert('complaint');}
  if (has('request_cash')) {add('Our office will reach out to you directly about that.');alert('cash');}
  if (has('request_person')||c.owner_reason==='requested_owner') {
    add('No problem, our office staff will follow up with you.');alert('requested_owner');
  }
  let firstDiscount=false;
  if (has('objection_price')) {
    if(!state.discount_offered && state.rate && d.frequency!=='one_time') {
      state.discount_offered=DISCOUNT;
      add('I totally understand. I can take $'+DISCOUNT+' off your first full month of service.');
      firstDiscount=true;
    } else {
      add(office);alert(state.discount_offered?'second_objection':'objection_before_quote');
    }
  }

  if (has('commercial')||state.phase==='commercial') {
    if(!d.address) {
      state.phase='commercial';
      add('Thanks for reaching out! Our office can put together a custom quote for that.');
      ask('address',"What's the property address?");
    } else {
      state.phase='office_review';state.expected=null;add(office);alert('commercial');
    }
    return finish('commercial');
  }

  if(has('question_service_area')||facts.city||facts.zip||['confirm','coverage'].includes(state.phase)) {
    const targetZip=has('question_service_area')?c.extracted?.zip||d.zip:d.zip;
    const targetCity=has('question_service_area')?c.extracted?.city||d.city:d.city;
    const ownYard=!has('question_service_area')||(!c.extracted?.zip&&!c.extracted?.city)||(targetZip&&targetZip===d.zip)||(fold(targetCity)&&fold(targetCity)===fold(d.city));
    if(targetZip||targetCity) {
      const area=areaFor(targetZip,targetCity);
      if(area==='no') {
        add("Thank you for reaching out! Unfortunately we don't currently service Elmore, but I can reach out if we expand that way.");
        if(ownYard){state.phase='office_review';state.expected=null;}
        return finish('outside_service_area');
      }
      if(area!=='yes') {
        if(ownYard){state.phase='coverage';state.expected=null;}
        if(area==='genoa'&&!d.address){add('Our Genoa service is on the far west side only.');ask('address',"What's the address so I can check it for you?");}
        else {add('Thanks! Let me check on that address for you.');alert('coverage_review');}
        return finish('coverage_review');
      }
      if(has('question_service_area')) add('That location is in our service area.');
    }
  }

  let comparisonQuoted=false;
  if(has('question_price')&&!sanitizePrice&&(c.extracted?.dogs||c.extracted?.frequency)&&!has('correction')&&
    !['coverage','office_review'].includes(state.phase)){
    const requested=sanitizedFacts(c.extracted);
    const terms={...d,...requested};
    if(terms.frequency!=='one_time'&&(terms.dogs!==d.dogs||terms.frequency!==d.frequency)){
      const quote=rateOffer({details:terms},terms.frequency,{infoOnly:true});
      add(quote||'Our office can review a custom quote for that option.');
      if(!quote)alert('custom_pricing');
      comparisonQuoted=true;
    }
  }

  if(has('question_service_day')||has('reschedule_timing')) add(timing);
  if(has('question_what_included')) add('We come out on your service day, clean up the yard, double bag the waste and put it in your trash can.');
  if(has('question_contract')&&/\b(?:contracts?|commitment|month[ -]to[ -]month|cancel|locked in)\b/i.test(raw)) add(d.frequency==='one_time'?'A one-time cleanup does not start recurring service.':"It's month to month with no contract.");
  if(has('question_billing')||topic('first_visit')||topic('clarify_unit')) add(billingText(state));
  if(has('question_check')&&/\b(?:checks?|cheques?)\b/i.test(raw)) {
    if(d.frequency==='one_time'){add(officeQuestion);alert('off_playbook');}
    else add('We do accept checks, but card on file is the easiest since everything processes automatically on the 1st.');
  } else if(has('question_payment')&&!has('request_cash')&&!has('question_billing')) add('Card on file is the easiest way to pay.');
  if(has('question_home')||topic('home')) add('Nobody needs to be home as long as we can get into the yard.');
  if(has('question_gate_access')&&!facts.gateSide&&!facts.gateLock&&!has('question_home')){
    add('We just need a way to get into the yard, and our office can review any special gate instructions.');
  }
  if(has('question_pets_safety')&&!facts.dogBehavior){
    add('Our office can talk through safe yard access for your dogs.');alert('dog_caution');
  }
  if(has('question_snow')||topic('rain_snow')||topic('winter_weather')) add('After heavy snow we usually pause when the waste is buried, and we try to get yards done beforehand.');
  if(has('question_yard_size')&& !replies.includes(yardReview)) add(yardReview);
  if(has('question_referral')) add("We don't have a referral program.");
  if(has('question_bundles')) add('We price add-ons individually.');
  if(has('question_sanitization')||topic('treatments')) add(sanitizeDetails);
  if(sanitizePrice){
    add('A one-time sanitization treatment is $'+ADDONS.sanitization+(d.frequency!=='one_time'?' or $'+ADDONS.recurringSanitization+' per month for recurring treatments.':'.'));
  }
  if(has('question_haul_away')||d.disposal==='declined_trash'&&d.frequency==='one_time'&&!state.disposalReview){
    if(d.frequency==='one_time') {
      add('Our office can review disposal for a one-time cleanup.');
      alert('one_time_disposal');state.disposalReview=true;
    } else {
      const rate=haulRate(d.dogs);
      add(rate===null?'Haul-away is $'+ADDONS.haulAway+' per month for 1 or 2 dogs, or $'+ADDONS.haulAwayLarge+' for 3 or more.':'Haul-away is $'+rate+' per month.');
    }
  }
  let offeredAddon;
  if(topic('front_yard')||topic('included_front')){
    if(d.frequency==='one_time'){add(officeQuestion);alert('off_playbook');}
    else {add('We can add the front yard for $'+ADDONS.frontYard+' per month.');offeredAddon='front_yard';}
  }
  if(has('question_deodorization')) {
    add('We offer a deodorization treatment for $'+ADDONS.deodorization+' per treatment.');
    offeredAddon=offeredAddon?null:'deodorization';
  }
  if(topic('dog_food')) add('A 40 lb bag is $'+ADDONS.dogFood+'.');
  if(has('request_form_link')) add('Here is our quote form: https://www.ohiopetwastepros.com/free-quote/');
  if(has('question_identity')) add('This is Craig with Ohio Pet Waste Pros.');
  if(has('is_this_ai')&&!has('question_identity')&&!has('request_person')&&c.owner_reason!=='requested_owner'){
    add('I use an AI assistant to help me reply quickly.');
    if(state.expected!=='human') state.resumeExpected=state.expected;
    ask('human','Would you like someone from our office to follow up with you?');
    return finish('ai_disclosure');
  }
  if (state.expected==='human'&&(yes||isNo)) {
    state.expected=state.resumeExpected||null;
    if(yes){add('No problem, our office staff will follow up with you.');alert('requested_owner');return finish('requested_owner');}
    add('No problem!');
    return finish();
  }
  if (state.expected==='addon'&&(yes||isNo)){
    if(yes&&!isNo)state.addons=unique([...(state.addons||[]),state.pendingAddon]);
    delete state.pendingAddon;
    state.expected=state.resumeExpected||null;
    add(yes&&!isNo?'Thanks, I noted that for our office.':'No problem!');
    return finish();
  }
  if (has('skip_request')||has('winter_pause')||has('danger')||has('off_playbook')&&!replies.length||
      c.needs_owner&&['off_playbook','uncertain'].includes(c.owner_reason)&&!replies.length) {
    add(officeQuestion);alert('off_playbook');
  }
  if (topic('treatments')||has('question_sanitization')) {
    if(state.expected==='sanitize') ask('sanitize','Would you like to add it?');
  }
  if (sanitizePrice&&state.expected==='sanitize') ask('sanitize','Would you like to add that?');

  const usable=Object.keys(facts).length>0||yes||isNo||wantsSignup;
  if (!replies.length&&(!usable&&(has('unclear')||c.fallbackReply|| !intents.size))) {
    state.unclear++;
    if(state.unclear>=2){add(office);alert('unclear_repeated');}
    else add(state.clarifiedBefore?"Sorry, could you say that another way?":"Sorry, I didn't quite catch that. How can I help you?");
    state.clarifiedBefore=true;
    return finish('unclear');
  }
  state.unclear=0;
  if(offeredAddon&&!yes&&!isNo&&!wantsSignup&&!Object.keys(facts).length&&!notes.length&&!replies.some(body=>body.includes('?'))){
    if(state.expected!=='addon')state.resumeExpected=state.expected;
    state.pendingAddon=offeredAddon;
    ask('addon','Would you like to add that?');
    return finish();
  }
  if(firstDiscount){state.resumeExpected=state.expected;ask('discount','Is that something you might be interested in?');return finish('first_month_discount');}
  if(state.expected==='discount'&&(yes||isNo)){
    state.expected=state.resumeExpected||'rate';
    if(isNo){add(office);alert('second_objection');return finish('second_objection');}
  }
  if(has('objection_price')||has('complaint')||has('request_person')||c.owner_reason==='requested_owner') return finish(notes[0]);
  if(replies.some(reply=>reply.includes('?'))) return finish();

  const sideOnly=!yes&&!isNo&&!wantsSignup&&!Object.keys(facts).length;
  if (state.phase==='office_review'||state.phase==='ready') {
    if(!replies.length)add(state.readyForAccountSetup?'Thanks! Our office is reviewing your setup details.':office);
    return finish();
  }
  if (state.phase==='confirm'||state.phase==='coverage') {
    const q=detailsQuestion(d,state.returning);
    if(q.key!=='confirm'){if(!sideOnly||!replies.length)ask(q.key,q.body);return finish();}
    if(state.returning&&wantsSignup&&!state.returningPrompted&&!yes){
      state.returningPrompted=true;
      add("That's great to hear, thank you!");
      ask(q.key,q.body);
      return finish();
    }
    if (!(yes||wantsSignup||has('correction')||termsChanged||state.expected!=='confirm'&&Object.keys(facts).length)) {
      if(has('question_price')&&!comparisonQuoted&&d.frequency!=='one_time'){
        const info=rateOffer({details:{...d,...sanitizedFacts(c.extracted)}},undefined,{infoOnly:true});
        if(info)add(info);
      }
      if(!replies.length)ask('confirm',q.body);
      return finish();
    }
    if(!d.zip&&!d.city&&!state.returning){ask('location',questions.location);return finish();}
    add(gratitude(state));
    if(d.frequency==='one_time') {state.phase='gap';state.expected='gap';}
    else {
      state.phase='rate';
      let plan=d.frequency;
      if (!craigRate(plan,d.dogs)&&['every_other_week','once_a_month'].includes(plan)&&craigRate('once_a_week',d.dogs)){
        add(plan==='every_other_week'?'Our every other week plan is for up to 3 dogs.':'Our monthly plan is for up to 2 dogs.');
        plan='once_a_week';state.pendingFrequency=plan;
      }
      const offer=rateOffer(state,plan);
      if(!offer){state.phase='office_review';add('Our office will put together a custom quote for that plan.');alert('custom_pricing');return finish('custom_pricing');}
      state.rate=craigRate(plan,d.dogs);
      ask('rate',offer);
      return finish();
    }
  }
  if(state.phase==='rate'){
    if(yes||wantsSignup) {
      if(state.pendingFrequency){d.frequency=state.pendingFrequency;delete state.pendingFrequency;}
      state.planAccepted=true;state.phase='gap';state.expected='gap';
    } else {
      if(isNo){state.phase='closed';add("No problem, thanks for letting me know!");}
      if(has('question_price')&&!comparisonQuoted||!replies.length&&state.phase==='rate') add(rateOffer(state,state.pendingFrequency||d.frequency,{infoOnly:true}));
      if(state.phase==='rate'&&replies.length)ask('rate','Is that something you might be interested in?');
      return finish();
    }
  }
  if(state.phase==='gap'){
    if(!d.lastCleaned){ask('gap','How long has it been since the yard was last thoroughly cleaned up?');return finish();}
    if(!state.quotedCleanup){
      if(!replies.length)add(gratitude(state));
      const kind=d.frequency==='one_time'?'one_time':'initial';
      add(cleanupCopy(state,kind));
      state.quotedCleanup=true;
      if(!craigCleanupRange(kind,d.lastCleaned,d.dogs))alert('custom_pricing');
    }
    const offer=d.frequency==='one_time'?trialOffer(state):null;
    if(offer&&!state.conversionOffered) {
      state.conversionOffered=true;state.phase='trial';ask('trial',offer);return finish();
    }
    state.phase='after_cleanup';
  }
  if(state.phase==='trial'){
    if(isNo||yes||wantsSignup) {
      if(yes&&!isNo||has('accept_weekly_trial')){d.frequency='once_a_week';state.convertedTrial=true;state.rate=craigRate(d.frequency,d.dogs);state.planAccepted=true;}
      state.phase='after_cleanup';
    } else {
      if(has('question_billing') && !state.convertedTrial){
        replies.splice(replies.indexOf(billingText(state)),1,'For the weekly trial, your first invoice would include the lower initial cleanup rate, next month of service paid up front, and any add-ons you choose.');
      }
      if(!replies.length)add(trialOffer(state));
      else ask('trial','Would you like to try weekly service?');
      return finish();
    }
  }
  if(state.phase==='after_cleanup'){
    if((longGaps.includes(d.lastCleaned)||has('heavy_buildup')||state.heavyBuildup)&&state.sanitization===undefined){
      state.phase='sanitize';ask('sanitize',sanitizeOffer);return finish();
    }
    state.phase='setup';state.expected='setup';
    add(setupOffer(state));
    if(!wantsSignup&&!state.setupRequested)return finish();
  }
  if(state.phase==='sanitize'){
    if(has('question_sanitization')||sanitizePrice||topic('treatments'))return finish();
    if(!yes&&!isNo&&!wantsSignup) {ask('sanitize','Would you like to add sanitization?');return finish();}
    state.sanitization=yes&&!isNo?'one_time':'declined';
    state.phase='setup';state.expected='setup';add(gratitude(state));add(setupOffer(state));
    if(!wantsSignup&&!state.setupRequested)return finish();
  }
  if(state.phase==='setup'){
    if(wantsSignup||yes||state.setupRequested) {
      state.phase='collect';state.setupRequested=true;
    } else {
      if(isNo) {state.phase='closed';add("No problem, thanks for letting me know!");}
      else if(!replies.length)add(setupOffer(state));
      return finish();
    }
  }
  if(state.phase==='collect'){
    if(state.expected==='disposal'){
      if(yes&&!facts.disposal)d.disposal=d.disposal==='declined_trash'?'haul_away':'trash';
      if(isNo&&!facts.disposal){
        if(d.disposal==='declined_trash'||d.frequency==='one_time'){state.disposalReview=true;alert('one_time_disposal');}
        d.disposal='declined_trash';
      }
    }
    if(replies.some(reply=>reply.startsWith('Haul-away is'))&&d.disposal==='declined_trash') {
      ask('disposal','Would you like to add that?');return finish();
    }
    const close=readyNext(state,ask,alert);
    if(close){if(!replies.length)add(gratitude(state));add(close);}
    return finish();
  }
  if(!replies.length){add(officeQuestion);alert('off_playbook');}
  return finish();
}

export function createCraigSignupDecision(input) {
  const raw=String(input.text||'');
  const expected=input.state?.craigSignup?.expected;
  const localFacts={};
  if (!/\?/.test(raw) && (/\b(?:gate|lock)\s+(?:code|pin)\b|\b(?:code|pin)\s+(?:is|:|=)\s*\d/i.test(raw) || expected==='gateLock'&&/^\s*\d{3,8}\s*$/.test(raw))) localFacts.gateLock='code';
  const context={classification:input.classification,text:redactStaffExcerpt(raw),localFacts,lead:sanitizedFacts(input.lead),state:{craigSignup:input.state?.craigSignup},activeCustomer:Boolean(input.activeCustomer)};
  const decision=composeCraigSignup(context);
  return {...decision,state:{...input.state,...decision.state},confidence:1,templateKey:'structured_playbook_v2',pricingVersion:CRAIG_PRICING_VERSION,
    slots:{craigSignupContext:context},escalate:decision.notifyReasons.length>0,needsOwner:decision.notifyReasons.length>0};
}
export function validateCraigSignupReply(body, context) {
  const expected=composeCraigSignup(context).body;
  if(!expected || body!==expected || body.length>1000 || (body.match(/\?/g)||[]).length>1 ||
     /[\u2013\u2014]|\$\d+\.\d{2}|\bthe owner\b|Reply STOP to opt out|\/api\/onboard/.test(body)) return ['craig_signup_reply_unverified'];
  return [];
}

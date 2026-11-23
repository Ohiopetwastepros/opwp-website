import {cities, declinedServiceCity, getCityByZip} from '../data/cities.js';
import {PRICING} from './lead-pricing.mjs';

const normalize = value => String(value || '').normalize('NFKC').replace(/[\u2018\u2019]/g, "'").replace(/[\u2013\u2014]/g, '-').toLowerCase().trim();
const publicCities = [...new Set(cities.filter(city => city.zips.split(',').some(zip => PRICING.serviceZips.includes(zip.trim()))).map(city => city.city))];
const boundaries = publicCities.map(city => [city, new RegExp('\\b' + city.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&') + '\\b', 'i')]);
const stop = (topic, intent = 'faq_handoff', reason = topic) => ({topic, intent, reason, handoff: true});
const answer = (topic, intent = 'faq_question') => ({topic, intent});
const bracketPhoto = /^\[(?:photo|image)(?: only)?\]$/i;
const emoji = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\uFE0F|\u200D|\s)+$/u;
const thumbs = /^(?:\u{1f44d}[\u{1f3fb}-\u{1f3ff}]?\uFE0F?\s*)+$/u;
const isHuman = /\b(?:(?:talk|speak|text|connect|chat) (?:to|with) (?:a |the |an? real )?(?:real )?(?:person|human|owner|manager)|(?:want|need|prefer|get|have) (?:a |the )?(?:real person|human|owner|personal (?:reply|call))|(?:call|phone|ring) (?:me|us)|(?:give (?:me|us) |request )(?:a )?(?:call|callback)|(?:someone|owner|person|human) (?:to )?(?:call|reach out)|(?:call|text) (?:me )?(?:back|personally))\b/;
const ai = /\b(?:are (?:you|u) (?:an? )?(?:bot|ai|robot|sona|real person|human|automated)|is (?:this|it) (?:an? )?(?:bot|ai|robot|sona|automated)|is (?:this|that) (?:a )?(?:real person|human)|are these (?:texts|messages|replies) (?:automated|ai)|talking (?:to|with) (?:an? )?(?:bot|ai|robot))\b/;
const complaint = /\b(?:unacceptable|complain(?:t|ing)?|missed (?:a |my |our |the |some |several |many )?(?:piles?|spots?|yard|cleanup|service|visit|waste|bags?)|(?:didn't|did not|never) (?:show (?:up)?|come (?:out|by)|clean (?:my|our) yard|see anyone (?:come|here))|(?:only|barely) (?:here|there|worked)(?: for)? \d+ (?:min|minutes?)|(?:left|leaving) (?:the |our |my )?gate open|gate (?:was |is )?left open|(?:missing|lost) (?:waste |trash )?bag|(?:no|no sign of (?:a|the)) bag (?:in|by)|(?:bag|waste) (?:isn't|wasn't|is not|was not) in (?:the|my|our) (?:can|bin)|(?:picked up|found|left) (?:a (?:bunch|lot) of |\d+ |several |many )(?:piles?|waste)|terrible (?:job|service)|pissed|fuck(?:ing)?)\b/;
const dispute = /\b(?:refund|chargeback|charge back|overcharged|double[- ]charged|dispute|wrong charge|charged (?:me|twice|again)|don't charge|do not charge|money back|unauthori[sz]ed (?:charge|payment)|credit (?:my|our) (?:account|card)|prorat(?:e|ed|ion))\b/;
const foreign = /\b(?:hola|cu[aá]nto|perros?|habl[ae] (?:usted |en )?espa[nñ]ol|espa[nñ]ol|necesito|quisiera|por favor|bonjour|combien|parlez|fran[cç]ais|gracias|sprechen sie|deutsch|obrigad[oa]|portugu[eê]s|ciao|italiano|buongiorno|dzien dobry|polsku|hallo|ayuda|buen[oa]s (?:d[ií]as|tardes))\b|[¿¡]|\p{Script=Cyrillic}|\p{Script=Arabic}|\p{Script=Han}|\p{Script=Devanagari}/u;
const foodWords = /\b(?:dog food|extreme dog fuel|food (?:bag|order|delivery)|bag (?:of (?:dog )?food|recommendation)|(?:blue|green|pink|red) (?:food |formula )?bag)\b/;
const treatment = /\b(?:sani(?:ti[sz](?:e|er|ers|ing|ation)?|tation)|deodori[sz](?:e|er|ers|ing|ation)|spray|wysiwash)\b/;
const combo = /\b(?:combo|bundle|package (?:deal|price|rate)|bundle[d ]*price)\b/;
const pricePush = /\b(?:too (?:expensive|pricey|high|much|steep)|(?:price|cost|rate)(?: is|'s| seems| feels)? (?:too )?(?:high|steep|expensive)|(?:more|higher) than (?:(?:i|we) )?(?:expected|thought|hoped)|expensive|pricey|cheaper|afford|can (?:you|we) do (?:any )?better|better (?:deal|price|rate)|lower (?:the |that |your |my )?(?:price|rate|cost)|(?:discount|promo (?:rate|code)|special (?:price|deal)|first[- ]month special)|(?:price|rate) match|match (?:their|the|my|this|that) (?:price|quote|rate)|match \$|work with (?:me|us) on (?:the )?price|why (?:is (?:it|that)|so) (?:so )?(?:much|high)|why (?:does|would) (?:it|that) cost|out of (?:my|our) (?:budget|price range)|over (?:my|our) budget|(?:price|rate) negotiable|negotiate)\b/;
const plan = /\b(?:weekly|bi[- ]?weekly|every other week|twice (?:a week|weekly)|monthly|once a month)\b/;
export function faqServiceLocation(text) {
  const message = normalize(text).replace(/\b(?:gate |door |entry |access |keypad |alarm |garage |lockbox )?(?:code|pin|password)\s*(?:is|=|:|#)?\s*[a-z\d#*-]*\d[a-z\d#*-]*/g, '').replace(/\b(?:card|account|routing) (?:number |no )?(?:is |:|#)?(?:\d[ -]?){4,19}/g, '');
  // Never treat a payment number or access code as a ZIP.
  const explicit = message.match(/\b(?:zip(?: code)?(?: is)?|postal code|in zip|in|oh(?:io)?|mi(?:chigan)?)\s*[:#,]?\s*(\d{5})(?:-\d{4})?\b/);
  const hasLocation = /\b(?:service|area|located|address|yard is in|we're in|i'm in|live in)\b/.test(message) || boundaries.some(([, pattern]) => pattern.test(message)) || declinedServiceCity(message) || /^(\d{5})(?:-\d{4})?[.!]?$/.test(message);
  const zip = explicit?.[1] || (hasLocation && !/\b(?:code|card|account number|pin)\b/.test(message) ? message.match(/\b(\d{5})(?:-\d{4})?\b/)?.[1] : '') || '';
  const city = boundaries.find(([, pattern]) => pattern.test(message))?.[0] || '';
  const declined = declinedServiceCity(message);
  return {zip, city, declined, monroe: /\bmonroe\b/.test(message), inArea: Boolean(zip && PRICING.serviceZips.includes(zip))};
}

export function recognizeLeadFaq(text, context = {}) {
  const m = normalize(text);
  const quoted = Boolean(context.quote || ['quote_sent', 'ready', 'discount_offered', 'objection', 'access_questions_sent'].includes(context.stage));
  if (context.expecting_access_code && /^#?[a-z\d*#-]{3,16}[.!]?$/.test(m) && /\d/.test(m)) return {...answer('access_note','question_gate_access'), accessCode:true};
  if (dispute.test(m)) return stop('payment_dispute');
  if (/\b(?:attorney|lawsuit|lawyer|sue (?:you|the)|legal action|harass(?:ment|ing)|fraud|fraudulent)\b/.test(m)) return stop('legal_handoff');
  if (/\b(?:bite history|bitten|bit (?:a|someone|me|us|the)|has (?:a |been known to )?bit(?:e|ing)|will bite|(?:dog|he|she) bites|(?:can't|cannot) (?:be secured|secure (?:them|him|her|my|our|the)|contain (?:them|him|her|my|our|the)|keep (?:them|him|her|my dog|our dog|the dogs?) (?:in|inside|secured)|bring (?:them|him|her|my dog|the dogs?) (?:in|inside))|(?:can't|cannot|won't) be (?:secured|contained)|(?:loose|unrestrained).{0,32}aggressive|aggressive.{0,40}(?:loose|outside|in the yard|unsupervised)|injur(?:y|ed)|technician (?:felt|was) unsafe)\b/.test(m)) return stop('safety_handoff');
  if (m.includes('[payment details removed]') || /\b(?:cvv|cvc|security code (?:on|from) (?:the|my) card|(?:credit|debit) card (?:number|details)|bank (?:account|routing) (?:number|details)|routing number|ssn|social security number)\b/.test(m) || /(?:\d[ -]?){13,19}\b|\b\d{3}-\d{2}-\d{4}\b/.test(m)) return stop('payment_secure');
  if (foreign.test(m) || /\b(?:speak|reply|respond|text) (?:in )?(?:spanish|french|russian|arabic|chinese|german|portuguese|polish|italian|korean)\b/.test(m)) return stop('language_handoff');
  if (complaint.test(m)) return stop('complaint');
  if ((isHuman.test(m) || /\b(?:talk|speak) (?:with|to) someone|(?:i'll|i will) wait to hear (?:from|back)\b/.test(m))) return ai.test(m) ? stop('human_ai', 'is_this_ai', 'identity_question') : stop('human_request');
  if (ai.test(m) || context.metaBranch === 'human_help') return answer('identity_line', 'is_this_ai');
  if (/\b(?:venmo|paypal|cash ?app|zelle|crypto|wire transfer|money order|apple cash)\b/.test(m)) return stop('payment_exception');
  if (/\b(?:billing (?:issue|problem|error)|(?:problem|issue|error) with (?:my|our|the) (?:bill|invoice|payment)|my (?:bill|invoice) (?:is (?:wrong|incorrect)|looks wrong)|(?:declined|failed|expired|past[- ]due|resubmit|retry|rerun))\b/.test(m) && /\b(?:card|bill(?:ing)?|payment|invoice|charge)\b/.test(m)) return stop('account_billing');
  if (/\bcash\b/.test(m)) {
    const insist = /\b(?:cash only|only (?:have|pay|use|do|take|want to pay)(?: (?:in|with))? cash|must (?:pay|use) cash|insist|(?:will|can) only (?:pay|use)|all i have|no (?:card|checks?)|won't (?:use|pay with))\b/.test(m);
    return insist || context.cash_policy_explained && !/\b(?:check (?:is fine|works)|pay (?:by|with) (?:a )?(?:card|check)|no cash|instead of cash)\b/.test(m) ? stop('cash_exception') : answer('payment', 'question_payment');
  }
  if (/\b(?:referr(?:al|ed)|refer a (?:friend|neighbor))\b/.test(m) && !/\b(?:cheaper|expensive|too high)\b/.test(m) && !(quoted && /\b(?:discount|reduced rate|cheaper)\b/.test(m))) return answer(/\b(?:credit|discount|program|bonus)\b/.test(m) ? 'referral_policy' : 'referral');
  if (combo.test(m)) {
    const push = context.faq_last_topic === 'combo' || /\b(?:match|special (?:deal|price)|can you do better|come on|cheaper|discount|really|insist)\b/.test(m);
    return push || !treatment.test(m) && context.faq_last_topic !== 'treatments' && quoted ? stop('combo_handoff', 'objection_price', 'price_objection') : answer('combo');
  }
  if (pricePush.test(m) || /\b(?:can|could|would) you match\s+\$/.test(m) || /\b(?:comparing|competitor|other compan|another (?:company|quote)|shop around)\w*/.test(m)) {
    const comparison = /\b(?:compar|competitor|another|other company|shop around)/.test(m);
    return stop('price_objection', comparison ? 'objection_competitor' : 'objection_price', 'price_objection');
  }
  if (/\b(?:winter|spring|march|90 days)\b/.test(m) && /\b(?:pause|stop|start (?:back|again)|restart|hold|resume|see you in|suspend)\b/.test(m)) return stop('winter_pause');
  if (/\b(?:skip|cancel|miss)\b/.test(m) && /\b(?:one (?:week|visit|day|cleanup)|next week|only|just (?:the|that|one) (?:visit|day|week|cleanup)|keep (?:the|my|our) (?:plan|service)|this week)\b/.test(m) && !/\bcancel (?:at )?any ?time\b/.test(m)) return stop('skip_visit');
  if (/\b(?:passed away|lost (?:our|my) dog|dog (?:died|passed))\b/.test(m)) return stop('account_dog_loss', 'faq_handoff', 'account_dog');
  if (/\b(?:add|remove|took off|dropp?ing) (?:a |one |our |my )?dog\b|\b(?:change|update) (?:my |our |the )?dog count\b/.test(m) && /\b(?:account|portal|plan|service|rate|billing|already)\b/.test(m)) return stop('account_dog');
  if (/\b(?:please (?:cancel|pause|restart|resume)|(?:cancel|pause|restart|resume|stop|switch|change) (?:the |my |our )(?:plan|account|subscription|service|frequency)|(?:i|we) (?:want|need|would like) to (?:cancel|pause|restart|resume)|(?:can|could) (?:you|we) (?:pause|restart|resume) (?:for|from|on|until)|(?:switch|change) (?:my|our) (?:weekly|monthly|biweekly)|(?:on|for) (?:my|our) (?:existing|current) (?:plan|account)|i'm (?:already )?a (?:client|customer))\b/.test(m)) return stop('account_change');
  if (/\b(?:insurance|insured|licen[sc](?:ed|ing|e)|bond(?:ed|ing)?|w[- ]?9|vendor (?:packet|paperwork|form)|certificate of insurance|real company)\b/.test(m)) return stop('insurance_handoff');
  if (/\b(?:commercial|(?:our|the|an?) hoa\b(?! gate)|homeowners? association|apartment (?:complex|building|community)|kennels?|dog parks?|waste (?:stations?|bins?)|pet stations?|small[- ]dog side|large[- ]dog side|multiple (?:bins|properties)|on[- ]site dumpster|walk (?:both|multiple) (?:yards|sides))\b/.test(m)) return stop('commercial_scope');
  if (/\b(?:heavy woods|heavily wooded|huge paddock|hoard(?:ing|er)|multiple paddocks|acre.{0,35}(?:small pen|only use)|only use.{0,40}(?:surcharge|acre))\b/.test(m)) return stop('custom_quote', 'faq_handoff', 'custom_pricing');
  if (/\b(?:can't|cannot|might not|won't be able to) (?:get in|open (?:the )?(?:gate|latch)|unlock)|\b(?:broken lock|locked out|missing key|gate is jammed|latch won't open)\b/.test(m)) return stop('access_risk');
  if (foodWords.test(m) || context.faq_last_topic === 'dog_food' && /\b(?:order|first delivery|smaller|larger) (?:one|bag|size|delivery)\b/.test(m)) {
    return /\b(?:order|bill(?:ing)?|first delivery|food[- ]only|special (?:size|bag)|(?:smaller|larger) bags?|(?:send|deliver|drop off|bring|add) (?:me |us )?(?:a|one|two|the) bag|(?:buy|get|take) (?:a|one|the) bag|\d+\s*(?:lb|pound).*(?:instead|size|available))\b/.test(m) ? stop('food_order') : answer('dog_food');
  }
  const holiday = /\b(?:holiday|thanksgiving|christmas|new year's|labor day|memorial day|fourth of july)\b/.test(m);
  if (holiday && /\b(?:need|must|has to|has got to|guarantee|definitely|has to be|exact|only|book me|confirm (?:the|my) (?:date|start))\b/.test(m) || /\b(?:need|must|book|have to) (?:you (?:to )?|a (?:visit|cleanup) |service |to start )?.{0,18}\b(?:this week|tomorrow|today|this (?:monday|tuesday|wednesday|thursday|friday))\b/.test(m)) return stop('holiday_booking');
  if (/\b(?:reschedule|move (?:today's|my |our )?(?:visit|cleanup|appointment)|(?:are|weren't|aren't) you (?:still )?coming (?:today|this afternoon|tomorrow)|yard is flooded|my (?:scheduled |usual )?(?:visit|route) (?:today|tomorrow))\b/.test(m)) return stop('routing_handoff');
  const location = faqServiceLocation(m);
  if (context.stage === 'closed_lost' && context.faq_last_topic?.startsWith('coverage') && /\b(?:exception|just outside|squeeze|come anyway|make it work|consider us|extra|still come)\b/.test(m)) return stop('coverage_handoff');
  if (location.declined || location.zip && !location.inArea) {
    if (location.inArea && location.declined || /\b(?:exception|just outside|squeeze|come anyway|make it work|still come)\b/.test(m)) return stop('coverage_handoff');
    const name = location.declined || 'that ZIP';
    return {...answer(['Findlay','Fostoria'].includes(name) ? 'coverage_south' : name === 'Columbus' ? 'coverage_columbus' : 'coverage_decline'), areaName: name};
  }
  if (location.monroe && !location.zip) return context.expected === 'serviceAddressZip' ? stop('coverage_handoff') : answer('coverage_monroe');
  if (location.zip && location.city && getCityByZip(location.zip)?.city !== location.city && !cities.some(c => c.city === location.city && c.zips.split(',').some(z => z.trim() === location.zip))) return stop('coverage_handoff');
  if (context.expected === 'serviceAddressZip' && !location.zip && !location.city) return stop('coverage_handoff');
  if (/\b(?:do (?:you|we) (?:service|serve)|(?:come|service|serve) (?:out )?(?:here|my area|this area)|in (?:your|the) service area|areas? (?:do you )?(?:serve|cover))\b/.test(m)) return answer(location.inArea || location.city ? 'coverage_yes' : 'service_area_prompt');
  if (/\b(?:per (?:month|visit|cleanup)|each (?:visit|month)|monthly or (?:weekly|per)|(?:per visit|weekly) or (?:monthly|per month))\b/.test(m) && /\?|\b(?:is that|does that|is it|mean|clarify|charged)\b/.test(m)) return answer('clarify_unit', 'question_price');
  if (/\b(?:try|pay for|start with) (?:just |only )?(?:one|1|a) month\b|\b(?:one|1) month to (?:see|try)\b/.test(m)) return answer('try_month', 'question_contract');
  if (/\b(?:contract(?:ual)?|cancel (?:at )?any ?time|commitment|month[- ]to[- ]month|what if (?:i|we) (?:cancel|pause)|can (?:i|we) (?:cancel|pause)(?: (?:later|anytime|at any time|if|when))?(?:[?!.]|$))\b/.test(m)) return answer('contract_answer', 'question_contract');
  if (/\b(?:checks?|cheques?|pay(?:ment)?|billing|invoice|card on file|when (?:do|will) you charge|how (?:do|can) (?:you|i) (?:charge|pay))\b/.test(m) && !/\b(?:check with|check (?:the|my|our|your) (?:yard|area|gate|route)|spot check)\b/.test(m)) {
    if (/\b(?:checks?|cheques?|payment method|accept|cash)\b/.test(m)) return answer('payment', 'question_payment');
    return answer('billing', 'question_payment');
  }
  if (holiday) return answer('holiday');
  if (/\b(?:dogg(?:y|ie) door|dogs? (?:be |stay |are |will be |remain |need to be )?(?:outside|loose|out|in(?:side| the yard))|not great with strangers|uncomfortable with strangers|pets? safe|dogs? secured)\b/.test(m)) return answer('pets', 'question_pets_safety');
  if (/\b(?:what time|time (?:of day|window)|morning (?:visit|window)|afternoon window|specific time|time (?:do|would|will)|on[- ]the[- ]way text)\b/.test(m)) return answer('time_of_day', 'question_service_day');
  if (/\b(?:need|have|supposed) to be home|nobody (?:will be|is) home|won't be home\b/.test(m)) return answer('home', 'question_gate_access');
  if (/\b(?:rain(?:ing)?|snow(?:ing|storm)?|weather|ice|icy|below zero|flood(?:ing)?)\b/.test(m)) return answer(treatment.test(m) ? 'treatments_weather' : /\bsnow\b/.test(m) && !/\brain\b/.test(m) ? 'winter_weather' : 'rain_snow');
  if (treatment.test(m)) return answer('treatments');
  if (/\b(?:haul[- ]?(?:away|off)|take (?:it|the (?:waste|bags?)) with you|double[- ]?bag|bag(?:ged)? (?:it|up)|dump(?:ed)? (?:it|loose)|what (?:do you|happens to) (?:do with )?the (?:bags|waste))\b/.test(m)) return answer(/\b(?:one[- ]time|just once|once only)\b/.test(m) ? 'disposal_once' : 'disposal_rates', 'question_haul_away');
  if (/\bfront yard\b/.test(m) && /\b(?:patio|driveway|sidewalk|what(?:'s| is) included)\b/.test(m)) return answer('included_front', 'question_what_included');
  if (/\bfront yard\b/.test(m) && /\b(?:scoop|add|include|cost|charge|do you|can you)\b/.test(m)) return answer('front_yard');
  if (/\b(?:included|include|what (?:do you (?:do|actually do)|does (?:it|the service) include)|how (?:does|do) (?:it|you|the service) work|patio|driveway|sidewalk|hard surface)\b/.test(m)) return answer('included', 'question_what_included');
  if (/\b(?:lift (?:it|the latch)|latch (?:that )?(?:sticks|is sticky)|(?:gate|lock|access) code (?:is|will be|to follow)|code is|can is inside|can (?:is |sits )?(?:behind|by|near|inside) (?:the )?(?:shed|gate)|lockbox|alley access)\b/.test(m)) return answer('access_note', 'question_gate_access');
  if (/\b(?:gate access|how (?:do|will) you get (?:in|through)|do you need (?:the|my|a) (?:gate code|key))\b/.test(m)) return answer('access', 'question_gate_access');
  if (/\b(?:proof|gate photo|photo (?:after|of (?:the )?(?:gate|completed|cleanup))|(?:get|send) (?:me |us )?(?:a )?(?:photo|picture))\b/.test(m) && !context.hasPhoto) return answer('proof');
  if (bracketPhoto.test(m) || context.hasPhoto && !plan.test(m) && !/\b\d+ dogs?\b/.test(m)) return answer('photo');
  if (emoji.test(m) && !(context.expected && thumbs.test(m)) && !(quoted && thumbs.test(m))) return answer('emoji_greeting');
  if (thumbs.test(m) && quoted) return {topic: 'accept_quote', intent: 'ready_to_sign_up'};
  if (/\b(?:do it myself|do it ourselves|do my own|clean it (?:up )?myself)\b/.test(m)) return answer('do_it_myself');
  if (/\b(?:what (?:is|does) the (?:first|initial) (?:visit|cleanup)|(?:first|initial) (?:visit|cleanup) (?:different|extra|include)|why (?:is|do).{0,15}initial)\b/.test(m)) return answer('first_visit');
  if (/\b(?:switch|change) (?:my |the )?(?:frequency|plan) later|what(?:'s| is) biweekly|what frequencies|how often (?:can|do) you (?:come|visit)|frequency options/.test(m)) return answer('frequency_policy');
  const dogComparison = m.match(/\b([1-7]|one|two|three|four|five|six|seven)(?:\s+dogs?)?\s+(?:vs\.?|versus|compared (?:to|with)|or|and)\s+([1-7]|one|two|three|four|five|six|seven)\s+dogs?\b/);
  if (dogComparison && /\b(?:compar\w*|price|cost|quote|what|how much|difference|versus|vs)\b/.test(m)) {
    const number = s => ({one:1,two:2,three:3,four:4,five:5,six:6,seven:7})[s] || Number(s);
    return {...answer('dog_comparison','question_price'), counts:[number(dogComparison[1]),number(dogComparison[2])]};
  }
  const comparingPlans = /\b(?:weekly.{0,18}(?:bi[- ]?weekly|every other week|monthly)|bi[- ]?weekly.{0,18}(?:weekly|monthly)|twice (?:a week|weekly).{0,15}(?:weekly|biweekly)|monthly.{0,18}(?:weekly|biweekly))\b/.test(m) && /\b(?:compar\w*|or|versus|vs|and|difference)\b/.test(m);
  if (comparingPlans) return answer('frequency_options');
  if (/\b(?:what(?:'s| is| would)|how much|what (?:does|about)|compare|difference|instead|could we|can i)\b/.test(m) && plan.test(m) && !/\b(?:one[- ]time|last cleaned|since|buildup|first visit|initial cleanup)\b/.test(m) && quoted) return answer('frequency_options');
  if (/^who (?:is this|are you)[?!. ]*$/.test(m)) return answer('who');
  return null;
}

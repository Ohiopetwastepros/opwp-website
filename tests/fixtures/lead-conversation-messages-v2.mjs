// Fabricated, independently labeled SMS examples. They contain no customer data.
// Model accuracy is measured by the separate real-provider evaluation, not by
// mocked unit tests of this contract.
const e=(text,intents,extra={})=>({text,expected:{intents,confirms_details:'no',needs_owner:false,...extra}});
export const CLASSIFIER_FIXTURE_CONTEXT=Object.freeze({stage:'confirm_details_sent',details:{dogs:2,frequency:'once_a_week',zip:'43551',name:'Example Lead'}});
export const LEAD_CONVERSATION_FIXTURE=Object.freeze([
  e('yes thats right just looking for a quote thx',['confirm_yes','question_price'],{confirms_details:'yes'}),
  e("Yes that's right, how much?",['confirm_yes','question_price'],{confirms_details:'yes'}),
  e('yep',['confirm_yes'],{confirms_details:'yes'}),
  e('correct',['confirm_yes'],{confirms_details:'yes'}),
  e('yea that is right thank u',['confirm_yes'],{confirms_details:'yes'}),
  e('Yep! 2 dogs, weekly, that zip is right. What is the cost?',['confirm_yes','question_price'],{confirms_details:'yes',extracted:{dogs:2,frequency:'once_a_week'}}),
  e('You got it. How do we get signed up?',['confirm_yes','ready_to_sign_up'],{confirms_details:'yes'}),
  e('👍',['confirm_yes'],{confirms_details:'yes'}),
  e('Yes all that is correct. Can we pay by check?',['confirm_yes','question_payment'],{confirms_details:'yes'}),
  e('Yes, correct. Do you also service Elmore?',['confirm_yes','question_service_area'],{confirms_details:'yes',extracted:{city:'Elmore'},corrections:{}}),
  e("Actually it's 3 dogs",['correction'],{confirms_details:'partial',extracted:{dogs:3},corrections:{dogs:3}}),
  e('No, we have 4 dogs instead',['correction'],{confirms_details:'partial',extracted:{dogs:4},corrections:{dogs:4}}),
  e('Everything else is right but we need every other week',['confirm_yes','correction'],{confirms_details:'partial',corrections:{frequency:'every_other_week'}}),
  e('Actually our ZIP is 43528',['correction'],{confirms_details:'partial',corrections:{zip:'43528'}}),
  e('My name is Jamie, not James',['correction'],{confirms_details:'partial',corrections:{name:'Jamie'}}),
  e('I meant twice a week, sorry',['correction'],{confirms_details:'partial',corrections:{frequency:'twice_a_week'}}),
  e('There are 0 dogs now. We moved.',['correction'],{confirms_details:'partial',corrections:{dogs:0}}),
  e("Yep but it's 3 dogs. What is the weekly price?",['confirm_yes','correction','question_price'],{confirms_details:'partial',corrections:{dogs:3}}),
  e('how much for 2 dogs every week',['question_price'],{extracted:{dogs:2,frequency:'once_a_week'}}),
  e('$$?',['question_price']),
  e('Can I get a quote please',['question_price']),
  e('whats ur rate for one dog biweekly',['question_price'],{extracted:{dogs:1,frequency:'every_other_week'}}),
  e('How much is weekly for three dogs?',['question_price'],{extracted:{dogs:3,frequency:'once_a_week'}}),
  e('looking for pricing, 2 doggos once a week',['question_price'],{extracted:{dogs:2,frequency:'once_a_week'}}),
  e('What is the one time cleanup price for 2 dogs',['question_price'],{extracted:{dogs:2,frequency:'one_time'}}),
  e('I just want your rates',['question_price']),
  e('What do you charge each month?',['question_price']),
  e('How much and do you take checks?',['question_price','question_payment']),
  e('do u guys do elmore',['question_service_area'],{extracted:{city:'Elmore'},corrections:{}}),
  e('Do you service Genoa?',['question_service_area'],{extracted:{city:'Genoa'},corrections:{}}),
  e('Are you in Tontogany?',['question_service_area'],{extracted:{city:'Tontogany'},corrections:{}}),
  e('do you come out to Perrysburg',['question_service_area'],{extracted:{city:'Perrysburg'},corrections:{}}),
  e('Can you do ZIP 43551?',['question_service_area'],{extracted:{zip:'43551'},corrections:{}}),
  e('What about Bowling Green? Is that in your area?',['question_service_area'],{extracted:{city:'Bowling Green'}}),
  e('Do you service Elmore and what are the weekly prices for 2 dogs?',['question_service_area','question_price'],{extracted:{city:'Elmore',dogs:2,frequency:'once_a_week'},corrections:{}}),
  e('can u come mornings',['question_service_day']),
  e('I work nights, can you come in the afternoon?',['question_service_day']),
  e('What time will you be there?',['question_service_day']),
  e('Are visits always on the same day?',['question_service_day']),
  e('Can you promise 8am? And can I pay by check?',['question_service_day','question_payment']),
  e('thats kinda high',['objection_price'],{needs_owner:true,owner_reason:'price_pushback'}),
  e('That is too expensive, can you do better?',['objection_price'],{needs_owner:true,owner_reason:'price_pushback'}),
  e('Any discounts?',['objection_price'],{needs_owner:true,owner_reason:'price_pushback'}),
  e('Could you knock ten bucks off?',['objection_price'],{needs_owner:true,owner_reason:'price_pushback'}),
  e('I cannot afford that price. Do you still take checks?',['objection_price','question_payment'],{needs_owner:true,owner_reason:'price_pushback'}),
  e('Cheaper please. Also is Elmore in your area?',['objection_price','question_service_area'],{needs_owner:true,owner_reason:'price_pushback',extracted:{city:'Elmore'}}),
  e('can i pay cash or check',['request_cash','question_payment'],{needs_owner:true,owner_reason:'cash'}),
  e('Can I leave cash under the mat?',['request_cash'],{needs_owner:true,owner_reason:'cash'}),
  e('Do you take checks?',['question_payment']),
  e('Can I use my credit card?',['question_payment']),
  e('How does billing work?',['question_payment']),
  e('Is a check okay and where do I sign up?',['question_payment','ready_to_sign_up']),
  e('Cash is easiest for me, what are your rates for two dogs weekly?',['request_cash','question_price'],{needs_owner:true,owner_reason:'cash',extracted:{dogs:2,frequency:'once_a_week'}}),
  e('ok sign me up',['ready_to_sign_up']),
  e('Send me the signup link please',['ready_to_sign_up']),
  e('How do I start?',['ready_to_sign_up']),
  e('Ready to get started with weekly service',['ready_to_sign_up'],{extracted:{frequency:'once_a_week'}}),
  e('Can I get signed up and do you service Elmore?',['ready_to_sign_up','question_service_area'],{extracted:{city:'Elmore'}}),
  e('who is this',['is_this_ai']),
  e('Are you a bot?',['is_this_ai']),
  e('Can Craig text me himself?',['is_this_ai'],{needs_owner:true,owner_reason:'requested_owner'}),
  e('not interested',['not_interested']),
  e('No thanks, I do not need service',['not_interested']),
  e('stop pls',['stop']),
  e('STOP',['stop']),
  e('unsubscribe',['stop']),
  e('Please remove me. How much is weekly?',['stop']),
  e("Don't text me anymore",['stop']),
  e('Wrong number, sorry',['wrong_number']),
  e('Hola, cuanto cuesta para dos perros?',['spanish'],{needs_owner:true,owner_reason:'spanish'}),
  e('Podemos hablar en espanol?',['spanish'],{needs_owner:true,owner_reason:'spanish'}),
  e('You missed my cleanup again! This is ridiculous!',['complaint'],{needs_owner:true,owner_reason:'complaint'}),
  e('I want a refund. Nobody showed up.',['complaint'],{needs_owner:true,owner_reason:'complaint'}),
  e('I am furious with your service. Do you take checks?',['complaint','question_payment'],{needs_owner:true,owner_reason:'complaint'}),
  e('Can you repair my fence too?',['off_playbook'],{needs_owner:true,owner_reason:'off_playbook'}),
  e('What is the capital of France?',['off_playbook'],{needs_owner:true,owner_reason:'off_playbook'}),
  e('Do you have a referral program?',['question_referral']),
  e('Can I bundle this with yard mowing?',['question_bundles']),
  e('What is included in your service?',['question_what_included']),
  e('Do I have to sign a contract?',['question_contract']),
  e('Do you take the waste away?',['question_haul_away']),
  e('Can my dogs stay outside?',['question_pets_safety']),
  e('Do I have to leave the gate unlocked?',['question_gate_access']),
  e('Let me ask my wife and think about it',['objection_thinking']),
  e('I am comparing two companies right now',['objection_competitor']),
  e('Can you clean our school campus?',['off_playbook'],{needs_owner:true,owner_reason:'off_playbook'}),
  e('lol ok',['unclear']),
  e('asdfgh',['unclear']),
  e('???',['unclear']),
  e('the thing',['unclear']),
  e('blue fridge',['unclear']),
  e('kjsd 8w??',['unclear']),
  e('🤷',['unclear']),
  e('🙃🌀',['unclear']),
  e('uhhh',['unclear']),
  e('...',['unclear']),
  e('pick up milk on the way home',['unclear']),
  e('did you get the game controller',['unclear']),
  e('that one from before',['unclear']),
  e('zzzz ## 88 qqq',['unclear']),
].map((row,index)=>Object.freeze({id:`sms-${String(index+1).padStart(3,'0')}`,...row})));

export function compareClassifierFixture(row,result){
  const errors=[],expected=row.expected;
  if(JSON.stringify([...(result.intents||[])].sort())!==JSON.stringify([...expected.intents].sort()))errors.push('intents');
  if(result.confirms_details!==expected.confirms_details)errors.push('confirms_details');
  // Opt-outs are safety prefilters; owner handling is deliberately not modeled.
  if(!expected.intents.some(intent=>['stop','wrong_number'].includes(intent))&&result.needs_owner!==expected.needs_owner)errors.push('needs_owner');
  if(expected.owner_reason&&result.owner_reason!==expected.owner_reason)errors.push('owner_reason');
  for(const field of ['extracted','corrections'])for(const [key,value]of Object.entries(expected[field]||{}))if(result[field]?.[key]!==value)errors.push(`${field}.${key}`);
  if(expected.corrections&&Object.keys(expected.corrections).length===0&&Object.keys(result.corrections||{}).length)errors.push('inquiry_changed_property');
  return errors;
}

// Independent review by root and the reply-policy reviewer found these labels
// non-exhaustive. Original labels and the exact metric above stay unchanged.
// The semantic contract accepts logically entailed extra labels and corrects
// the independently identified mowing-service scope expectation.
export const CLASSIFIER_FIXTURE_SEMANTIC_REVIEWS=Object.freeze({
  'sms-013':{optionalIntents:['confirm_yes'],rationale:'partial plus explicit correction preserves the essential partial-affirmation meaning; retain exact omission metric'},
  'sms-048':{allowedExtraIntents:['question_payment'],rationale:'a cash arrangement is logically also a payment question'},
  'sms-070':{allowedExtraIntents:['question_price'],rationale:'the Spanish sentence explicitly asks the price; multi-intent classification is correct'},
  'sms-078':{requiredIntents:['question_bundles','off_playbook'],needs_owner:true,owner_reason:'off_playbook',rationale:'yard mowing is outside the approved pet-waste service; answer no bundles and have Craig review the unsupported service request'},
});
export function compareSemanticClassifierFixture(row,result){
  const review=CLASSIFIER_FIXTURE_SEMANTIC_REVIEWS[row.id]||{};
  const required=(review.requiredIntents||row.expected.intents).filter(intent=>!(review.optionalIntents||[]).includes(intent));
  const allowed=[...required,...(review.optionalIntents||[]),...(review.allowedExtraIntents||[])];
  const errors=compareClassifierFixture(row,result).filter(error=>!['intents','needs_owner','owner_reason'].includes(error));
  if(required.some(intent=>!result.intents?.includes(intent))||(result.intents||[]).some(intent=>!allowed.includes(intent)))errors.push('intents');
  if(!row.expected.intents.some(intent=>['stop','wrong_number'].includes(intent))&&result.needs_owner!==(review.needs_owner??row.expected.needs_owner))errors.push('needs_owner');
  const ownerReason=review.owner_reason||row.expected.owner_reason;
  if(ownerReason&&result.owner_reason!==ownerReason)errors.push('owner_reason');
  return errors;
}

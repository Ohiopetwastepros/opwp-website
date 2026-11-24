import test from 'node:test';
import assert from 'node:assert/strict';
import {nextMetaResponse} from '../lib/meta-conversation.mjs';

const lead={name:'Example Lead',number_of_dogs:2,zip:'43615',clean_up_frequency:'Weekly'};
const yardState={details:{...lead},details_confirmed:true,expected:'yard'};

test('legacy Craig yard prompts accept the same bounded natural measurements',()=>{
  for(const [text,tier] of [
    ["It's just a standard sized yard. Id say about 1/8th acre",'tiny'],
    ['standard sized yard','tiny'],['about 5,000 square feet','tiny'],
    ['30 ft by 30 ft','tiny'],['a quarter acre','small'],
  ]){
    const reply=nextMetaResponse({lead,state:yardState,text,confirmationSent:true});
    assert.equal(reply.state.details.yard_size_tier,tier,text);
    assert.equal(reply.state.expected,'cleaned',text);
    assert.equal(reply.handoff,false,text);
    assert.doesNotMatch(reply.response,/review|\$|Reply STOP/i);
  }
});

test('legacy uncertain yard replies request an address then hold measurement passively',()=>{
  const unsure=nextMetaResponse({lead,state:yardState,text:"I'm not sure",confirmationSent:true});
  assert.equal(unsure.handoff,false);assert.equal(unsure.state.expected,'yard_map_address');
  assert.match(unsure.response,/street address/);
  const address=nextMetaResponse({lead,state:unsure.state,text:'123 Example Street, Toledo',confirmationSent:true});
  assert.equal(address.handoff,false);assert.equal(address.state.expected,'yard_measurement');
  assert.equal(address.state.map_measurement_pending,true);
  assert.equal(address.state.ready_for_route_audit,false);
  assert.equal(address.state.details.yard_size_tier,undefined);
  assert.doesNotMatch(address.response,/\$|Tuesday|confirmed/);
  const waiting=nextMetaResponse({lead,state:address.state,text:'Thanks',confirmationSent:true});
  assert.equal(waiting.response,'');assert.equal(waiting.handoff,false);
});

test('legacy ambiguous yard scopes clarify once then request a map address without a staff handoff',()=>{
  const first=nextMetaResponse({lead,state:yardState,text:'They use the whole lot',confirmationSent:true});
  assert.equal(first.handoff,false);assert.match(first.response,/backyard or use the whole lot/);
  const second=nextMetaResponse({lead,state:first.state,text:'Front and back',confirmationSent:true});
  assert.equal(second.handoff,false);assert.equal(second.state.expected,'yard_map_address');
  assert.equal(second.state.details.yard_size_tier,undefined);
});

test('legacy cleanup ranges use the shared conservative tier and unknown seasons clarify once then hold',()=>{
  const state={details:{...lead,yard_size_tier:'tiny'},details_confirmed:true,expected:'cleaned'};
  const range=nextMetaResponse({lead,state,text:'2-3 weeks',confirmationSent:true});
  assert.equal(range.handoff,false);assert.equal(range.state.details.last_cleaned,'three_weeks');
  assert.equal(range.state.expected,'quote_acceptance');
  assert.equal(range.state.quote.basis.source,'app/free-quote/pricing.js');
  for(const text of ['since winter','not sure','we only spot-cleaned']){
    const first=nextMetaResponse({lead,state,text,confirmationSent:true});
    assert.equal(first.handoff,false,text);assert.equal(first.state.expected,'cleaned');
    assert.match(first.response,/weeks or months/);assert.doesNotMatch(first.response,/\$/);
    const second=nextMetaResponse({lead,state:first.state,text,confirmationSent:true});
    assert.equal(second.handoff,false);assert.equal(second.state.detail_hold_pending,'cleaned');
    assert.equal(nextMetaResponse({lead,state:second.state,text,confirmationSent:true}).response,'');
  }
});

test('legacy natural detail translation retains explicit dog, frequency and ZIP corrections',()=>{
  for(const [expected,text,key,value] of [
    ['dogs','2 small and 1 large','number_of_dogs',3],
    ['frequency','eow','clean_up_frequency','Biweekly'],
    ['zip','actually 43551','zip','43551'],
  ]){
    const reply=nextMetaResponse({lead,state:{details:{...lead},details_confirmed:true,expected},text,confirmationSent:true});
    assert.equal(reply.state.details[key],value);assert.equal(reply.handoff,false);
    assert.equal(reply.state.expected,'confirm');assert.equal(reply.state.details_confirmed,false);
  }
});

test('legacy natural parsing cannot bypass terminal, human, custom-price or service-day guards',()=>{
  for(const text of ['STOP','wrong number','email me instead']){
    const reply=nextMetaResponse({lead,state:yardState,text,confirmationSent:true});
    assert.equal(reply.response,'');assert.equal(reply.handoff,true);
  }
  const human=nextMetaResponse({lead,state:yardState,text:'Are you a real person?',confirmationSent:true});
  assert.equal(human.state.expected,'human_offer');assert.match(human.response,/approved replies/);
  const large=nextMetaResponse({lead,state:yardState,text:'one acre',confirmationSent:true});
  assert.equal(large.handoff,true);assert.doesNotMatch(large.response,/\$/);
  const paused=nextMetaResponse({lead,state:{...yardState,handoff:true},text:'1/8th acre',confirmationSent:true});
  assert.equal(paused.response,'');assert.equal(paused.handoff,true);
});

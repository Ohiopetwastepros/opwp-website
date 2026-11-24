import test from 'node:test';
import assert from 'node:assert/strict';
import {initialLeadInboxSelection} from '../lib/lead-inbox-link.mjs';
import {inboxState} from '../lib/lead-inbox.mjs';

const leads=[{id:'attention-lead',name:'Fictional One',workspace:{},conversation:{unreadCount:1,lastInboundAt:'2026-11-23T17:00:00Z'}},{id:'waiting-lead',name:'Fictional Two',workspace:{},conversation:{status:'waiting',lastOutboundAt:'2026-11-23T17:01:00Z'}}];
test('a staff link selects only an exact authorized loaded lead and its inbox view',()=>{
  const result=initialLeadInboxSelection(leads,'waiting-lead');
  assert.equal(result.id,'waiting-lead');assert.equal(result.view,inboxState(leads[1]).view);
});
test('unloaded, malformed or URL-like lead references do not select arbitrary records',()=>{
  for(const value of ['not-loaded','https://example.test/lead','../waiting-lead',['waiting-lead'],'x'.repeat(161),null]){
    const result=initialLeadInboxSelection(leads,value);
    assert.notEqual(result.id,value);assert.equal(result.view,'attention');
  }
  assert.deepEqual(initialLeadInboxSelection([],'waiting-lead'),{id:'',view:'attention'});
});

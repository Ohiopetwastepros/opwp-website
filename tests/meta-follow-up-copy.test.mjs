import assert from "node:assert/strict";
import test from "node:test";
import { META_RESPONSES, metaFollowUpDrafts, metaWebsiteQuote, nextMetaResponse } from "../lib/meta-conversation.mjs";
import {countCraigSentences,validateCraigReply} from '../lib/craig-voice.mjs';

const messages = [
  "Just checking back in to see if you had any questions about getting started?",
  "Were you still interested in having us take care of the yard? No pressure either way, just let me know!",
  "I'll leave it with you for now. We're here if you need us, just reply anytime.",
];

function checkDrafts(name, safeName) {
  const drafts = metaFollowUpDrafts(name);
  assert.deepEqual(drafts.map(({ step, day }) => ({ step, day })), [
    { step: 1, day: 1 }, { step: 2, day: 3 }, { step: 3, day: 7 },
  ]);
  const hey=`Hey${safeName?` ${safeName}`:''}`;
  assert.deepEqual(drafts.map(({ body }) => body),[
    `${hey}, this is Craig with Ohio Pet Waste Pros. ${messages[0]}`,
    `${hey}, Craig with Ohio Pet Waste Pros here. ${messages[1]}`,
    messages[2],
  ]);
  for (const { body } of drafts) {
    assert.match(body, /^[\x00-\x7f]+$/);
    assert.doesNotMatch(body, /[\u2013\u2014]/);
    assert.equal(body, body.trim());
    assert.doesNotMatch(body, /Reply STOP to opt out/);
    assert.equal(body.split("\n").length, 1);
    assert.ok(body.length < 230);
    assert.ok(countCraigSentences(body)<=3);
    assert.deepEqual(validateCraigReply(body,{step:'follow_up'}),[]);
  }
}

test("Meta follow-ups use Jason's first name and Craig's exact copy", () => {
  checkDrafts("Jason Example", "Jason");
});

for (const name of [undefined, "", null, "123", "Jason! Example", "<script> Example", "A".repeat(41), "---"]) {
  test(`Meta follow-ups omit unusable name ${JSON.stringify(name)}`, () => {
    checkDrafts(name, "");
  });
}

test("Meta follow-ups keep the safe-name check and ASCII apostrophes", () => {
  checkDrafts("O\u2019Neil Example", "O'Neil");
});

test('legacy Meta prompts and quote copy follow the same short Craig voice rules',()=>{
  for(const body of Object.values(META_RESPONSES)) {
    assert.deepEqual(validateCraigReply(body,{step:'booking'}),[],body);
    assert.doesNotMatch(body,/\bCraig\b/,'Customer replies speak as Craig rather than about him');
  }
  for(const clean_up_frequency of ['Weekly','One Time']){
    const quote=metaWebsiteQuote({number_of_dogs:2,zip:'43615',clean_up_frequency,yard_size_tier:'tiny',last_cleaned:'one_month'});
    assert.equal(countCraigSentences(quote.text),3);
    assert.deepEqual(validateCraigReply(quote.text,{step:'quote'}),[]);
    assert.equal(quote.basis.source,'app/free-quote/pricing.js');
    assert.doesNotMatch(quote.text,/\bCraig\b/);
  }
});

test('render validation blocks prohibited raw reply text before it can become Meta customer copy',()=>{
  const lead={number_of_dogs:2,zip:'43615',clean_up_frequency:'Weekly'};
  assert.throws(()=>nextMetaResponse({lead,text:'What is included?',staticAnswer:'We handle poop for you.'}),/forbidden_waste_slang/);
  assert.throws(()=>nextMetaResponse({lead,text:'What is included?',staticAnswer:'First. Second. Third. Fourth.'}),/sentence_count/);
});

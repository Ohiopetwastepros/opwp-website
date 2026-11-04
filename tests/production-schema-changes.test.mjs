import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
test('new production DDL is bound to a unique reviewed source checksum without rewriting historical templates',()=>{
  const index=JSON.parse(fs.readFileSync(new URL('../data/production-schema-changes.json',import.meta.url),'utf8'));
  assert.equal(index.schemaVersion,1);const seen=new Set();
  for(const row of index.files){
    assert.match(row.path,/^migrations\/\d{4}_[a-z0-9_]+\.sql$/);assert.equal(seen.has(row.path),false);seen.add(row.path);
    const source=fs.readFileSync(new URL('../'+row.reviewedSource,import.meta.url));
    assert.equal(createHash('sha256').update(source).digest('hex'),row.sha256);
    assert.equal(source.includes('PROPOSAL ONLY'),true);
  }
  const historical=JSON.parse(fs.readFileSync(new URL('./fixtures/migration-review.json',import.meta.url),'utf8'));
  assert.equal(historical.templates.length,60);
});

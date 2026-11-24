import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';

const root=new URL('../',import.meta.url);
const read=file=>fs.readFileSync(new URL(file,root),'utf8');
const index=JSON.parse(read('tests/fixtures/migration-template-index.json'));
const review=JSON.parse(read('tests/fixtures/migration-review.json'));

test('every public migration template has a complete matching data privacy review',()=>{
  assert.equal(review.templates.length,60);
  assert.deepEqual(review.templates.map(row=>row.file).sort(),index.files.map(file=>file+'.template').sort());
  let statements=0;
  for(const row of review.templates){
    const bytes=fs.readFileSync(new URL('tests/fixtures/migration-templates/'+row.file,root));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),row.sha256,'Review required for '+row.file);
    assert.ok(row.statements.length>0);
    row.statements.forEach((statement,index)=>{
      assert.equal(statement.ordinal,index+1);
      assert.ok(statement.classification && statement.quoted_literals_reviewed>=0);
    });
    statements+=row.statements.length;
  }
  assert.equal(statements,497);
});

test('provider associations, historical customer identities and financial seeds use private bindings',()=>{
  const staff=read('tests/fixtures/migration-templates/0030_production_hardening.sql.template');
  const seed=staff.match(/INSERT OR IGNORE INTO staff_integration_mappings[\s\S]*?;/)?.[0];
  assert.ok(seed);
  assert.equal((seed.match(/__OPWP_PRIVATE_B\d+__/g)||[]).length,9);
  assert.doesNotMatch(seed,/'\d{4,}'/);
  const cleanup=read('tests/fixtures/migration-templates/0039_quo_intake_review.sql.template');
  assert.doesNotMatch(cleanup,/'[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}'/i);
  assert.doesNotMatch(cleanup,/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  assert.ok((cleanup.match(/__OPWP_PRIVATE_B\d+__/g)||[]).length>=15);
  const financial=read('tests/fixtures/migration-templates/0027_financial_management.sql.template');
  assert.match(financial,/__OPWP_FINANCIAL_verified_cash_balance__/);
  assert.doesNotMatch(financial,/(?:owner_monthly_pay|protected_cash_floor|tony_current_rate|bria_current_rate)[^\n]*DEFAULT\s+\d/);
});

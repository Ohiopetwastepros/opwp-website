import test from 'node:test';
import assert from 'node:assert/strict';
import {FOOD_WORKSPACES,foodWorkspaceForTab,foodWorkspaceHref} from '../app/admin/dog-food/workspace-navigation.mjs';

test('every existing food tab has one canonical workspace and a recoverable deep link',()=>{
  const expected=['queue','funnel','metrics','profit','overview','record','sales','sources','readiness','inventory','purchases','collections','customers','plans','website','review'];
  const actual=FOOD_WORKSPACES.flatMap(workspace=>workspace.tabs);
  assert.deepEqual([...actual].sort(),expected.sort());
  for(const tab of actual){
    assert.equal(actual.filter(value=>value===tab).length,1);
    const workspace=foodWorkspaceForTab(tab),url=new URL(foodWorkspaceHref(tab),'https://example.test');
    assert.equal(url.pathname,workspace.href);
    assert.equal(url.searchParams.get('tab')||workspace.tabs[0],tab);
  }
});

test('customer, sale-entry and profit pages have focused views and legacy destinations still resolve',()=>{
  assert.deepEqual(foodWorkspaceForTab('customers').tabs,['customers']);
  assert.deepEqual(foodWorkspaceForTab('record').tabs,['record']);
  assert.deepEqual(foodWorkspaceForTab('profit').tabs,['profit']);
  assert.equal(foodWorkspaceHref('customers'),'/admin/dog-food/customers/');
  assert.equal(foodWorkspaceHref('inventory'),'/admin/dog-food/inventory/?tab=inventory');
  assert.equal(foodWorkspaceHref('sources'),'/admin/dog-food/settings/?tab=sources');
});

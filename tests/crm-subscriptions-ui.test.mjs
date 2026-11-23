import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const { transformSync } = createRequire(import.meta.url)('esbuild');

const plan = { id: 'yard', label: 'Weekly yard service', rates: [{ frequency: 'once_a_week', dogCount: 2, zoneId: 'standard', baseCents: 10500, extraDogsCents: 0 }] };
const priceBook = { id: 'book', version: 1, effectiveDate: '2026-01-01', plans: [plan], zones: [{ id: 'standard', label: 'Standard zone', zips: ['43615'] }], yardTiers: [{ id: 'standard', label: 'Standard yard', upchargeCents: 0 }], addons: [] };
const line = { id: 'base', label: 'Weekly 2 dogs', kind: 'base_plan', quantity: 1, unitCents: 10500, totalCents: 10500, itemized: true };
const active = { id: 'active-sub', customerId: 'customer', revision: 2, status: 'active', planId: 'Active yard service', frequency: 'once_a_week', dogCount: 2, zip: '43615', yardTierId: 'standard', startDate: '2026-02-01', billingPeriodStart: '2026-11-01', billingPeriodEnd: '2026-12-01', currentLines: [line], totalCents: 10500, rateSource: 'preset', bookRateCents: 10500, currentBookRateCents: 11000, versions: [], scheduledChanges: [], pauses: [], skips: [], credits: [], audit: [] };
const past = { ...active, id: 'past-sub', status: 'cancelled', planId: 'Past yard service', endDate: '2026-05-01', terminationReason: 'moved', terminationNote: 'Moved outside service area', totalCents: 9900, currentLines: [{ ...line, unitCents: 9900, totalCents: 9900 }] };
function data(view = 'active') { return { ok: true, enabled: true, customers: [{ id: 'customer', name: 'Sample Customer' }], subscriptions: view === 'past' ? [past] : view === 'all' ? [active, past] : [active], priceBook, report: { activeMrrCents: 10500, byPlan: [], byAddon: [], manualOverrides: [], belowBook: [], cancellationsByReason: [], noticeReminders: [] } }; }

// Execute the actual JSX component, event handlers and effects. Hook state is
// retained between renders; fetch is the only replaced application boundary.
function harness({ post, query = '' } = {}) {
  const frames = new Map(), modules = new Map(), effects = [], calls = [];
  let current;
  function frame(key, render) { const prior = current; current = { key, index: 0 }; if (!frames.has(key)) frames.set(key, []); try { return render(); } finally { current = prior; } }
  const hooks = {
    useState(initial) { const values = frames.get(current.key), index = current.index++; if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial; return [values[index], value => { values[index] = typeof value === 'function' ? value(values[index]) : value; }]; },
    useRef(initial) { const values = frames.get(current.key), index = current.index++; if (!(index in values)) values[index] = { current: initial }; return values[index]; },
    useEffect(effect, deps) { const values = frames.get(current.key), index = current.index++, prior = values[index]; if (!prior || deps.some((value, i) => value !== prior[i])) { values[index] = deps; effects.push(effect); } },
  };
  const jsx = (type, props, key) => ({ type, props: props || {}, key });
  function evaluate(file) {
    if (modules.has(file)) return modules.get(file);
    const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    const { code } = transformSync(source, { loader: 'jsx', format: 'cjs', jsx: 'automatic', target: 'es2022' });
    const module = { exports: {} };
    const context = {
      module, exports: module.exports, console, window: query ? { location: { search: query } } : undefined, URL, URLSearchParams, Intl, Date, Map, Set, structuredClone, crypto,
      FormData: class { constructor(form) { this.values = form.values || {}; } get(key) { return this.values[key] ?? null; } },
      fetch: async (url, options = {}) => {
        const body = options.body ? JSON.parse(options.body) : null; calls.push({ url, body });
        const result = body ? await post?.(body) || { ok: true } : data(new URL(url, 'https://example.test').searchParams.get('view'));
        return { ok: true, status: 200, json: async () => result };
      },
      require(name) {
        if (name === 'react') return hooks;
        if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' };
        if (name === '@/lib/field-policy.mjs') return { operatingDate: () => '2026-11-21' };
        if (name === '@/components/crm/SubscriptionHistory') return evaluate('components/crm/SubscriptionHistory.js');
        if (name.endsWith('.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) };
        throw new Error(`Unexpected UI dependency: ${name}`);
      },
    };
    vm.runInNewContext(code, context, { filename: file }); modules.set(file, module.exports); return module.exports;
  }
  const Workspace = evaluate('app/admin/crm/subscriptions/SubscriptionWorkspace.js').default;
  function resolve(node, path = 'tree') {
    if (Array.isArray(node)) return node.map((item, index) => resolve(item, `${path}:${index}`));
    if (node == null || typeof node !== 'object') return node;
    if (typeof node.type === 'function') return frame(`${path}:${node.type.name}:${node.key || ''}`, () => resolve(node.type(node.props), `${path}:component`));
    return { ...node, props: { ...node.props, children: resolve(node.props.children, `${path}:children`) } };
  }
  const api = {
    calls,
    render() { api.tree = frame('root', () => resolve(Workspace({ initialData: data(), initialCustomerId: 'customer' }))); return api.tree; },
    async flush() { for (let i = 0; i < 4; i++) { api.render(); while (effects.length) effects.shift()(); await new Promise(resolve => setTimeout(resolve, 0)); } return api.tree; },
    history(subscriptions) { return resolve(evaluate('components/crm/SubscriptionHistory.js').default({ subscriptions })); },
  };
  return api;
}
function nodes(tree, match) { const result = []; function walk(node) { if (Array.isArray(node)) return node.forEach(walk); if (!node || typeof node !== 'object') return; if (match(node)) result.push(node); walk(node.props.children); } walk(tree); return result; }
function text(node) { if (Array.isArray(node)) return node.map(text).join(' '); if (node == null || typeof node === 'boolean') return ''; if (typeof node !== 'object') return String(node); return text(node.props.children); }
function button(tree, name) { const match = nodes(tree, node => node.type === 'button' && text(node) === name)[0]; assert.ok(match, `Missing button ${name}`); return match; }
const event = values => ({ preventDefault() {}, currentTarget: { values, reset() {} } });

test('actual customer-record controls default to Active and load/render Past and All on selection', async () => {
  const ui = harness(); await ui.flush();
  assert.equal(button(ui.tree, 'Active').props['aria-pressed'], true);
  assert.match(text(ui.tree), /Active Yard Service/); assert.doesNotMatch(text(ui.tree), /Past Yard Service/);
  button(ui.tree, 'Past').props.onClick(); await ui.flush();
  assert.equal(button(ui.tree, 'Past').props['aria-pressed'], true);
  assert.match(text(ui.tree), /Past Yard Service/); assert.doesNotMatch(text(ui.tree), /Active Yard Service/);
  assert.match(text(ui.tree), /Moved outside service area/); assert.match(text(ui.tree), /\$99\.00/);
  button(ui.tree, 'All').props.onClick(); await ui.flush();
  assert.equal(button(ui.tree, 'All').props['aria-pressed'], true);
  assert.match(text(ui.tree), /Active Yard Service/); assert.match(text(ui.tree), /Past Yard Service/);
  assert.ok(ui.calls.some(call => call.url.includes('view=past'))); assert.ok(ui.calls.some(call => call.url.includes('view=all')));
});

test('a lost apply response retries the reviewed preview with the same idempotency request ID', async () => {
  const applications = new Set(); let loseResponse = true;
  const ui = harness({ post(body) {
    if (body.action === 'preview') return { ok: true, preview: { token: 'reviewed-preview', operation: body.operation, subscription: active, proration: { periodStart: '2026-11-01', periodEnd: '2026-12-01', totalDays: 30, remainingDays: 10, affectedDays: 5, oldTotalCents: 10500, newTotalCents: 0, adjustmentCents: -1750 } } };
    if (body.action === 'apply') { applications.add(body.requestId); if (loseResponse) { loseResponse = false; throw new Error('Response lost'); } return { ok: true, applied: true }; }
  } });
  await ui.flush(); button(ui.tree, 'Pause').props.onClick(); ui.render();
  const editor = nodes(ui.tree, node => node.props['aria-label'] === 'Subscription change')[0];
  await nodes(editor, node => node.type === 'form')[0].props.onSubmit(event({ effectiveDate: '2026-11-21', resumeDate: '2026-11-26', reason: 'Customer vacation' }));
  await ui.flush(); assert.match(text(ui.tree), /5\s+of\s+30\s+days are affected/);
  await button(ui.tree, 'Apply reviewed change').props.onClick(); await ui.flush();
  assert.match(text(ui.tree), /Response lost/);
  await button(ui.tree, 'Apply reviewed change').props.onClick(); await ui.flush();
  const attempts = ui.calls.filter(call => call.body?.action === 'apply');
  assert.equal(attempts.length, 2); assert.equal(attempts[0].body.requestId, attempts[1].body.requestId); assert.equal(applications.size, 1);
});

test('customer creation preserves its request identity across a lost response', async () => {
  let loseResponse = true; const created = new Set();
  const ui = harness({ post(body) { if (body.action === 'save_customer') { created.add(body.requestId); if (loseResponse) { loseResponse = false; throw new Error('Response lost'); } return { ok: true, customer: { id: 'created-customer' } }; } } });
  await ui.flush();
  const formFor = () => { const details = nodes(ui.tree, node => node.type === 'details' && nodes(node, item => item.type === 'summary' && text(item) === 'Create a customer record').length)[0]; return nodes(details, node => node.type === 'form')[0]; };
  await formFor().props.onSubmit(event({ name: 'New Customer', reason: 'New agreement' })); await ui.flush();
  await formFor().props.onSubmit(event({ name: 'New Customer', reason: 'New agreement' })); await ui.flush();
  const attempts = ui.calls.filter(call => call.body?.action === 'save_customer');
  assert.equal(attempts.length, 2); assert.equal(attempts[0].body.requestId, attempts[1].body.requestId); assert.equal(created.size, 1);
});

test('shared customer history renders active and past records together with correct period boundaries', () => {
  const ui = harness(), tree = ui.history([{ ...active, lineItems: active.currentLines }, { ...past, lineItems: past.currentLines }]);
  assert.match(text(tree), /Active Yard Service/); assert.match(text(tree), /Past Yard Service/);
  assert.match(text(tree), /Nov 30, 2026/); assert.match(text(tree), /Dec 1, 2026/);
  assert.match(text(tree), /Moved outside service area/); assert.doesNotMatch(text(tree), /Current book|Manual rate|Audit trail/);
});

test('price book starts as a published read-only catalog and keeps the full editor collapsed', async () => {
  const ui = harness(); await ui.flush(); button(ui.tree, 'Price book').props.onClick(); await ui.flush();
  const rates = nodes(ui.tree, node => node.type === 'table' && node.props['aria-label'] === 'Published monthly service rates')[0];
  const yards = nodes(ui.tree, node => node.type === 'table' && node.props['aria-label'] === 'Published yard-size surcharges')[0];
  const addons = nodes(ui.tree, node => node.type === 'table' && node.props['aria-label'] === 'Published add-on rates')[0];
  assert.ok(rates); assert.ok(yards); assert.ok(addons);
  assert.match(text(rates), /Weekly Yard Service/); assert.match(text(rates), /2 dogs/); assert.match(text(rates), /\$105\.00/);
  assert.equal(nodes(rates, node => ['input', 'select', 'button'].includes(node.type)).length, 0);
  const editor = nodes(ui.tree, node => node.type === 'details' && nodes(node, child => child.type === 'summary' && text(child) === 'Edit price book').length)[0];
  assert.ok(editor); assert.notEqual(editor.props.open, true);
  assert.ok(nodes(editor, node => node.type === 'form' && typeof node.props.onSubmit === 'function').length);
  assert.ok(nodes(editor, node => node.type === 'button' && text(node) === 'Preview price-book update').length);
});

test('customer creation and lifecycle deep links open native review controls without applying changes',async()=>{
  const creation=harness({query:'?create=customer'});await creation.flush();
  assert.equal(nodes(creation.tree,node=>node.type==='details'&&node.props.id==='new-customer')[0].props.open,true);
  assert.equal(creation.calls.some(call=>call.body),false);
  for(const operation of ['pause','skip','amend','resume']){
    const ui=harness({query:'?customerId=customer&operation='+operation});await ui.flush();
    assert.ok(nodes(ui.tree,node=>node.props['aria-label']==='Subscription change').length,operation);
    assert.equal(ui.calls.some(call=>call.body),false,operation);
  }
});

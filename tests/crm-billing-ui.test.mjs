import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as invoiceView from '../components/crm/InvoiceView.mjs';
import { createRequire } from 'node:module';
const { transformSync } = createRequire(import.meta.url)('esbuild');

const invoice = (overrides = {}) => ({ id: 'invoice-one', customerId: 'customer-one', revision: 3, status: 'draft', held: false, invoiceType: 'monthly',
  periodStart: '2026-12-01', periodEnd: '2027-01-01', totalCents: 12000, bookRateCents: 12500, manualRateCents: 12000, belowBook: true, firstInvoice: true,
  lineItems: [{ id: 'base', label: 'Weekly two-dog service', kind: 'base_plan', totalCents: 10500 }, { id: 'yard', label: 'Large yard', kind: 'yard_size', totalCents: 1500 }],
  paymentMethodId: 'method-card', methodType: 'card', scheduledChargeAt: '2026-12-01T14:00:00Z', attempts: [], creditApplications: [], audit: [], ...overrides });
const method = { id: 'method-card', customerId: 'customer-one', methodType: 'card', last4: '1111', brand: 'Visa', expMonth: 12, expYear: 2029, isDefault: true };
function fixture(invoices = [invoice()]) { return { ok: true, enabled: true, invoices, methods: [method], customers: [{ id: 'customer-one', name: 'Sample Customer' }], settings: { revision: 1 }, syncIssues: [], summary: { draftCents: 12000 }, tokenizerConfigs: { card: { origin: 'https://fixture.example', environment: 'uat' } } }; }

// Execute the shipped JSX, hooks and event handlers with only fetch and the
// independently tested hosted tokenizer component replaced at the boundary.
function harness({ initial = fixture(), post, query = '' } = {}) {
  const frames = new Map(), effects = [], calls = [], hosted = [];
  let current;
  const state = structuredClone(initial);
  function frame(key, render) { const prior = current; current = { key, index: 0 }; if (!frames.has(key)) frames.set(key, []); try { return render(); } finally { current = prior; } }
  const hooks = {
    useState(initialValue) { const values = frames.get(current.key), index = current.index++; if (!(index in values)) values[index] = typeof initialValue === 'function' ? initialValue() : initialValue; return [values[index], value => { values[index] = typeof value === 'function' ? value(values[index]) : value; }]; },
    useRef(initialValue) { const values = frames.get(current.key), index = current.index++; if (!(index in values)) values[index] = { current: initialValue }; return values[index]; },
    useEffect(effect, deps) { const values = frames.get(current.key), index = current.index++, prior = values[index]; if (!prior || deps.some((value, i) => value !== prior[i])) { values[index] = deps; effects.push(effect); } },
  };
  const jsx = (type, props, key) => ({ type, props: props || {}, key });
  const module = { exports: {} };
  const source = fs.readFileSync(new URL('../app/admin/crm/billing/BillingWorkspace.js', import.meta.url), 'utf8');
  const { code } = transformSync(source, { loader: 'jsx', format: 'cjs', jsx: 'automatic', target: 'es2022' });
  vm.runInNewContext(code, {
    module, exports: module.exports, console, window: query ? { location: { search: query } } : undefined, URLSearchParams, Intl, Date, Map, Set, structuredClone, crypto,
    FormData: class { constructor(form) { this.values = form.values || {}; } get(key) { return this.values[key] ?? null; } },
    fetch: async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : null; calls.push({ url, body });
      let result;
      if (body) result = await post?.(body, state) || { ok: true };
      else {
        result = structuredClone(state); const filter = new URL(url, 'https://example.test').searchParams.get('filter');
        if (filter === 'held') result.invoices = result.invoices.filter(row => row.held);
        if (filter === 'ach') result.invoices = result.invoices.filter(row => row.methodType === 'ach');
      }
      return { ok: true, status: 200, json: async () => result };
    },
    require(name) {
      if (name === 'react') return hooks;
      if (name === '@/components/crm/InvoiceView.mjs') return invoiceView;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' };
      if (name === '@/lib/field-policy.mjs') return { operatingDate: () => '2026-11-21' };
      if (name === '@/components/crm/HostedPaymentMethod') return { __esModule: true, default: props => { hosted.push(props); return jsx('div', { children: 'Hosted secure method setup' }); } };
      if (name.endsWith('.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) };
      throw new Error(`Unexpected billing UI dependency: ${name}`);
    },
  }, { filename: 'BillingWorkspace.js' });
  const Workspace = module.exports.default;
  function resolve(node, path = 'tree') {
    if (Array.isArray(node)) return node.map((item, index) => resolve(item, `${path}:${index}`));
    if (node == null || typeof node !== 'object') return node;
    if (typeof node.type === 'function') return frame(`${path}:${node.type.name}:${node.key || ''}`, () => resolve(node.type(node.props), `${path}:component`));
    return { ...node, props: { ...node.props, children: resolve(node.props.children, `${path}:children`) } };
  }
  const api = { calls, state, hosted,
    render() { api.tree = frame('root', () => resolve(Workspace({ initialData: state }))); return api.tree; },
    async flush() { for (let i = 0; i < 4; i++) { api.render(); while (effects.length) effects.shift()(); await new Promise(resolve => setTimeout(resolve, 0)); } return api.tree; },
  };
  return api;
}
function nodes(tree, match) { const result = []; function walk(node) { if (Array.isArray(node)) return node.forEach(walk); if (!node || typeof node !== 'object') return; if (match(node)) result.push(node); walk(node.props.children); } walk(tree); return result; }
function text(node) { if (Array.isArray(node)) return node.map(text).join(' '); if (node == null || typeof node === 'boolean') return ''; if (typeof node !== 'object') return String(node); return text(node.props.children); }
function button(tree, name) { const result = nodes(tree, node => node.type === 'button' && text(node).trim().replace(/\s+/g, ' ') === name)[0]; assert.ok(result, `Missing button ${name}`); return result; }
const event = values => ({ preventDefault() {}, currentTarget: { values } });
function editorForm(ui) { const editor = nodes(ui.tree, node => node.props['aria-label'] === 'Review billing action')[0]; assert.ok(editor); return nodes(editor, node => node.type === 'form')[0]; }
async function openFirst(ui) { button(ui.tree, 'Open').props.onClick(); await ui.flush(); }

test('invoice review opens itemization, book/manual totals and filters from the server', async () => {
  const ui = harness({ initial: fixture([invoice(), invoice({ id: 'held-invoice', held: true, holdReason: 'Review service credit' })]) }); await ui.flush();
  assert.match(text(ui.tree), /Sample Customer/); assert.match(text(ui.tree), /Below book/);
  await openFirst(ui); assert.match(text(ui.tree), /Weekly two-dog service/); assert.match(text(ui.tree), /Large yard/); assert.match(text(ui.tree), /\$125\.00/); assert.match(text(ui.tree), /\$120\.00/);
  const filter = nodes(ui.tree, node => node.type === 'select' && nodes(node, child => child.type === 'option' && child.props.value === 'held').length)[0];
  filter.props.onChange({ target: { value: 'held' } }); await ui.flush();
  assert.ok(ui.calls.some(call => call.url.includes('filter=held'))); assert.match(text(ui.tree), /held-invoice/); assert.doesNotMatch(text(ui.tree), /invoice-one/);
});

test('approval requires reviewed submission and schedules an exact invoice without an implicit charge', async () => {
  const ui = harness({ post(body, state) { if (body.action === 'approve') Object.assign(state.invoices[0], { status: 'approved', revision: 4 }); } }); await ui.flush(); await openFirst(ui);
  button(ui.tree, 'Review approval').props.onClick(); await ui.flush(); assert.equal(ui.calls.filter(call => call.body).length, 0);
  await editorForm(ui).props.onSubmit(event({ paymentMethodId: method.id, reason: 'Reviewed monthly service' })); await ui.flush();
  const command = ui.calls.find(call => call.body)?.body; assert.equal(command.action, 'approve'); assert.equal(command.expectedRevision, 3); assert.equal(command.paymentMethodId, method.id); assert.equal(command.chargeNow, false);
  assert.equal(ui.calls.some(call => call.body?.action === 'charge_now'), false); assert.ok(nodes(ui.tree, node => node.type === 'button' && text(node).startsWith('Charge now')).length);
});

test('a lost hold response retries the same reviewed command and request identity', async () => {
  let lose = true; const recorded = new Set();
  const ui = harness({ post(body, state) { if (body.action === 'hold') { recorded.add(body.requestId); if (lose) { lose = false; throw new Error('Response lost'); } Object.assign(state.invoices[0], { status: 'draft', held: true, revision: 4, holdReason: body.reason }); } } });
  await ui.flush(); await openFirst(ui); button(ui.tree, 'Hold').props.onClick(); await ui.flush(); assert.match(text(ui.tree), /revoke its approval/);
  await editorForm(ui).props.onSubmit(event({ reason: 'Review amount with owner' })); await ui.flush(); assert.match(text(ui.tree), /Response lost/);
  await editorForm(ui).props.onSubmit(event({ reason: 'Review amount with owner' })); await ui.flush();
  const attempts = ui.calls.filter(call => call.body?.action === 'hold'); assert.equal(attempts.length, 2); assert.equal(attempts[0].body.requestId, attempts[1].body.requestId); assert.equal(recorded.size, 1);
  assert.equal(nodes(ui.tree, node => node.type === 'button' && text(node) === 'Review approval').length, 0);
});

test('held invoices cannot approve and voided invoices lose charge controls', async () => {
  const ui = harness({ initial: fixture([invoice({ status: 'approved', held: true, holdReason: 'Review cancellation' })]), post(body, state) { if (body.action === 'void') Object.assign(state.invoices[0], { status: 'void', held: false, revision: 4 }); } });
  await ui.flush(); await openFirst(ui); assert.match(text(ui.tree), /Held:.*Review cancellation/); assert.equal(nodes(ui.tree, node => node.type === 'button' && text(node) === 'Review approval').length, 0);
  button(ui.tree, 'Void').props.onClick(); await ui.flush(); assert.match(text(ui.tree), /A void invoice cannot charge/);
  await editorForm(ui).props.onSubmit(event({ reason: 'No service for this period' })); await ui.flush();
  assert.equal(nodes(ui.tree, node => node.type === 'button' && /^(Charge now|Review approval$|Edit draft$)/.test(text(node))).length, 0);
});

test('new-client form keeps cleanup, first-period mode and one-time add-ons in one idempotent command', async () => {
  let lose = true; const applications = new Set(); const ui = harness({ post(body) { if (body.action === 'create_new_client') { applications.add(body.requestId); if (lose) { lose = false; throw new Error('Response lost'); } } } });
  await ui.flush(); nodes(ui.tree, node => node.type === 'button' && text(node).startsWith('New client'))[0].props.onClick(); await ui.flush();
  button(ui.tree, 'Add one-time item').props.onClick(); await ui.flush();
  const editor = nodes(ui.tree, node => node.props['aria-label'] === 'Review billing action')[0];
  const inputs = nodes(editor, node => node.type === 'input' && typeof node.props.onChange === 'function');
  inputs[0].props.onChange({ target: { value: 'Litter box setup' } }); inputs[1].props.onChange({ target: { value: '15.25' } }); await ui.flush();
  const values = { customerId: 'customer-one', startDate: '2026-11-21', initialCleanup: '35.10', firstPeriodMode: 'prorated', includeNextFullMonth: 'on', taxBasisPoints: '0', reason: 'Reviewed new agreement' };
  await editorForm(ui).props.onSubmit(event(values)); await ui.flush(); await editorForm(ui).props.onSubmit(event(values)); await ui.flush();
  const posts = ui.calls.filter(call => call.body?.action === 'create_new_client'); assert.equal(posts.length, 2); assert.equal(posts[0].body.requestId, posts[1].body.requestId); assert.equal(applications.size, 1);
  assert.equal(posts[0].body.initialCleanupCents, 3510); assert.equal(posts[0].body.firstPeriodMode, 'prorated'); assert.equal(posts[0].body.includeNextFullMonth, true); assert.equal(posts[0].body.additionalLines[0].totalCents, 1525); assert.equal(posts[0].body.additionalLines[0].label, 'Litter box setup');
});

test('batch approval excludes held and terminal invoices and carries reviewed revisions', async () => {
  const ui = harness({ initial: fixture([invoice(), invoice({ id: 'held', held: true }), invoice({ id: 'paid', status: 'paid' })]) }); await ui.flush();
  nodes(ui.tree, node => node.props['aria-label'] === 'Select all visible invoices')[0].props.onChange({ target: { checked: true } }); await ui.flush();
  button(ui.tree, 'Review approval for 1 invoice').props.onClick(); await ui.flush(); await editorForm(ui).props.onSubmit(event({ reason: 'Review batch' })); await ui.flush();
  const body = ui.calls.find(call => call.body)?.body; assert.deepEqual(body.invoiceIds, ['invoice-one']); assert.deepEqual(body.expectedRevisions, { 'invoice-one': 3 }); assert.equal(body.chargeNow, undefined);
});

test('payment-method page passes UAT config to the hosted boundary and displays only safe metadata', async () => {
  const ui = harness(); await ui.flush(); button(ui.tree, 'Payment methods').props.onClick(); await ui.flush();
  nodes(ui.tree, node => node.type === 'select' && node.props.value === '')[0].props.onChange({ target: { value: 'customer-one' } }); await ui.flush();
  assert.match(text(ui.tree), /1111/); assert.match(text(ui.tree), /12\/29/); assert.match(text(ui.tree), /Hosted secure method setup/); assert.equal(ui.hosted.at(-1).customerId, 'customer-one'); assert.equal(ui.hosted.at(-1).config.card.environment, 'uat');
  assert.equal(nodes(ui.tree, node => node.type === 'input' && /card|cvv|cvc|routing|accountnumber|pan/i.test(`${node.props.name || ''} ${node.props.autoComplete || ''}`)).length, 0);
});

test('ACH failure review shows processor and return codes and requires explicit reviewed retry inputs', async () => {
  const ui = harness({ initial: fixture([invoice({ status: 'failed', methodType: 'ach', attempts: [{ attempt: 1, status: 'failed', idempotencyKey: 'invoice-one:1', amountCents: 12000, processorCode: '06', achReturnCode: 'R03' }], returnAction: 'method_review_required' })]) }); await ui.flush(); await openFirst(ui);
  assert.match(text(ui.tree), /R03/); assert.match(text(ui.tree), /06/); assert.match(text(ui.tree), /method review required/); assert.match(text(ui.tree), /ACH remains Pending until settlement/);
  button(ui.tree, 'Review retry').props.onClick(); await ui.flush(); await editorForm(ui).props.onSubmit(event({ paymentMethodId: method.id, manualRetry: 'on', achReviewed: 'on', newAuthorization: 'on', methodUpdated: 'on', reason: 'Reviewed replacement authorized method' })); await ui.flush();
  const body = ui.calls.find(call => call.body)?.body; assert.equal(body.action, 'retry'); assert.equal(body.achReviewed, true); assert.equal(body.newAuthorization, true); assert.equal(body.manualRetry, true); assert.equal(body.chargeNow, false);
});

test('schedule policy saves reviewed settings with notices off and revision only in the command envelope', async () => {
  const ui = harness(); await ui.flush(); button(ui.tree, 'Schedule & policy').props.onClick(); await ui.flush();
  const form = nodes(ui.tree, node => node.type === 'form')[0];
  await form.props.onSubmit(event({ draftDaysBefore: '1', draftHour: '18', draftMinute: '0', chargeHour: '9', chargeMinute: '0', taxBasisPoints: '0', achDiscountBasisPoints: '100', cardRetryDays: '1, 3, 7', firstPeriodMode: 'full', includeNextFullMonth: 'on', reason: 'Reviewed monthly UAT policy' })); await ui.flush();
  const body = ui.calls.find(call => call.body)?.body; assert.equal(body.action, 'save_settings'); assert.equal(body.expectedRevision, 1); assert.equal(body.settings.revision, undefined); assert.equal(body.settings.customerNoticesEnabled, false); assert.deepEqual(body.settings.cardRetryDays, [1, 3, 7]); assert.equal(body.settings.newClientFirstPeriodMode, 'full');
});

test('accounting source review queues monthly fees with the statement period and actual bank date', async () => {
  const ui = harness(); await ui.flush(); button(ui.tree, 'Accounting sync').props.onClick(); await ui.flush();
  const form = nodes(ui.tree, node => node.props['aria-label'] === 'Accounting source review')[0];
  await form.props.onSubmit(event({ sourceId: 'fees-december', statementMonth: '2026-12', postedDate: '2027-01-05', amount: '34.65', reason: 'Reviewed monthly processor statement' })); await ui.flush();
  const body = ui.calls.find(call => call.body)?.body; assert.equal(body.action, 'queue_accounting'); assert.equal(body.kind, 'fee'); assert.deepEqual(body.source, { id: 'fees-december', periodStart: '2026-12-01', periodEnd: '2027-01-01', postedDate: '2027-01-05', amountCents: 3465 });
});

test('gross deposit source review calculates exact payment links and retains replay identity after transport loss', async () => {
  let lose = true; const ui = harness({ post(body) { if (body.action === 'queue_accounting' && lose) { lose = false; throw new Error('Response lost'); } } }); await ui.flush(); button(ui.tree, 'Accounting sync').props.onClick(); await ui.flush();
  const formFor = () => nodes(ui.tree, node => node.props['aria-label'] === 'Accounting source review')[0];
  nodes(formFor(), node => node.type === 'select')[0].props.onChange({ target: { value: 'deposit' } }); await ui.flush();
  nodes(formFor(), node => node.type === 'textarea' && node.props.onChange)[0].props.onChange({ target: { value: 'payment-one | 120.00\npayment-two | 55.25' } }); await ui.flush(); assert.match(text(ui.tree), /\$175\.25/);
  const values = { sourceId: 'deposit-first', postedDate: '2026-12-02', reason: 'Reviewed gross next-day deposit' };
  await formFor().props.onSubmit(event(values)); await ui.flush(); await formFor().props.onSubmit(event(values)); await ui.flush();
  const posts = ui.calls.filter(call => call.body); assert.equal(posts.length, 2); assert.equal(posts[0].body.requestId, posts[1].body.requestId); assert.equal(posts[0].body.source.grossCents, 17525); assert.equal(posts[0].body.source.payments[1].amountCents, 5525); assert.equal(posts[0].body.source.feeCents, undefined); assert.equal(posts[0].body.source.netCents, undefined);
});

test('unknown refund adjustments block new refund/credit and expose only a reviewed inquiry on the recorded adjustment', async () => {
  const adjustment = { id: 'invoice-one:refund:adjustment-one', kind: 'refund', amountCents: 2500, status: 'unknown', processorCode: 'transport_unknown', createdAt: '2026-12-02T14:00:00Z' };
  const ui = harness({ initial: fixture([invoice({ status: 'paid', adjustments: [adjustment] })]), post(body, state) { if (body.action === 'reconcile_adjustment') state.invoices[0].adjustments[0].status = 'confirmed'; } });
  await ui.flush(); await openFirst(ui); assert.match(text(ui.tree), /unknown outcome/); assert.equal(nodes(ui.tree, node => node.type === 'button' && text(node).startsWith('Review refund'))[0].props.disabled, true); assert.equal(button(ui.tree, 'Record credit').props.disabled, true);
  button(ui.tree, 'Review adjustment inquiry').props.onClick(); await ui.flush(); assert.equal(ui.calls.some(call => call.body), false); assert.match(text(ui.tree), /never starts a second refund or void/);
  await editorForm(ui).props.onSubmit(event({ reason: 'Checked recorded refund with processor' })); await ui.flush();
  const body = ui.calls.find(call => call.body)?.body; assert.equal(body.action, 'reconcile_adjustment'); assert.equal(body.adjustmentId, adjustment.id); assert.equal(body.invoiceId, 'invoice-one'); assert.equal(body.expectedRevision, 3); assert.equal(ui.calls.some(call => ['refund', 'void_payment'].includes(call.body?.action)), false); assert.equal(button(ui.tree, 'Record credit').props.disabled, false);
});

test('pending ACH payment exposes a status inquiry without starting another charge', async () => {
  const ui = harness({ initial: fixture([invoice({ status: 'pending', methodType: 'ach', attempts: [{ attempt: 1, status: 'pending', idempotencyKey: 'invoice-one:1', amountCents: 12000 }] })]) }); await ui.flush(); await openFirst(ui);
  button(ui.tree, 'Review UAT payment inquiry').props.onClick(); await ui.flush(); assert.match(text(ui.tree), /does not start another charge/);
  await editorForm(ui).props.onSubmit(event({ reason: 'Reviewed ACH clearing status' })); await ui.flush();
  const body = ui.calls.find(call => call.body)?.body; assert.equal(body.action, 'reconcile'); assert.equal(body.invoiceId, 'invoice-one'); assert.equal(ui.calls.some(call => call.body?.action === 'charge_now'), false);
});

test('invoice status tabs and Who owes us use native states without treating drafts or clearing payments as collectible', async () => {
  const ui = harness({initial:fixture([
    invoice({id:'draft-record'}),invoice({id:'future-approved',status:'approved',scheduledChargeAt:'2099-12-01T14:00:00Z'}),
    invoice({id:'past-approved',status:'approved',scheduledChargeAt:'2000-01-01T14:00:00Z'}),invoice({id:'paid-record',status:'paid'}),
    invoice({id:'failed-record',status:'failed'}),invoice({id:'clearing-record',status:'pending',methodType:'ach'}),invoice({id:'void-record',status:'void'})
  ])});await ui.flush();
  const records=()=>nodes(ui.tree,node=>node.type==='table'&&node.props['aria-label']==='Billing invoice records')[0];
  const choose=async name=>{const nav=nodes(ui.tree,node=>node.props['aria-label']==='Invoice status')[0];nodes(nav,node=>node.type==='button'&&text(node).trim().startsWith(name))[0].props.onClick();await ui.flush();};
  assert.match(text(records()),/draft-record/);assert.doesNotMatch(text(records()),/paid-record|future-approved/);
  await choose('Open');assert.match(text(records()),/future-approved|clearing-record/);assert.doesNotMatch(text(records()),/past-approved|failed-record/);
  await choose('Overdue');assert.match(text(records()),/past-approved/);assert.doesNotMatch(text(records()),/future-approved|failed-record|clearing-record/);
  await choose('Failed');assert.match(text(records()),/failed-record/);assert.doesNotMatch(text(records()),/past-approved/);
  button(ui.tree,'Who owes us').props.onClick();await ui.flush();
  assert.match(text(records()),/future-approved/);assert.match(text(records()),/past-approved/);assert.match(text(records()),/failed-record/);
  assert.doesNotMatch(text(records()),/draft-record|paid-record|clearing-record|void-record/);
  assert.equal(button(ui.tree,'Send drafts').props.disabled,true);assert.match(text(ui.tree),/Native invoice sending is unavailable/);
  assert.ok(ui.calls.some(call=>!call.body&&!call.url.includes('period=')));assert.equal(ui.calls.some(call=>call.body),false);
});

test('create invoice deep link opens the existing review form without generating, sending or charging', async()=>{
  const ui=harness({query:'?create=invoice'});await ui.flush();
  assert.ok(nodes(ui.tree,node=>node.props['aria-label']==='Review billing action').length);
  assert.match(text(ui.tree),/Initial cleanup and the first service period stay on exactly one invoice/);
  assert.equal(ui.calls.some(call=>call.body),false);
});

test('Home attention deep link shows exactly overdue and failed records across all billing periods',async()=>{
  const ui=harness({query:'?status=attention&month=all',initial:fixture([
    invoice({id:'draft-record'}),invoice({id:'future-approved',status:'approved',scheduledChargeAt:'2099-12-01T14:00:00Z'}),
    invoice({id:'past-approved',status:'approved',scheduledChargeAt:'2000-01-01T14:00:00Z'}),invoice({id:'failed-record',status:'failed'}),
    invoice({id:'clearing-record',status:'pending'}),invoice({id:'paid-record',status:'paid'})
  ])});await ui.flush();
  const records=nodes(ui.tree,node=>node.type==='table'&&node.props['aria-label']==='Billing invoice records')[0];
  assert.match(text(ui.tree),/Overdue and failed\s+invoices/);assert.match(text(records),/past-approved/);assert.match(text(records),/failed-record/);
  assert.doesNotMatch(text(records),/draft-record|future-approved|clearing-record|paid-record/);
  assert.ok(ui.calls.some(call=>!call.body&&!call.url.includes('period=')));assert.equal(ui.calls.some(call=>call.body),false);
});

import bankPrivate from './bank-private.json' with {type:'json'};
// All monetary comparisons use integer cents. Equality is corroboration, not an audit opinion.
export function cents(value) {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '' || !Number.isFinite(Number(value))) throw new Error('Invalid monetary evidence.');
  const result = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(result) || Math.abs(result) > 1e12) throw new Error('Monetary evidence out of bounds.');
  return result;
}
export function providerId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(value)) throw new Error('Invalid provider identifier.');
  return value;
}
export function bankDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) !== value) throw new Error('Invalid bank date.');
  return value;
}
export function normalizeBankTransaction(row, accountId) {
  if (row.account_id !== accountId) throw new Error('Unexpected bank account.');
  if (row.iso_currency_code !== 'USD' || typeof row.pending !== 'boolean') throw new Error('Unsupported bank evidence.');
  return { id: providerId(row.transaction_id), accountId, date: bankDate(row.date), amountCents: -cents(row.amount), description: String(row.name || '').slice(0,240), pending: row.pending };
}
const name = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
const REQUIRED_QBO_BANK_ACCOUNTS = bankPrivate.accounts.map(account=>({key:account.key,mask:account.mask,label:account.label,name:new RegExp(account.namePattern)}));

export function requiredQuickBooksBankAccounts(accounts) {
  if (!Array.isArray(accounts) || accounts.length > 1000) throw new Error('Invalid QuickBooks account evidence.');
  const selected = REQUIRED_QBO_BANK_ACCOUNTS.map(required => {
    const matches = accounts.filter(account => {
      const label=name(`${account?.Name || ''} ${account?.FullyQualifiedName || ''}`);
      return account?.Active !== false && account?.AccountType === 'Bank' &&
        (!account.CurrencyRef || account.CurrencyRef.value === 'USD') &&
        required.name.test(label) && new RegExp(`(?:^|\\D)${required.mask}(?:\\D|$)`).test(label);
    });
    if (matches.length !== 1) throw new Error(`QuickBooks ${required.label} account is missing or ambiguous.`);
    const account=matches[0];
    return {key:required.key,id:providerId(String(account.Id)),name:String(account.Name || required.label).slice(0,160),mask:required.mask,bookCents:cents(account.CurrentBalance)};
  });
  if (new Set(selected.map(account=>account.id)).size !== selected.length) throw new Error('QuickBooks bank account selection is ambiguous.');
  return selected;
}

export function compareSngQuickBooksInvoices({invoices=[],sngInvoices=[]}) {
  if (!Array.isArray(invoices) || !Array.isArray(sngInvoices) || invoices.length>1000 || sngInvoices.length>1000) throw new Error('Invalid invoice evidence.');
  const cases=[];
  const seen=new Map();
  const invoiceKey=value=>{
    const raw=String(value || '').trim();
    const providerSuffix=raw.match(/(?:^|\D)(\d{5,12})$/);
    return providerSuffix?.[1] || raw;
  };
  for(const row of sngInvoices) {
    const key=invoiceKey(row.invoice_number);
    seen.set(key,(seen.get(key)||0)+1);
  }
  for(const row of sngInvoices) {
    const key=invoiceKey(row.invoice_number);
    const matches=invoices.filter(q=>key && invoiceKey(q.DocNumber)===key);
    const qbo=matches.length===1 && seen.get(key)===1?matches[0]:null;
    const identity=qbo && name(row.client_name) && name(row.client_name)===name(qbo.CustomerRef?.name);
    const total=cents(row.total);
    const gross=qbo?cents(qbo.TotalAmt):null;
    const tax=qbo?.TxnTaxDetail?.TotalTax==null?null:cents(qbo.TxnTaxDetail.TotalTax);
    const subtotal=tax!=null && tax>=0 && tax<=gross?gross-tax:null;
    const amountAgrees=qbo && (gross===total || subtotal===total);
    const agrees=Boolean(identity && (!qbo.CurrencyRef || qbo.CurrencyRef.value==='USD') && amountAgrees);
    cases.push({id:`sng:invoice:${providerId(String(row.invoice_id))}`,kind:'invoice',status:agrees?'resolved':'open',evidence:{sngInvoiceId:String(row.invoice_id),invoiceNumber:String(row.invoice_number || ''),sngCents:total,qboInvoiceId:qbo?.Id?String(qbo.Id):null,qboCents:gross,qboSubtotalCents:subtotal,qboTaxCents:tax,message:agrees?'Archived invoice number, customer name and total or explicit pre-tax subtotal agree. This does not validate payment or customer identity.':'Archived SNG invoice needs a unique QuickBooks invoice with agreeing number, customer name and total or explicit pre-tax subtotal.'}});
  }
  return cases;
}

export function compareFinancialEvidence({ bank, qboAccount, deposits, invoices, sngInvoices, transactions, settlementLinks = [], now }) {
  const cases = [];
  const add = (id, kind, agrees, evidence) => cases.push({ id, kind, status: agrees ? 'resolved' : 'open', evidence: {...evidence,...(kind!=='invoice'?{accountName:bank.account_name,accountMask:bank.account_mask}:{})} });
  const age = Date.parse(now) - Date.parse(bank.bank_updated_at);
  const fresh = Number.isFinite(age) && age >= -300000 && age < 48 * 3600000;
  add(`bank:${bank.account_id}:freshness`, 'feed', fresh && Boolean(bank.history_ready), { bankUpdatedAt: bank.bank_updated_at, historyReady: Boolean(bank.history_ready), message: 'Bank source must be current within 48 hours and initial history complete.' });
  if (fresh && bank.history_ready && bank.current_cents !== null) {
    const qboCents = cents(qboAccount.CurrentBalance);
    add(`bank:${bank.account_id}:balance`, 'balance', bank.current_cents === qboCents, { bankCents: bank.current_cents, qboCents, differenceCents: bank.current_cents - qboCents, message: 'Current bank and book balances; differences can include timing and outstanding items. Available balance is shown separately and is not used for this comparison.' });
  }
  // Cash movement suggestions never establish settlement by themselves, even if unique.
  for (const row of transactions.filter(row => !row.pending && !row.removed && row.amount_cents !== 0)) {
    const candidates = deposits.filter(d => d.DepositToAccountRef?.value === qboAccount.Id && cents(d.TotalAmt) === row.amount_cents && Math.abs(Date.parse(d.TxnDate) - Date.parse(row.date)) <= 3 * 86400000);
    const link=settlementLinks.find(link=>link.bank_transaction_id===row.id);
    const agrees=Boolean(fresh && bank.history_ready && link && link.bank_date===row.date && link.amount_cents===row.amount_cents && candidates.some(d=>d.Id===link.qbo_deposit_id));
    add(`bank:deposit:${row.id}`, 'settlement', agrees, { bankTransactionId: row.id, date: row.date, amountCents: row.amount_cents, candidates: candidates.map(d => String(d.Id)).slice(0,20), reviewedBy:link?.reviewed_by || null, message: agrees ? 'Owner-reviewed cash movement still agrees with fresh accounting evidence. Underlying processor allocations remain outside this check.' : 'Review the statement, receipt, transfer or processor evidence. Amount/date candidates alone are not verified matches.' });
  }
  for (const row of transactions.filter(row => row.removed)) add(`bank:deposit:${row.id}`, 'settlement', true, { bankTransactionId: row.id, message: 'Provider removed this transaction; retained for history.' });
  for (const row of transactions.filter(row => !row.removed && (row.pending || row.amount_cents===0) && settlementLinks.some(link=>link.bank_transaction_id===row.id))) {
    add(`bank:deposit:${row.id}`, 'settlement', false, {bankTransactionId:row.id,message:'Previously reviewed transaction is now pending or zero; the prior match must be rechecked.'});
  }
  cases.push(...compareSngQuickBooksInvoices({invoices,sngInvoices}));
  return cases;
}

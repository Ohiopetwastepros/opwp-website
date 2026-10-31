import { ROUTE_INVOICE_SQL, archivedInvoice, invoiceIsVoided } from "./route-invoice-archive.mjs";
import { classifyRevenueLine } from "./revenue-classification.mjs";

export const REVENUE_PRODUCTS = { scooping: "Scooping", initial: "Initial cleanups", addon: "Add-on services", dog_food: "Dog food" };
const cents = value => value !== null && value !== "" && Number.isFinite(Number(value)) ? Math.round(Number(value) * 100) : null;
export const emptyBillingMatrix = () => Object.fromEntries(Object.keys(REVENUE_PRODUCTS).map(key => [key, { subscription: 0, one_time: 0 }]));

export function buildInvoiceRevenueFacts(invoices) {
  const dates = new Map(), seen = new Set();
  for (const invoice of invoices) {
    if (invoiceIsVoided(invoice)) continue;
    if (seen.has(`${invoice.source}:${invoice.id}`)) continue;
    seen.add(`${invoice.source}:${invoice.id}`);
    const date = String(invoice.date || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (!dates.has(date)) dates.set(date, { date, matrix: emptyBillingMatrix(), unclassified: 0, tips: 0, subtotal: 0, invoices: 0, unresolvedLines: 0 });
    const fact = dates.get(date), subtotal = cents(invoice.subtotal);
    fact.invoices++;
    if (subtotal === null) { fact.unresolvedLines++; continue; }
    fact.subtotal += subtotal;
    const lines = invoice.lines || [];
    const amounts = lines.map(line => cents(line.amount));
    if (!lines.length || amounts.some(amount => amount === null) || Math.abs(amounts.reduce((sum, n) => sum + n, 0) - subtotal) > 1) {
      fact.unclassified += subtotal; fact.unresolvedLines++; continue;
    }
    lines.forEach((line, index) => {
      const amount = amounts[index];
      if (/\btips?\b/i.test(String(line.description || ""))) { fact.tips += amount; return; }
      const classified = classifyRevenueLine(line, invoice);
      const product = classified.category === "initial" ? "initial" : classified.product;
      const { billing } = classified;
      if (product === "unknown" || billing === "unknown") { fact.unclassified += amount; fact.unresolvedLines++; }
      else fact.matrix[product][billing] += amount;
    });
  }
  return [...dates.values()].sort((a,b) => a.date.localeCompare(b.date)).map(row => ({ ...row,
    matrix: Object.fromEntries(Object.entries(row.matrix).map(([product, values]) => [product, Object.fromEntries(Object.entries(values).map(([cadence,value])=>[cadence,value/100]))])),
    subtotal: row.subtotal / 100, unclassified: row.unclassified / 100, tips: row.tips / 100,
  }));
}

export function summarizeInvoiceRevenue(facts, from, through) {
  const result = { matrix: emptyBillingMatrix(), unclassified: 0, tips: 0, subtotal: 0, invoices: 0, unresolvedLines: 0 };
  for (const fact of facts.filter(row=>row.date>=from&&row.date<=through)) {
    for (const product of Object.keys(REVENUE_PRODUCTS)) for (const cadence of ["subscription","one_time"]) result.matrix[product][cadence] += Number(fact.matrix[product]?.[cadence]) || 0;
    for (const field of ["unclassified","tips","subtotal","invoices","unresolvedLines"]) result[field] += fact[field];
  }
  return result;
}

export async function readInvoiceRevenue(db, from, through) {
  const result = await db.prepare(`${ROUTE_INVOICE_SQL} SELECT * FROM route_invoices
    WHERE invoice_date BETWEEN ? AND ? ORDER BY invoice_date LIMIT 20001`).bind(from,through).all();
  if (result.results.length > 20000) throw new Error("Invoice reporting exceeds its bounded range.");
  const invoices = result.results.map(archivedInvoice);
  const coverage = await db.prepare(`${ROUTE_INVOICE_SQL} SELECT MIN(invoice_date) first_invoice,MAX(invoice_date) last_invoice FROM route_invoices`).first();
  return { facts:buildInvoiceRevenueFacts(invoices), firstInvoice:coverage?.first_invoice?.slice(0,10)||null, lastInvoice:coverage?.last_invoice?.slice(0,10)||null,
    sources:["Sweep & Go finalized invoices"], basis:"Pre-tax SNG invoices; voided invoices excluded. Initial cleanups, service visits and MRR are separate measures." };
}

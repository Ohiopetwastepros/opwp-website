import { withQuickBooksReadOnlyClient } from "./quickbooks";
import {
  CLEANUP_ENTITIES,
  CLEANUP_REPORTS,
  buildArDiagnostics,
  validatedDateRange,
} from "./quickbooks-cleanup-logic.mjs";

const ENTITY_SET = new Set(CLEANUP_ENTITIES);
const REPORT_SET = new Set(CLEANUP_REPORTS);
const PAGE_SIZE = 1000;
const MAX_RECORDS = 5000;

function queryFor(entity, { start, end, startPosition }) {
  const paging = `STARTPOSITION ${startPosition} MAXRESULTS ${PAGE_SIZE}`;
  if (entity === "Customer") return `SELECT * FROM Customer WHERE Active IN (true,false) ${paging}`;
  if (entity === "Account" || entity === "Item") return `SELECT * FROM ${entity} WHERE Active IN (true,false) ${paging}`;
  return `SELECT * FROM ${entity} WHERE TxnDate >= '${start}' AND TxnDate <= '${end}' ${paging}`;
}

async function queryAll(get, entity, range) {
  if (!ENTITY_SET.has(entity)) throw new Error("Unsupported QuickBooks entity.");
  const rows = [];
  for (let startPosition = 1; startPosition <= MAX_RECORDS; startPosition += PAGE_SIZE) {
    const data = await get("query", { query: queryFor(entity, { ...range, startPosition }) });
    const page = data?.QueryResponse?.[entity] || [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  if (rows.length >= MAX_RECORDS) throw new Error(`${entity} reached the ${MAX_RECORDS}-record safety limit.`);
  return rows;
}

async function report(get, name, range, accountingMethod) {
  if (!REPORT_SET.has(name)) throw new Error("Unsupported QuickBooks report.");
  if (name === "AgedReceivables" || name === "AgedReceivableDetail") {
    return get(`reports/${name}`, { report_date: range.end, accounting_method: accountingMethod });
  }
  if (name === "BalanceSheet" || name === "TrialBalance" || name === "CustomerBalance" || name === "CustomerBalanceDetail" || name === "AccountListDetail") {
    return get(`reports/${name}`, { date: range.end, accounting_method: accountingMethod });
  }
  return get(`reports/${name}`, {
    start_date: range.start,
    end_date: range.end,
    accounting_method: accountingMethod,
  });
}

function metadata({ dataset, range, companyName, environment, extra = {} }) {
  return {
    schemaVersion: 1,
    source: "quickbooks-online",
    access: "read-only",
    dataset,
    companyName,
    environment,
    fetchedAt: new Date().toISOString(),
    range,
    ...extra,
  };
}

async function optionalReport(get, name, range, accountingMethod) {
  try {
    return { data: await report(get, name, range, accountingMethod), warning: null };
  } catch (error) {
    return {
      data: null,
      warning: `${name} was unavailable: ${error instanceof Error ? error.message : "request failed"}`,
    };
  }
}

export async function getQuickBooksCleanupDataset({
  dataset,
  start,
  end,
  entity = "",
  reportName = "",
  accountingMethod = "Accrual",
}) {
  const maxDays = dataset === "report" ? 186 : 730;
  const range = validatedDateRange(start, end, maxDays);
  if (!["ar", "entity", "report"].includes(dataset)) throw new Error("Unsupported cleanup dataset.");
  if (!["Cash", "Accrual"].includes(accountingMethod)) throw new Error("Unsupported accounting method.");

  return withQuickBooksReadOnlyClient(async ({ get, companyName, environment }) => {
    if (dataset === "entity") {
      const rows = await queryAll(get, entity, range);
      return {
        meta: metadata({ dataset, range, companyName, environment, extra: { entity } }),
        count: rows.length,
        rows,
      };
    }
    if (dataset === "report") {
      const data = await report(get, reportName, range, accountingMethod);
      return {
        meta: metadata({ dataset, range, companyName, environment, extra: { reportName, accountingMethod } }),
        report: data,
      };
    }

    const [customers, invoices, payments, creditMemos] = await Promise.all([
      queryAll(get, "Customer", range),
      queryAll(get, "Invoice", range),
      queryAll(get, "Payment", range),
      queryAll(get, "CreditMemo", range),
    ]);
    const [agingDetail, customerBalanceDetail] = await Promise.all([
      optionalReport(get, "AgedReceivableDetail", range, "Accrual"),
      optionalReport(get, "CustomerBalanceDetail", range, "Accrual"),
    ]);
    const warnings = [agingDetail.warning, customerBalanceDetail.warning].filter(Boolean);
    return {
      meta: metadata({ dataset, range, companyName, environment }),
      diagnostics: buildArDiagnostics({ customers, invoices, payments, creditMemos }),
      sourceCounts: {
        customers: customers.length,
        invoices: invoices.length,
        payments: payments.length,
        creditMemos: creditMemos.length,
      },
      reports: {
        agingDetail: agingDetail.data,
        customerBalanceDetail: customerBalanceDetail.data,
      },
      warnings,
    };
  });
}

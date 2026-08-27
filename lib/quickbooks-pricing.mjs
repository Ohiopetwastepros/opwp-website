const finite = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalized = (value) => String(value || "").trim().toLowerCase();

function rowColumns(row) {
  return row?.Summary?.ColData || row?.ColData || row?.Header?.ColData || [];
}

export function flattenProfitAndLossRows(report) {
  const rows = [];

  function visit(items = [], parents = []) {
    for (const row of items || []) {
      const headerLabel = row?.Header?.ColData?.[0]?.value;
      const columns = rowColumns(row);
      const label = columns?.[0]?.value;
      const path = [...parents, label].filter(Boolean);
      const rawAmount = columns.at(-1)?.value;

      if (label && columns.length > 1 && rawAmount !== "") {
        rows.push({ label: String(label).trim(), path: path.join(":"), amount: finite(rawAmount), summary: Boolean(row?.Summary) });
      }

      visit(row?.Rows?.Row, headerLabel ? [...parents, headerLabel] : parents);
    }
  }

  visit(report?.Rows?.Row);
  return rows;
}

function firstAmount(rows, labels) {
  const wanted = new Set(labels.map(normalized));
  return rows.find((row) => wanted.has(normalized(row.label)))?.amount ?? 0;
}

function sumLeafRows(rows, predicate) {
  return rows.filter((row) => !row.summary && predicate(row)).reduce((sum, row) => sum + row.amount, 0);
}

function sectionTotal(rows, totalLabels, sectionPattern) {
  const statedTotal = firstAmount(rows.filter((row) => row.summary), totalLabels);
  if (statedTotal) return statedTotal;
  return sumLeafRows(rows, (row) => sectionPattern.test(normalized(row.path)));
}

export function deriveQuickBooksPricingActuals(report, options = {}) {
  const rows = flattenProfitAndLossRows(report);
  const wages = firstAmount(rows, ["Wages", "Total Wages", "Payroll wages", "Payroll expenses:Wages"]);
  const bonuses = firstAmount(rows, ["Bonuses and Comissions", "Bonuses and Commissions"]);
  const directPayroll = Math.max(wages + bonuses, 0);
  const payrollTaxes = sumLeafRows(rows, (row) => {
    const label = normalized(row.label);
    const path = normalized(row.path);
    return label.endsWith("payroll taxes") || (label.endsWith("taxes") && path.includes("payroll expenses"));
  });
  const benefits = sectionTotal(rows, ["Total Employee benefits"], /employee benefits/);
  const burdenCost = Math.max(payrollTaxes + benefits, 0);
  const burdenPercent = directPayroll > 0 ? (burdenCost / directPayroll) * 100 : null;
  const operatingExpenses = firstAmount(rows, ["Total Expenses", "Expenses"]);
  const costOfGoodsSold = firstAmount(rows, ["Total Cost of Goods Sold", "Cost of Goods Sold"]);
  const fixedOperatingCosts = Math.max(operatingExpenses + costOfGoodsSold - directPayroll - burdenCost, 0);

  const startMs = Date.parse(options.periodStart || "");
  const endMs = Date.parse(options.periodEnd || "");
  const periodDays = Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.max(Math.round((endMs - startMs) / 86400000) + 1, 1) : 365;
  const tonyWeeklyHours = Math.min(Math.max(finite(options.tonyWeeklyHours) || 40, 1), 80);
  const potentialPaidHours = tonyWeeklyHours * periodDays / 7;
  const fixedOverheadPerCrewHour = potentialPaidHours > 0 ? fixedOperatingCosts / potentialPaidHours : null;

  return { burdenPercent, burdenCost, directPayroll, fixedOperatingCosts, fixedOverheadPerCrewHour, operatingExpenses, costOfGoodsSold, potentialPaidHours, periodDays };
}

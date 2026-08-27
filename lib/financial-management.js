import { getDb } from "./db";
import { getQuickBooksFinancialSnapshot } from "./quickbooks";
import {
  enforceTonyMinimumWeeklyHours,
  TONY_MINIMUM_WEEKLY_HOURS,
  TONY_WEEKLY_HOURS_CUTOFF,
  validateTonyMinimumWeeklyHours,
} from "./staffing-policy.mjs";

const SETTINGS_ID = "primary";
const MONTHS_PER_YEAR = 12;
const WEEKS_PER_MONTH = 52 / 12;

const DEFAULTS = {
  id: SETTINGS_ID,
  books_status: "rectifying",
  verified_cash_balance: 78197.37,
  verified_cash_as_of: "2026-07-23",
  owner_monthly_pay: 8500,
  minimum_monthly_retained_cash: 3000,
  protected_cash_floor: 65000,
  monthly_tax_reserve: 2500,
  payroll_burden_percent: 12,
  tony_current_rate: 30,
  tony_current_weekly_hours: 40,
  tony_target_rate: 30,
  tony_target_weekly_hours: 40,
  bria_current_rate: 21,
  bria_current_weekly_hours: 0,
  bria_target_weekly_hours: 0,
  truck_purchase_price: 35000,
  truck_down_payment: 10000,
  truck_apr_percent: 9,
  truck_term_months: 48,
  truck_monthly_insurance: 300,
  truck_monthly_maintenance: 200,
  notes: "",
};

const NUMERIC_FIELDS = [
  "verified_cash_balance", "owner_monthly_pay", "minimum_monthly_retained_cash", "protected_cash_floor",
  "monthly_tax_reserve", "payroll_burden_percent", "tony_current_rate", "tony_current_weekly_hours",
  "tony_target_rate", "tony_target_weekly_hours", "bria_current_rate", "bria_current_weekly_hours",
  "bria_target_weekly_hours", "truck_purchase_price", "truck_down_payment", "truck_apr_percent",
  "truck_term_months", "truck_monthly_insurance", "truck_monthly_maintenance",
];

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function money(value) { return Math.round((number(value) + Number.EPSILON) * 100) / 100; }

function normalizeSettings(row = {}) {
  const result = { ...DEFAULTS, ...row };
  for (const field of NUMERIC_FIELDS) result[field] = number(result[field], DEFAULTS[field]);
  result.tony_target_weekly_hours = enforceTonyMinimumWeeklyHours(result.tony_target_weekly_hours);
  result.tony_minimum_weekly_hours = TONY_MINIMUM_WEEKLY_HOURS;
  result.tony_weekly_hours_cutoff = TONY_WEEKLY_HOURS_CUTOFF;
  return result;
}

function weeklyPayroll(rate, hours) {
  const safeHours = Math.max(number(hours), 0);
  return Math.max(Math.min(safeHours, 40), 0) * Math.max(number(rate), 0)
    + Math.max(safeHours - 40, 0) * Math.max(number(rate), 0) * 1.5;
}

function loanPayment(principal, annualRatePercent, termMonths) {
  const amount = Math.max(number(principal), 0);
  const months = Math.max(Math.round(number(termMonths)), 1);
  const monthlyRate = Math.max(number(annualRatePercent), 0) / 1200;
  if (!amount) return 0;
  if (!monthlyRate) return amount / months;
  return amount * monthlyRate / (1 - (1 + monthlyRate) ** -months);
}

function completeMonthlyRows(rows = []) {
  return rows.filter((row) => !/total/i.test(String(row.label || "")) && !row.partial);
}

export async function getFinancialManagementSettings() {
  const db = getDb();
  if (!db) return normalizeSettings();
  const row = await db.prepare("SELECT * FROM financial_management_settings WHERE id=?").bind(SETTINGS_ID).first();
  return normalizeSettings(row || {});
}

export async function saveFinancialManagementSettings(input, actorEmail = "") {
  const db = getDb();
  if (!db) throw new Error("Financial management storage is not configured.");
  const prior = await getFinancialManagementSettings();
  if (Object.prototype.hasOwnProperty.call(input, "tony_target_weekly_hours")) {
    validateTonyMinimumWeeklyHours(input.tony_target_weekly_hours);
  }
  const booksStatus = ["verified", "rectifying", "provisional"].includes(input.books_status) ? input.books_status : prior.books_status;
  const next = normalizeSettings({
    ...prior,
    ...Object.fromEntries(NUMERIC_FIELDS.map((field) => [field, Math.max(number(input[field], prior[field]), 0)])),
    books_status: booksStatus,
    verified_cash_as_of: String(input.verified_cash_as_of || prior.verified_cash_as_of || "").slice(0, 10) || null,
    notes: String(input.notes || "").trim().slice(0, 1000),
  });
  next.truck_term_months = Math.max(Math.min(Math.round(next.truck_term_months), 120), 1);
  next.payroll_burden_percent = Math.min(next.payroll_burden_percent, 100);
  next.truck_apr_percent = Math.min(next.truck_apr_percent, 100);

  await db.batch([
    db.prepare(`UPDATE financial_management_settings SET books_status=?,verified_cash_balance=?,verified_cash_as_of=?,
      owner_monthly_pay=?,minimum_monthly_retained_cash=?,protected_cash_floor=?,monthly_tax_reserve=?,payroll_burden_percent=?,
      tony_current_rate=?,tony_current_weekly_hours=?,tony_target_rate=?,tony_target_weekly_hours=?,bria_current_rate=?,
      bria_current_weekly_hours=?,bria_target_weekly_hours=?,truck_purchase_price=?,truck_down_payment=?,truck_apr_percent=?,
      truck_term_months=?,truck_monthly_insurance=?,truck_monthly_maintenance=?,notes=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(next.books_status, next.verified_cash_balance, next.verified_cash_as_of, next.owner_monthly_pay,
        next.minimum_monthly_retained_cash, next.protected_cash_floor, next.monthly_tax_reserve, next.payroll_burden_percent,
        next.tony_current_rate, next.tony_current_weekly_hours, next.tony_target_rate, next.tony_target_weekly_hours,
        next.bria_current_rate, next.bria_current_weekly_hours, next.bria_target_weekly_hours, next.truck_purchase_price,
        next.truck_down_payment, next.truck_apr_percent, next.truck_term_months, next.truck_monthly_insurance,
        next.truck_monthly_maintenance, next.notes || null, actorEmail || null, SETTINGS_ID),
    db.prepare("INSERT INTO financial_management_audit (id,settings_id,actor_email,prior_values,next_values) VALUES (?,?,?,?,?)")
      .bind(crypto.randomUUID(), SETTINGS_ID, actorEmail || null, JSON.stringify(prior), JSON.stringify(next)),
  ]);
  return getFinancialManagementSettings();
}

export async function getFinancialManagementDashboard(quickBooks) {
  const settings = await getFinancialManagementSettings();
  const completed = completeMonthlyRows(quickBooks.monthly || []);
  const divisor = completed.length || 1;
  const averageRevenue = completed.reduce((sum, row) => sum + number(row.revenue), 0) / divisor;
  const averageExpenses = completed.reduce((sum, row) => sum + number(row.expenses), 0) / divisor;
  const averageNetIncome = completed.reduce((sum, row) => sum + number(row.netIncome), 0) / divisor;
  const burden = 1 + settings.payroll_burden_percent / 100;
  const currentPayroll = (weeklyPayroll(settings.tony_current_rate, settings.tony_current_weekly_hours)
    + weeklyPayroll(settings.bria_current_rate, settings.bria_current_weekly_hours)) * WEEKS_PER_MONTH * burden;
  const targetPayroll = (weeklyPayroll(settings.tony_target_rate, settings.tony_target_weekly_hours)
    + weeklyPayroll(settings.bria_current_rate, settings.bria_target_weekly_hours)) * WEEKS_PER_MONTH * burden;
  const payrollChange = targetPayroll - currentPayroll;
  const financed = Math.max(settings.truck_purchase_price - settings.truck_down_payment, 0);
  const truckPayment = loanPayment(financed, settings.truck_apr_percent, settings.truck_term_months);
  const truckMonthlyCost = truckPayment + settings.truck_monthly_insurance + settings.truck_monthly_maintenance;
  const managementCash = settings.verified_cash_balance || number(quickBooks.cash);
  const cashAfterTruck = managementCash - Math.min(settings.truck_down_payment, settings.truck_purchase_price);
  const normalizedPreOwnerCash = averageNetIncome - payrollChange;
  const ownerPayrollCost = settings.owner_monthly_pay * burden;
  const plannedMonthlyRetained = normalizedPreOwnerCash - ownerPayrollCost - truckMonthlyCost;
  const safeOwnerPay = Math.max((normalizedPreOwnerCash - truckMonthlyCost - settings.minimum_monthly_retained_cash) / burden, 0);
  const reserveGap = cashAfterTruck - settings.protected_cash_floor;
  const dataWarnings = [];
  if (settings.books_status !== "verified") dataWarnings.push("QuickBooks is marked as provisional while corrections are in progress.");
  if (!(number(quickBooks.costOfGoodsSold) > 0)) dataWarnings.push("Direct costs are not classified, so gross margin is not decision-grade yet.");
  if (number(quickBooks.accountsReceivable) < 0) dataWarnings.push("QuickBooks reports negative accounts receivable; use verified cash for liquidity decisions until corrected.");
  if (completed.length < 3) dataWarnings.push("Fewer than three complete monthly periods are available for normalization.");

  return {
    settings,
    normalized: {
      completedMonths: completed.length,
      averageRevenue: money(averageRevenue),
      averageExpenses: money(averageExpenses),
      averageNetIncome: money(averageNetIncome),
      currentPayroll: money(currentPayroll),
      targetPayroll: money(targetPayroll),
      payrollChange: money(payrollChange),
      normalizedPreOwnerCash: money(normalizedPreOwnerCash),
    },
    truck: {
      financed: money(financed), payment: money(truckPayment), monthlyCost: money(truckMonthlyCost),
      cashAfterPurchase: money(cashAfterTruck), reserveGap: money(reserveGap),
    },
    owner: {
      targetPay: money(settings.owner_monthly_pay), employerCost: money(ownerPayrollCost),
      plannedMonthlyRetained: money(plannedMonthlyRetained), safeMonthlyPay: money(safeOwnerPay),
      supported: plannedMonthlyRetained >= settings.minimum_monthly_retained_cash,
    },
    cash: {
      quickBooks: money(quickBooks.cash), verified: money(managementCash), source: settings.verified_cash_balance ? "Management verified" : "QuickBooks",
      asOf: settings.verified_cash_as_of || quickBooks.periodEnd, protectedFloor: money(settings.protected_cash_floor),
      availableAboveFloor: money(managementCash - settings.protected_cash_floor),
    },
    dataWarnings,
    annualOwnerPay: money(settings.owner_monthly_pay * MONTHS_PER_YEAR),
  };
}

export async function captureDailyFinancialSnapshot() {
  const db = getDb();
  if (!db) return { configured: false };
  const [quickBooks, settings] = await Promise.all([getQuickBooksFinancialSnapshot(), getFinancialManagementSettings()]);
  const snapshotDate = new Date().toISOString().slice(0, 10);
  await db.prepare(`INSERT INTO financial_daily_snapshots
    (id,snapshot_date,source_status,books_status,qbo_cash,verified_cash,revenue_mtd,expenses_mtd,net_income_mtd,
      accounts_receivable,current_liabilities,payload)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(snapshot_date) DO UPDATE SET source_status=excluded.source_status,books_status=excluded.books_status,
      qbo_cash=excluded.qbo_cash,verified_cash=excluded.verified_cash,revenue_mtd=excluded.revenue_mtd,
      expenses_mtd=excluded.expenses_mtd,net_income_mtd=excluded.net_income_mtd,accounts_receivable=excluded.accounts_receivable,
      current_liabilities=excluded.current_liabilities,payload=excluded.payload,captured_at=CURRENT_TIMESTAMP`)
    .bind(crypto.randomUUID(), snapshotDate, quickBooks.ok ? "connected" : "unavailable", settings.books_status,
      quickBooks.cash ?? null, settings.verified_cash_balance ?? null, quickBooks.revenue ?? null, quickBooks.expenses ?? null,
      quickBooks.netIncome ?? null, quickBooks.accountsReceivable ?? null, quickBooks.currentLiabilities ?? null,
      JSON.stringify({ periodStart: quickBooks.periodStart, periodEnd: quickBooks.periodEnd, error: quickBooks.error || null })).run();
  return { configured: true, snapshotDate, ok: quickBooks.ok };
}

export async function recordDailyFinancialSnapshot(quickBooks) {
  const db = getDb();
  if (!db) return { configured: false };
  const settings = await getFinancialManagementSettings();
  const snapshotDate = new Date().toISOString().slice(0, 10);
  await db.prepare(`INSERT INTO financial_daily_snapshots
    (id,snapshot_date,source_status,books_status,qbo_cash,verified_cash,revenue_mtd,expenses_mtd,net_income_mtd,
      accounts_receivable,current_liabilities,payload)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(snapshot_date) DO UPDATE SET source_status=excluded.source_status,books_status=excluded.books_status,
      qbo_cash=excluded.qbo_cash,verified_cash=excluded.verified_cash,revenue_mtd=excluded.revenue_mtd,
      expenses_mtd=excluded.expenses_mtd,net_income_mtd=excluded.net_income_mtd,accounts_receivable=excluded.accounts_receivable,
      current_liabilities=excluded.current_liabilities,payload=excluded.payload,captured_at=CURRENT_TIMESTAMP`)
    .bind(crypto.randomUUID(), snapshotDate, quickBooks.ok ? "connected" : "unavailable", settings.books_status,
      quickBooks.cash ?? null, settings.verified_cash_balance ?? null, quickBooks.revenue ?? null, quickBooks.expenses ?? null,
      quickBooks.netIncome ?? null, quickBooks.accountsReceivable ?? null, quickBooks.currentLiabilities ?? null,
      JSON.stringify({ periodStart: quickBooks.periodStart, periodEnd: quickBooks.periodEnd, warnings: quickBooks.warnings || [] })).run();
  return { configured: true, snapshotDate };
}

export async function listDailyFinancialSnapshots(limit = 90) {
  const db = getDb();
  if (!db) return [];
  const result = await db.prepare(`SELECT snapshot_date,source_status,books_status,qbo_cash,verified_cash,revenue_mtd,
    expenses_mtd,net_income_mtd,accounts_receivable,current_liabilities,captured_at
    FROM financial_daily_snapshots ORDER BY snapshot_date DESC LIMIT ?`).bind(Math.min(Math.max(Number(limit) || 90, 1), 366)).all();
  return (result.results || []).reverse();
}

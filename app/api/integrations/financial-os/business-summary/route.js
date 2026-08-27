import { getQuickBooksFinancialDashboard } from "@/lib/quickbooks";
import { verifyFinancialOsRequest } from "@/lib/service-auth";

export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "no-store, private",
  "Content-Type": "application/json",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(request) {
  if (!(await verifyFinancialOsRequest(request))) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401, headers });
  }

  const data = await getQuickBooksFinancialDashboard();
  if (!data.configured || !data.connected) {
    return Response.json(
      { ok: false, error: "QuickBooks is not connected." },
      { status: 503, headers },
    );
  }
  if (!data.ok) {
    return Response.json(
      { ok: false, error: "QuickBooks summary is temporarily unavailable." },
      { status: 502, headers },
    );
  }

  return Response.json({
    schemaVersion: 1,
    source: "quickbooks-online",
    fetchedAt: new Date().toISOString(),
    company: { name: data.companyName },
    period: {
      start: data.periodStart,
      end: data.periodEnd,
      accountingMethod: "Accrual",
    },
    performance: {
      revenue: data.revenue,
      grossProfit: data.grossProfit,
      costOfGoodsSold: data.costOfGoodsSold,
      expenses: data.expenses,
      netIncome: data.netIncome,
      grossMarginPercent: data.grossMargin,
      netMarginPercent: data.netMargin,
    },
    position: {
      cash: data.cash,
      accountsReceivable: data.accountsReceivable,
      currentAssets: data.currentAssets,
      currentLiabilities: data.currentLiabilities,
      totalLiabilities: data.totalLiabilities,
      totalEquity: data.totalEquity,
    },
    cashFlow: { netChange: data.netCashChange },
    monthly: (data.monthly || []).map((month) => ({
      label: month.label,
      revenue: month.revenue,
      grossProfit: month.grossProfit,
      expenses: month.expenses,
      netIncome: month.netIncome,
    })),
    warnings: data.warnings || [],
  }, { headers });
}

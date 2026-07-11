import { getRuntimeEnv } from "./cloudflare";
import { getDb } from "./db";

const AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const PRODUCTION_API_URL = "https://quickbooks.api.intuit.com/v3/company";
const SANDBOX_API_URL = "https://sandbox-quickbooks.api.intuit.com/v3/company";
const REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";
const CONNECTION_ID = "primary";

function env() { return getRuntimeEnv(); }
function environment() { return env().QB_ENVIRONMENT === "sandbox" ? "sandbox" : "production"; }
function apiUrl() { return environment() === "sandbox" ? SANDBOX_API_URL : PRODUCTION_API_URL; }
function base64(bytes) { return btoa(String.fromCharCode(...bytes)); }
function unbase64(value) { return Uint8Array.from(atob(value), (character) => character.charCodeAt(0)); }

export function quickBooksConfigured() {
  const runtime = env();
  return Boolean(runtime.QB_CLIENT_ID && runtime.QB_CLIENT_SECRET && runtime.QB_REDIRECT_URI && runtime.QB_TOKEN_ENCRYPTION_KEY);
}

async function encryptionKey() {
  const raw = unbase64(env().QB_TOKEN_ENCRYPTION_KEY || "");
  if (raw.byteLength !== 32) throw new Error("QB_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encrypt(value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(), new TextEncoder().encode(value));
  return `${base64(iv)}.${base64(new Uint8Array(ciphertext))}`;
}

async function decrypt(value) {
  const [ivValue, ciphertextValue] = String(value).split(".");
  if (!ivValue || !ciphertextValue) throw new Error("Invalid encrypted QuickBooks token.");
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unbase64(ivValue) }, await encryptionKey(), unbase64(ciphertextValue));
  return new TextDecoder().decode(plaintext);
}

function basicAuthorization() {
  return `Basic ${btoa(`${env().QB_CLIENT_ID}:${env().QB_CLIENT_SECRET}`)}`;
}

async function tokenRequest(params) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { Authorization: basicAuthorization(), Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error_description || data.error || `QuickBooks token request failed (${response.status}).`);
  return data;
}

export async function createQuickBooksAuthorization(email) {
  const db = getDb();
  if (!quickBooksConfigured() || !db) throw new Error("QuickBooks OAuth is not configured.");
  const state = base64(crypto.getRandomValues(new Uint8Array(32))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  await db.batch([
    db.prepare("DELETE FROM quickbooks_oauth_states WHERE expires_at <= CURRENT_TIMESTAMP"),
    db.prepare("INSERT INTO quickbooks_oauth_states (state, created_by, expires_at) VALUES (?, ?, datetime('now', '+10 minutes'))").bind(state, email || null),
  ]);
  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", env().QB_CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "com.intuit.quickbooks.accounting");
  url.searchParams.set("redirect_uri", env().QB_REDIRECT_URI);
  url.searchParams.set("state", state);
  return url.toString();
}

export async function completeQuickBooksAuthorization({ code, realmId, state }) {
  const db = getDb();
  if (!quickBooksConfigured() || !db) throw new Error("QuickBooks OAuth is not configured.");
  const validState = await db.prepare("DELETE FROM quickbooks_oauth_states WHERE state = ? AND expires_at > CURRENT_TIMESTAMP RETURNING created_by").bind(state).first();
  if (!validState) throw new Error("The QuickBooks authorization request is invalid or expired.");
  const tokens = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: env().QB_REDIRECT_URI });
  const [accessToken, refreshToken] = await Promise.all([encrypt(tokens.access_token), encrypt(tokens.refresh_token)]);
  const accessExpiry = new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000).toISOString();
  const refreshExpiry = tokens.x_refresh_token_expires_in ? new Date(Date.now() + Number(tokens.x_refresh_token_expires_in) * 1000).toISOString() : null;
  await db.prepare(`INSERT INTO quickbooks_connections
    (id, realm_id, access_token_encrypted, refresh_token_encrypted, access_token_expires_at, refresh_token_expires_at, scope, connected_by, environment)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET realm_id=excluded.realm_id, access_token_encrypted=excluded.access_token_encrypted,
      refresh_token_encrypted=excluded.refresh_token_encrypted, access_token_expires_at=excluded.access_token_expires_at,
      refresh_token_expires_at=excluded.refresh_token_expires_at, scope=excluded.scope, connected_by=excluded.connected_by,
      environment=excluded.environment, connected_at=CURRENT_TIMESTAMP, refreshed_at=CURRENT_TIMESTAMP, last_error=NULL`)
    .bind(CONNECTION_ID, realmId, accessToken, refreshToken, accessExpiry, refreshExpiry, tokens.scope || null, validState.created_by || null, environment()).run();
  return { realmId };
}

async function connection() {
  const db = getDb();
  return db ? db.prepare("SELECT * FROM quickbooks_connections WHERE id = ?").bind(CONNECTION_ID).first() : null;
}

async function validAccessToken(record) {
  if (Date.parse(record.access_token_expires_at) > Date.now() + 5 * 60000) return decrypt(record.access_token_encrypted);
  return refreshAccessToken(record);
}

async function refreshAccessToken(record) {
  const refreshToken = await decrypt(record.refresh_token_encrypted);
  const tokens = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
  const [accessEncrypted, refreshEncrypted] = await Promise.all([encrypt(tokens.access_token), encrypt(tokens.refresh_token)]);
  const accessExpiry = new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000).toISOString();
  const refreshExpiry = tokens.x_refresh_token_expires_in ? new Date(Date.now() + Number(tokens.x_refresh_token_expires_in) * 1000).toISOString() : record.refresh_token_expires_at;
  await getDb().prepare(`UPDATE quickbooks_connections SET access_token_encrypted=?, refresh_token_encrypted=?,
    access_token_expires_at=?, refresh_token_expires_at=?, refreshed_at=CURRENT_TIMESTAMP, last_error=NULL WHERE id=?`)
    .bind(accessEncrypted, refreshEncrypted, accessExpiry, refreshExpiry, CONNECTION_ID).run();
  return tokens.access_token;
}

async function qboFetch(record, token, path, params = {}) {
  const url = new URL(`${apiUrl()}/${encodeURIComponent(record.realm_id)}/${path}`);
  Object.entries({ minorversion: "75", ...params }).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const intuitTid = response.headers.get("intuit_tid");
    const message = data?.Fault?.Error?.[0]?.Message || `QuickBooks API request failed (${response.status}).`;
    console.error(JSON.stringify({ event: "quickbooks_api_error", status: response.status, intuit_tid: intuitTid, message }));
    throw new Error(`${message} (${response.status})${intuitTid ? ` [intuit_tid: ${intuitTid}]` : ""}`);
  }
  return data;
}

async function qboFetchWithAuthRecovery(record, token, path, params = {}) {
  try {
    return { data: await qboFetch(record, token, path, params), token };
  } catch (error) {
    if (!/\(401\)|authenticationfailed|unauthorized/i.test(String(error))) throw error;
    const refreshedToken = await refreshAccessToken(record);
    return { data: await qboFetch(record, refreshedToken, path, params), token: refreshedToken };
  }
}

export async function disconnectQuickBooks() {
  const record = await connection();
  if (!record) return { disconnected: true };
  try {
    const refreshToken = await decrypt(record.refresh_token_encrypted);
    const response = await fetch(REVOKE_URL, {
      method: "POST",
      headers: { Authorization: basicAuthorization(), Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ token: refreshToken }),
    });
    if (!response.ok && response.status !== 400) throw new Error(`QuickBooks revoke failed (${response.status}).`);
  } finally {
    await getDb().prepare("DELETE FROM quickbooks_connections WHERE id = ?").bind(CONNECTION_ID).run();
  }
  return { disconnected: true };
}

function reportValues(report) {
  const values = new Map();
  function visit(rows = []) {
    for (const row of rows) {
      const label = row.Header?.ColData?.[0]?.value || row.Summary?.ColData?.[0]?.value || row.ColData?.[0]?.value;
      const columns = row.Summary?.ColData || row.ColData;
      if (label && columns?.length > 1) values.set(label.toLowerCase(), Number(columns.at(-1)?.value) || 0);
      visit(row.Rows?.Row);
    }
  }
  visit(report?.Rows?.Row);
  return values;
}

function pick(map, ...labels) {
  for (const label of labels) if (map.has(label.toLowerCase())) return map.get(label.toLowerCase());
  return 0;
}

export async function getQuickBooksFinancialSnapshot() {
  if (!quickBooksConfigured()) return { configured: false, connected: false, ok: false, error: null };
  const record = await connection();
  if (!record) return { configured: true, connected: false, ok: false, error: null };
  const now = new Date();
  const start = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const end = now.toISOString().slice(0, 10);
  try {
    const initialToken = await validAccessToken(record);
    const recovered = await qboFetchWithAuthRecovery(record, initialToken, `companyinfo/${encodeURIComponent(record.realm_id)}`);
    const token = recovered.token;
    const company = recovered.data;
    const [profitAndLoss, balanceSheet, cashFlow] = await Promise.all([
      qboFetch(record, token, "reports/ProfitAndLoss", { start_date: start, end_date: end, accounting_method: "Accrual" }),
      qboFetch(record, token, "reports/BalanceSheet", { date: end, accounting_method: "Accrual" }),
      qboFetch(record, token, "reports/CashFlow", { start_date: start, end_date: end }),
    ]);
    const pnl = reportValues(profitAndLoss);
    const balance = reportValues(balanceSheet);
    const cash = reportValues(cashFlow);
    const revenue = pick(pnl, "Total Income", "Income");
    const grossProfit = pick(pnl, "Gross Profit");
    const costOfGoodsSold = pick(pnl, "Total Cost of Goods Sold", "Cost of Goods Sold");
    const netIncome = pick(pnl, "Net Income");
    const snapshot = {
      companyName: company?.CompanyInfo?.CompanyName || record.company_name || "QuickBooks company", environment: record.environment || environment(),
      periodStart: start, periodEnd: end,
      revenue, grossProfit, costOfGoodsSold, grossMargin: revenue && costOfGoodsSold ? Math.round((grossProfit / revenue) * 1000) / 10 : null,
      expenses: pick(pnl, "Total Expenses", "Expenses"), netIncome, netMargin: revenue ? Math.round((netIncome / revenue) * 1000) / 10 : 0,
      cash: pick(balance, "Total Bank Accounts", "Bank Accounts", "Cash and cash equivalents"),
      accountsReceivable: pick(balance, "Accounts Receivable (A/R)", "Accounts Receivable"),
      currentAssets: pick(balance, "Total Current Assets"), currentLiabilities: pick(balance, "Total Current Liabilities"),
      totalLiabilities: pick(balance, "Total Liabilities"), totalEquity: pick(balance, "Total Equity"),
      netCashChange: pick(cash, "Net cash increase for period", "Net Increase in Cash"),
    };
    await getDb().prepare("UPDATE quickbooks_connections SET company_name=?, last_sync_at=CURRENT_TIMESTAMP, last_error=NULL WHERE id=?").bind(snapshot.companyName, CONNECTION_ID).run();
    return { configured: true, connected: true, ok: true, error: null, ...snapshot };
  } catch (error) {
    const message = String(error);
    await getDb().prepare("UPDATE quickbooks_connections SET last_error=? WHERE id=?").bind(message.slice(0, 500), CONNECTION_ID).run();
    console.error(JSON.stringify({ event: "quickbooks_snapshot_error", message }));
    return { configured: true, connected: true, ok: false, error: message };
  }
}

function reportSeries(report, ...labels) {
  const wanted = new Set(labels.map((label) => label.toLowerCase()));
  let result = [];
  function visit(rows = []) {
    for (const row of rows) {
      const columns = row.Summary?.ColData || row.ColData || row.Header?.ColData;
      const label = columns?.[0]?.value?.toLowerCase();
      if (label && wanted.has(label)) result = columns.slice(1).map((column) => Number(column.value) || 0);
      visit(row.Rows?.Row);
    }
  }
  visit(report?.Rows?.Row);
  return result;
}

function monthLabels(report) {
  return (report?.Columns?.Column ?? []).slice(1).map((column) => column.ColTitle || column.MetaData?.find((item) => item.Name === "ColKey")?.Value || "Period");
}

function queryRows(response, entity) {
  return response?.QueryResponse?.[entity] ?? [];
}

export async function getQuickBooksFinancialDashboard() {
  const summary = await getQuickBooksFinancialSnapshot();
  if (!summary.ok) return summary;
  const record = await connection();
  try {
    const token = await validAccessToken(record);
    const now = new Date();
    const yearStart = `${now.getUTCFullYear()}-01-01`;
    const today = now.toISOString().slice(0, 10);
    const optional = async (label, promise, fallback) => {
      try { return { value: await promise, warning: null }; }
      catch (error) { return { value: fallback, warning: `${label} is unavailable for this QuickBooks company.` }; }
    };
    const [monthlyPnl, receivablesResult, payablesResult, classesResult, departmentsResult, accountsResult, itemsResult] = await Promise.all([
      qboFetch(record, token, "reports/ProfitAndLoss", { start_date: yearStart, end_date: today, accounting_method: "Accrual", summarize_column_by: "Month" }),
      optional("Receivables aging", qboFetch(record, token, "reports/AgedReceivableSummary", { report_date: today }), {}),
      optional("Payables aging", qboFetch(record, token, "reports/AgedPayableSummary", { report_date: today }), {}),
      optional("Classes", qboFetch(record, token, "query", { query: "select * from Class maxresults 1000" }), { QueryResponse: {} }),
      optional("Locations", qboFetch(record, token, "query", { query: "select * from Department maxresults 1000" }), { QueryResponse: {} }),
      optional("Chart of accounts", qboFetch(record, token, "query", { query: "select * from Account maxresults 1000" }), { QueryResponse: {} }),
      optional("Products and services", qboFetch(record, token, "query", { query: "select * from Item maxresults 1000" }), { QueryResponse: {} }),
    ]);
    const receivables = receivablesResult.value;
    const payables = payablesResult.value;
    const classes = classesResult.value;
    const departments = departmentsResult.value;
    const accounts = accountsResult.value;
    const items = itemsResult.value;
    const labels = monthLabels(monthlyPnl);
    const revenue = reportSeries(monthlyPnl, "Total Income", "Income");
    const expenses = reportSeries(monthlyPnl, "Total Expenses", "Expenses");
    const grossProfit = reportSeries(monthlyPnl, "Gross Profit");
    const netIncome = reportSeries(monthlyPnl, "Net Income");
    const monthly = labels.map((label, index) => ({ label, revenue: revenue[index] || 0, expenses: expenses[index] || 0, grossProfit: grossProfit[index] || 0, netIncome: netIncome[index] || 0 }));
    const activeAccounts = queryRows(accounts, "Account").filter((account) => account.Active !== false);
    const dashboard = {
      ...summary,
      warnings: [receivablesResult, payablesResult, classesResult, departmentsResult, accountsResult, itemsResult].map((result) => result.warning).filter(Boolean),
      monthly,
      receivablesAging: reportValues(receivables),
      payablesAging: reportValues(payables),
      classes: queryRows(classes, "Class").filter((item) => item.Active !== false).map((item) => ({ id: item.Id, name: item.FullyQualifiedName || item.Name })),
      locations: queryRows(departments, "Department").filter((item) => item.Active !== false).map((item) => ({ id: item.Id, name: item.FullyQualifiedName || item.Name })),
      accounts: activeAccounts.map((account) => ({ id: account.Id, name: account.FullyQualifiedName || account.Name, type: account.AccountType, subtype: account.AccountSubType, balance: Number(account.CurrentBalance) || 0 })),
      products: queryRows(items, "Item").filter((item) => item.Active !== false).map((item) => ({ id: item.Id, name: item.FullyQualifiedName || item.Name, type: item.Type })),
    };
    await getDb().prepare(`INSERT INTO quickbooks_metadata_cache
      (id, environment, classes_json, locations_json, accounts_json, products_json, warnings_json, refreshed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET environment=excluded.environment, classes_json=excluded.classes_json,
        locations_json=excluded.locations_json, accounts_json=excluded.accounts_json, products_json=excluded.products_json,
        warnings_json=excluded.warnings_json, refreshed_at=CURRENT_TIMESTAMP`)
      .bind(CONNECTION_ID, dashboard.environment, JSON.stringify(dashboard.classes), JSON.stringify(dashboard.locations),
        JSON.stringify(dashboard.accounts), JSON.stringify(dashboard.products), JSON.stringify(dashboard.warnings)).run();
    return dashboard;
  } catch (error) {
    const message = String(error);
    console.error(JSON.stringify({ event: "quickbooks_financial_dashboard_error", message }));
    return { ...summary, ok: false, error: message };
  }
}

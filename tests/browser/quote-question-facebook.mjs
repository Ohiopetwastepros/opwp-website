// Local UI regression only. All API and non-local requests are intercepted.
// Example: node tests/browser/quote-question-facebook.mjs --url http://127.0.0.1:3017 --module ./tmp/fb-audit/browser-tools/node_modules/playwright/index.mjs
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const {values} = parseArgs({options: {url: {type: "string"}, module: {type: "string"}, artifacts: {type: "string", default: "tmp/fb-audit/browser"}}});
const origin = new URL(values.url || "http://127.0.0.1:3017");
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname), "This mocked regression may run only against loopback");
const {webkit, devices} = await import(values.module ? pathToFileURL(path.resolve(values.module)).href : "playwright");
const browser = await webkit.launch({headless: true});
const context = await browser.newContext({...devices["iPhone 13"],
  userAgent: devices["iPhone 13"].userAgent + " [FBAN/FBIOS;FBAV/495.0.0.0.0;FBBV/fixture;FBDV/iPhone14,5;FBMD/iPhone;FBSN/iOS;FBSV/18.0;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5]"});
const requests = [], actions = [];
await context.exposeBinding("recordFixtureTurnstile", (_source, action) => actions.push(action));
await context.route("**/*", async route => {
  const request = route.request(), url = new URL(request.url());
  if (url.hostname === "challenges.cloudflare.com") {
    return route.fulfill({contentType: "application/javascript", body: `
      const fixtures = new Map(); let sequence = 0;
      window.turnstile = {
        render(element, options) {
          const id = 'fixture-' + (++sequence); fixtures.set(id, options);
          window.recordFixtureTurnstile(options.action);
          setTimeout(() => options.callback('fixture-verified-' + options.action), 30);
          return id;
        },
        reset(id) { const options = fixtures.get(id); if (options) setTimeout(() => options.callback('fixture-verified-' + options.action), 30); }
      };`});
  }
  if (url.origin !== origin.origin) return route.abort("blockedbyclient");
  if (!url.pathname.startsWith("/api/")) return route.continue();
  const body = request.postDataJSON();
  requests.push({path: url.pathname, method: request.method(), body});
  if (url.pathname === "/api/lead") return route.fulfill({json: {ok: true, id: "fixture-question", configured: true}});
  if (url.pathname === "/api/quote") return route.fulfill({json: {ok: true, configured: false}});
  return route.fulfill({status: 418, json: {error: "Unexpected API request blocked by offline regression"}});
});
try {
  const page = await context.newPage();
  for (const oneTime of [false, true]) {
    requests.length = 0;
    await page.goto(new URL("/free-quote/", origin).href, {waitUntil: "networkidle"});
    await page.locator('input[placeholder="43560"]').fill("43551");
    await page.locator("#quote-dog-count").fill("2");
    if (oneTime) await page.getByRole("button", {name: "One-time clean", exact: false}).click();
    else await page.getByRole("button", {name: "Up to 1/8 acre", exact: false}).click();
    await page.locator('input[name="phone"]').fill("4192620424");
    await page.locator('input[name="email"]').fill("craig-fixture@example.test");
    await page.getByRole("checkbox").first().check();
    await page.getByRole("button", {name: "See your quote & sign up", exact: false}).click();
    await page.getByRole("button", {name: "I have a question first", exact: true}).click();
    await page.locator('input[name="first_name"]').fill("Craig");
    await page.locator('input[name="last_name"]').fill("");
    await page.locator("#signup-service-question").fill("How much for 2 dogs weekly?");
    assert.equal(await page.locator('input[name="home_address"]').count(), 0, "Question path must not require signup address");
    assert.equal(await page.getByRole("button", {name: /create.*account|start.*service/i}).count(), 0, "Account submit stays hidden");
    await page.waitForFunction(() => document.querySelector('button[aria-describedby="signup-question-missing"]')?.getAttribute("aria-disabled") === "false");
    await page.getByRole("button", {name: "Send my question", exact: true}).click();
    await page.getByRole("heading", {name: "We received your question.", exact: true}).waitFor();
    assert.ok(actions.includes("quote_question"), "Existing question Turnstile action is used");
    assert.equal(requests.filter(item => item.path === "/api/onboard").length, 0);
    const question = requests.find(item => item.path === "/api/lead" && item.body.source === "question");
    assert.ok(question, "Question-only lead must be submitted");
    assert.equal(question.body.name, "Craig");
    assert.equal(question.body.phone, "4192620424");
    assert.equal(question.body.email, "craig-fixture@example.test");
    assert.equal(question.body.zip, "43551");
    assert.equal(question.body.dogs, 2);
    assert.equal(question.body.frequency, oneTime ? "one_time" : "once_a_week");
    assert.equal(question.body.question, "How much for 2 dogs weekly?");
    assert.equal(question.body.turnstileToken, "fixture-verified-quote_question");
    assert.ok(!Object.hasOwn(question.body, "home_address"));
    if (oneTime) {
      assert.equal(question.body.quote_monthly, null);
      assert.ok(Array.isArray(question.body.quote_one_time_range));
      const partials = requests.filter(item => item.path === "/api/lead" && item.body.source === "partial_quote");
      assert.ok(partials.length > 0, "A one-time partial quote is captured");
      assert.ok(partials.every(item => item.body.quote_monthly === null), "One-time partial quote never contains a zero monthly total");
    }
    await mkdir(values.artifacts, {recursive: true});
    await page.screenshot({path: path.join(values.artifacts, `iphone-facebook-question-${oneTime ? "one-time" : "weekly"}.png`), fullPage: true});
    console.log(JSON.stringify({scenario: oneTime ? "one_time" : "weekly", browser: "WebKit", viewport: devices["iPhone 13"].viewport,
      facebookUserAgent: true, questionLead: "mocked", onboardingCalls: 0, externalWrites: 0, monthlyQuote: question.body.quote_monthly, result: "passed"}));
  }
} finally {
  await context.close();
  await browser.close();
}

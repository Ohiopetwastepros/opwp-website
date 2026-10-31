import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

test("visual Worker blocks provider and lead mutations, forces sending off and serves client assets directly", async () => {
  const bundle = await build({ entryPoints: ["scripts/meta-visual-worker.mjs"], bundle: true, write: false, platform: "node", format: "esm", plugins: [{ name: "stub-app", setup(builder) {
    builder.onResolve({ filter: /\.open-next\/worker\.js$/ }, () => ({ path: "app", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: `export default {fetch:async(request,env)=>Response.json({meta:env.META_AUTOMATION_ENABLED,test:env.META_TEST_MODE,email:env.EMAIL_SENDING_ENABLED})};`, loader: "js" }));
  } }] });
  const worker = (await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`)).default;
  assert.equal(worker.scheduled, undefined);
  const env = { META_AUTOMATION_ENABLED: "true", META_TEST_MODE: "true", EMAIL_SENDING_ENABLED: "true", ASSETS: { fetch: async () => new Response("fixture-asset") } };
  const request = (path, method = "GET") => new Request(`https://preview.test${path}`, { method });
  for (const path of ["/api/webhooks/meta-leads/", "/api/webhooks/quo-messages/", "/api/admin/yardops/settings/", "/api/lead/", "/api/onboard/", "/free-quote/"]) for (const method of ["GET", "POST"]) assert.equal((await worker.fetch(request(path, method), env, {})).status, 404);
  assert.equal((await worker.fetch(request("/admin/quote-funnel/meta-preview/", "POST"), env, {})).status, 404);
  const page = await worker.fetch(request("/admin/quote-funnel/meta-preview/"), env, {});
  assert.deepEqual(await page.json(), { meta: "false", test: "false", email: "false" });
  assert.equal(page.headers.get("cache-control"), "private, no-store");
  assert.equal(await (await worker.fetch(request("/_next/static/example.js"), env, {})).text(), "fixture-asset");
});

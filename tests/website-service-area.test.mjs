import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Script } from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as pricing from "../app/free-quote/pricing.js";
import * as territory from "../data/cities.js";

const { cities, declinedServiceCity, getCity, getCityByZip } = territory;
const approvedZips = `43402 43403 43412 43414 43460 43465 43504 43515 43525 43528 43537 43542 43547 43551 43552
  43558 43560 43565 43566 43571 43601 43604 43605 43606 43607 43608 43609 43610 43611 43612 43613 43614
  43615 43616 43617 43619 43620 43623 48144 48182 49267`.split(/\s+/);

test("the quote form, published city pages and service directory cover precisely the approved service area", () => {
  assert.deepEqual([...pricing.PRICING.serviceZips].sort(), approvedZips);
  assert.deepEqual(cities.flatMap(({ zips }) => zips.split(",").map(zip => zip.trim())).sort(), approvedZips);
  const directory = readFileSync(new URL("../app/service-areas/page.js", import.meta.url), "utf8");
  const linkedSlugs = [...directory.matchAll(/href: "\/(dog-poop-removal-[\w-]+)\/"/g)].map(match => match[1]);
  assert.deepEqual(linkedSlugs.sort(), cities.map(({ slug }) => slug).sort());
  assert.equal(getCity("dog-poop-removal-genoa-oh"), undefined);
  for (const zip of approvedZips) {
    assert.equal(pricing.isInArea(zip), true, zip);
    assert.ok(getCityByZip(zip), zip);
  }
  for (const zip of ["43416", "43430", "43420"]) {
    assert.equal(pricing.isInArea(zip), false, zip);
    assert.equal(getCityByZip(zip), undefined, zip);
  }
  assert.equal(getCityByZip("43560-1234").city, "Sylvania");
  assert.equal(getCityByZip("435600"), undefined);
});

test("the decline lookup distinguishes outside cities and ZIPs from the wider Monroe area and local street names", () => {
  for (const [text, expected] of [
    ["Does the route go to ELMORE?", "Elmore"], ["43416-1234", "Elmore"],
    ["Genoa, Ohio", "Genoa"], ["43430", "Genoa"], ["43420", "Fremont"], ["45840", "Findlay"],
    ["Fostoria", "Fostoria"], ["Columbus", "Columbus"], ["48161", "Monroe"], ["48162", "Monroe"],
    ["Monroe area", ""], ["Temperance, 48182", ""], ["Lambertville 48144", ""],
    ["Fremont Pike in Perrysburg", ""], ["Elmore Road in a served ZIP", ""], ["143416", ""],
  ]) assert.equal(declinedServiceCity(text), expected, text);
});

const editorHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const editorModule = editorHtml.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const editorScript = new Script(editorModule.replace(/^\s*import .*?;\s*$/gm, ""), { filename: "index.html" });

function renderEditor(fields, tab = "lead") {
  let html;
  editorScript.runInNewContext({
    ...pricing,
    ...territory,
    document: { getElementById: () => ({}) },
    ReactDOM: { createRoot: () => ({ render: element => { html = renderToStaticMarkup(element); } }) },
    React: {
      ...React,
      useMemo: calculate => calculate(),
      useState(initial) {
        if (typeof initial === "object") return [{ ...initial, ...fields }, () => {}];
        return [initial === "lead" ? tab : initial, () => {}];
      },
    },
  });
  const message = html.match(/<div class="message-box">([^<]*)<\/div>/)[1];
  const preview = html.match(/>Pricing preview<\/div><div class="info-box">([^<]*)<\/div>/)?.[1];
  return { message: message.replaceAll("&#x27;", "'"), preview: preview?.replaceAll("&#x27;", "'") };
}

const quoteFields = { dogs: "2", frequency: "once_a_week", initialTimeframe: "one_month", yardTier: "tiny" };

test("the standalone editor replaces the price preview, follow-up and welcome with the outside-area decline", () => {
  for (const [place, expected] of [
    [{ zip: "43416" }, "Elmore"], [{ city: "Elmore" }, "Elmore"], [{ zip: "43416-1234", city: "Elmore, OH" }, "Elmore"],
    [{ zip: "43430" }, "Genoa"], [{ zip: "43420" }, "Fremont"], [{ zip: "99999" }, "ZIP 99999"],
  ]) {
    const details = { ...quoteFields, ...place, template: "schedule_close", urgency: true, startDate: "2026-12-01" };
    const { message, preview } = renderEditor(details);
    assert.match(message, new RegExp(`don't service ${expected}`));
    assert.match(message, /if we expand/);
    assert.doesNotMatch(message, /\$|set up|schedule|on the way|opt out/i);
    assert.equal(preview, message);
    assert.equal(renderEditor(details, "welcome").message, message);
  }
  const unclear = renderEditor({ ...quoteFields, city: "Monroe" });
  assert.match(unclear.message, /full address and ZIP/);
  assert.doesNotMatch(unclear.message, /\$|don't service/);
  const served = renderEditor({ ...quoteFields, zip: "43560" });
  assert.match(served.message, /Sylvania/);
  assert.match(served.message, /\$105\/month[\s\S]+\$58 to \$70/);
});

test("standalone one-time quotes and welcome drafts use the eligible plan and first invoice", () => {
  const details = { ...quoteFields, zip: "43560", dogs: "3", frequency: "one_time", template: "one_time" };
  const quoted = renderEditor(details).message;
  assert.match(quoted, /\$95 to \$120[\s\S]*even biweekly[\s\S]*\$65 to \$75/);
  assert.match(quoted, /following month of service[\s\S]*1st/);
  assert.doesNotMatch(renderEditor({ ...details, dogs: "4" }).message, /biweekly/);
  assert.match(renderEditor(details, "welcome").message, /invoice for your one-time visit/);
  const recurring = renderEditor({ ...quoteFields, zip: "43560" }, "welcome").message;
  assert.match(recurring, /initial cleanup and the following month of service/);
});

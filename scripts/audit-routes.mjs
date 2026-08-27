import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => entry.isDirectory() ? files(path.join(dir, entry.name)) : [path.join(dir, entry.name)]))).flat();
}

const sourceFiles = (await Promise.all(["app", "components"].map(files))).flat().filter((file) => /\.[jt]sx?$/.test(file));
const pageFiles = sourceFiles.filter((file) => /[\\/]page\.js$/.test(file));
const routeHandlers = sourceFiles.filter((file) => /[\\/]route\.js$/.test(file) && !file.replaceAll("\\", "/").includes("/api/"));
const routes = new Set([...pageFiles, ...routeHandlers].map((file) => {
  const relative = path.relative("app", path.dirname(file)).replaceAll("\\", "/");
  return relative ? "/" + relative.replace(/\[[^/]+\]/g, "*") + "/" : "/";
}));
const links = [];
for (const file of sourceFiles) {
  const source = await readFile(file, "utf8");
  for (const match of source.matchAll(/(?:href\s*=\s*|href\s*:\s*)["']([^"']+)["']/g)) links.push({ file, href: match[1] });
}
const missing = [];
for (const { file, href } of links) {
  if (!href.startsWith("/") || href.startsWith("//") || href.startsWith("/api/") || href.startsWith("/assets/")) continue;
  const clean = href.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  const normalized = clean === "/" ? "/" : clean + "/";
  const exact = routes.has(normalized);
  const dynamic = [...routes].some((route) => route.includes("*") && new RegExp("^" + route.replaceAll("*", "[^/]+") + "$").test(normalized));
  if (!exact && !dynamic) missing.push(file + ": " + href);
}
if (missing.length) throw new Error("Internal links without matching app routes:\n" + missing.join("\n"));
const invalidPhones = links.filter(({ href }) => href.startsWith("tel:") && !/^tel:\+?1?\d{10}$/.test(href.replace(/[() .-]/g, "")));
if (invalidPhones.length) throw new Error("Invalid telephone links:\n" + invalidPhones.map((item) => item.file + ": " + item.href).join("\n"));
console.log("Route/button audit passed: " + routes.size + " page routes and " + links.length + " literal links checked.");

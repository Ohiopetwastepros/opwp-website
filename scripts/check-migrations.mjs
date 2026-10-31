import { readdir } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const files = (await readdir(new URL("../tests/fixtures/migration-templates/", import.meta.url))).filter((name) => name.endsWith(".sql.template")).map(name=>name.replace(/\.template$/, "")).sort();
const historicalDuplicate = new Set(["0022_onboarding_route_assignments.sql", "0022_technician_field_app.sql"]);
const byNumber = new Map();
for (const file of files) {
  const match = /^(\d{4})_[a-z0-9_]+\.sql$/.exec(file);
  if (!match) throw new Error(`Invalid migration filename: ${file}`);
  const number = match[1];
  byNumber.set(number, [...(byNumber.get(number) || []), file]);
}
const invalidDuplicates = [...byNumber.entries()].filter(([, names]) =>
  names.length > 1 && !(names.length === 2 && names.every((name) => historicalDuplicate.has(name))));
if (invalidDuplicates.length) {
  throw new Error(`Duplicate migration numbers: ${invalidDuplicates.map(([number, names]) => `${number} (${names.join(", ")})`).join("; ")}`);
}
const postHistorical = files.filter((file) => Number(file.slice(0, 4)) > 22);
for (let index = 1; index < postHistorical.length; index += 1) {
  if (Number(postHistorical[index].slice(0, 4)) <= Number(postHistorical[index - 1].slice(0, 4))) {
    throw new Error(`Migrations after 0022 must be uniquely and monotonically numbered: ${postHistorical[index]}`);
  }
}
const review = JSON.parse(await readFile(new URL('../tests/fixtures/migration-review.json',import.meta.url),'utf8'));
if(review.templates.length!==files.length || new Set(review.templates.map(row=>row.file)).size!==files.length)throw Error('Migration privacy review is incomplete.');
for(const file of files){
  const row=review.templates.find(item=>item.file===file+'.template');
  const bytes=await readFile(new URL('../tests/fixtures/migration-templates/'+file+'.template',import.meta.url));
  if(!row || createHash('sha256').update(bytes).digest('hex')!==row.sha256)throw Error('Migration data privacy review required: '+file);
}
console.log(`Migration check passed: ${files.length} reviewed templates; historical 0022 duplicate documented and allowed.`);

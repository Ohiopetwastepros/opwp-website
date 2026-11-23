import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import routingPrivate from '../lib/routing-private.json' with {type:'json'};
import { runPrivateInNewContext } from './helpers/private-vm.mjs';
import { routeBookFingerprint } from '../lib/route-book-policy.mjs';

test('hourly route-book geocoding sends only addresses that lack a valid cached match',async()=>{
  const sql=new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE airtable_cockpit_snapshots(snapshot_key TEXT PRIMARY KEY,payload TEXT,status TEXT,captured_at TEXT);
    CREATE TABLE route_geocode_cache(address_hash TEXT PRIMARY KEY,normalized_address TEXT,formatted_address TEXT,latitude REAL,longitude REAL,confidence REAL,match_type TEXT,provider_place_id TEXT,updated_at TEXT);`);
  const db={prepare(query){const args=[];return {bind(...values){args.splice(0,args.length,...values);return this;},async first(){return sql.prepare(query).get(...args)||null;},async all(){return {results:sql.prepare(query).all(...args)};},async run(){return sql.prepare(query).run(...args);}};}};
  const source=fs.readFileSync(new URL('../lib/route-intelligence.js',import.meta.url),'utf8').replace(/^import[\s\S]*?;\r?\n/gm,'').replace(/^export \{.*\} from .*;\r?\n/gm,'').replace(/^export /gm,'');
  const calls=[];
  const geocode=runPrivateInNewContext(source+'\ngeocodeActiveSubscriptionRouteBook',{
    routingPrivate,crypto,TextEncoder,routeBookFingerprint,
    geocodeAddress:async address=>{calls.push(address);return {ok:true,data:{latitude:41.6,longitude:-83.6,formattedAddress:address,confidence:null,matchType:'census_interpolated',placeId:''}};},
  });
  const save=(address,captured)=>sql.prepare(`INSERT INTO airtable_cockpit_snapshots VALUES ('business_cockpit',?,'success',?)
    ON CONFLICT(snapshot_key) DO UPDATE SET payload=excluded.payload,captured_at=excluded.captured_at`).run(JSON.stringify({opwp:{customers:[{id:'fictional',fields:{Status:'Active','Client Name':'Example',Address:address,City:'Toledo',State:'OH',ZIP:'43601',Frequency:'Weekly','Service Day':'Monday','Assigned Tech':'Example tech'}}]}}),captured);
  save('1 Example Street','2026-10-08T10:00:00Z');
  assert.equal((await geocode(db)).attempted,1);
  save('1 Example Street','2026-10-08T11:00:00Z');
  assert.equal((await geocode(db)).attempted,0);assert.equal(calls.length,1);
  save('2 Example Street','2026-10-08T12:00:00Z');
  assert.equal((await geocode(db)).attempted,1);assert.equal(calls.length,2);
  assert.equal((await geocode(db)).attempted,0);assert.equal(calls.length,2);
  sql.close();
});

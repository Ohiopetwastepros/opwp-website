import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
export function leadTestDatabase(){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
  for(const name of readdirSync(new URL('../../tmp/test-migrations/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../../tmp/test-migrations/'+name,import.meta.url),'utf8'));
  const totalChanges=()=>Number(sqlite.prepare('SELECT total_changes() AS changes').get().changes);
  function execute(sql,args){
    const before=totalChanges(), prepared=sqlite.prepare(sql);
    const results=prepared.columns().length?prepared.all(...args):(prepared.run(...args),[]);
    // D1 reports total changes, including writes performed by triggers. The
    // direct Statement.run().changes count would hide production claim bugs.
    return {results,meta:{changes:totalChanges()-before}};
  }
  const stmt=(sql,args=[])=>({bind:(...a)=>stmt(sql,a),first:async()=>sqlite.prepare(sql).get(...args)||null,all:async()=>execute(sql,args),run:async()=>execute(sql,args),execute:()=>execute(sql,args)});
  return {sqlite,prepare:sql=>stmt(sql),batch:async statements=>{sqlite.exec('BEGIN');try{const r=statements.map(s=>s.execute());sqlite.exec('COMMIT');return r;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
}

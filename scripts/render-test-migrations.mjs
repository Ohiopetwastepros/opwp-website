import fs from 'node:fs';
import path from 'node:path';

export function renderTestMigrations(root,mode){
  const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
  const index=read('tests/fixtures/migration-template-index.json');
  const bindings=mode==='private'?read('private/production-migrations.json').bindings:read('tests/fixtures/migration-bindings.json');
  const financial=read('lib/financial-defaults.json');
  const directory=path.join(root,'tmp/test-migrations');fs.mkdirSync(directory,{recursive:true});
  const literal=value=>typeof value==='number'&&Number.isFinite(value)?String(value):typeof value==='string'?"'"+value.replaceAll("'","''")+"'":value===null?'NULL':(()=>{throw Error('Invalid synthetic schema binding');})();
  for(const name of index.files){
    if(!/^\d{4}_[a-z0-9_]+\.sql$/.test(name))throw Error('Invalid test schema filename');
    let text=fs.readFileSync(path.join(root,'tests/fixtures/migration-templates',name+'.template'),'utf8');
    text=text.replace(/__OPWP_PRIVATE_(B\d+)__/g,(_,key)=>{if(!Object.hasOwn(bindings,key))throw Error('Missing test schema binding');return literal(bindings[key]);});
    text=text.replace(/__OPWP_FINANCIAL_([a-z0-9_]+)__/g,(_,key)=>{if(!Object.hasOwn(financial,key))throw Error('Missing financial schema fixture');return literal(financial[key]);});
    if(text.includes('__OPWP_'))throw Error('Unresolved test schema placeholder');
    const target=path.join(directory,name);
    if(!fs.existsSync(target)||fs.readFileSync(target,'utf8')!==text){
      const staging=target+'.'+process.pid+'.'+Math.random().toString(16).slice(2)+'.tmp';
      fs.writeFileSync(staging,text);fs.renameSync(staging,target);
    }
  }
  return index.files.length;
}

import fs from 'node:fs';
const root=new URL('../../',import.meta.url);
const read=file=>JSON.parse(fs.readFileSync(new URL(file,root),'utf8'));
const mode=read('tmp/private-build-inputs-manifest.json').mode;
if(!['private','synthetic'].includes(mode))throw Error('Unknown migration fixture mode');
export const migrationBindings=mode==='private'?read('private/production-migrations.json').bindings:read('tests/fixtures/migration-bindings.json');

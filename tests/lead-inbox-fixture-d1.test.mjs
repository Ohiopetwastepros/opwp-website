import test from 'node:test';
import assert from 'node:assert/strict';
import {leadTestDatabase} from './helpers/lead-inbox-fixture.mjs';

function counterDatabase(){
  const db=leadTestDatabase();
  db.sqlite.exec(`CREATE TABLE fixture_counter(id TEXT PRIMARY KEY,value INTEGER NOT NULL);
    CREATE TABLE fixture_counter_mirror(id TEXT PRIMARY KEY,value INTEGER NOT NULL);
    CREATE TRIGGER fixture_counter_insert AFTER INSERT ON fixture_counter BEGIN
      INSERT INTO fixture_counter_mirror(id,value) VALUES(NEW.id,NEW.value);
    END;
    CREATE TRIGGER fixture_counter_update AFTER UPDATE OF value ON fixture_counter BEGIN
      UPDATE fixture_counter_mirror SET value=NEW.value WHERE id=NEW.id;
    END;`);
  return db;
}

test('D1 fixture run counts direct writes plus trigger writes',async()=>{
  const db=counterDatabase();
  try{
    const result=await db.prepare('INSERT INTO fixture_counter(id,value) VALUES(?,?)').bind('example',1).run();
    assert.equal(result.meta.changes,2);
    assert.equal((await db.prepare('SELECT value FROM fixture_counter_mirror WHERE id=?').bind('example').first()).value,1);
    const ignored=await db.prepare('INSERT OR IGNORE INTO fixture_counter(id,value) VALUES(?,?)').bind('example',2).run();
    assert.equal(ignored.meta.changes,0);
    assert.equal((await db.prepare('UPDATE fixture_counter SET value=? WHERE id=?').bind(2,'missing').run()).meta.changes,0);
  }finally{db.sqlite.close();}
});

test('D1 fixture counts trigger writes for RETURNING and each batch statement',async()=>{
  const db=counterDatabase();
  try{
    const inserted=await db.prepare('INSERT INTO fixture_counter(id,value) VALUES(?,?) RETURNING id').bind('example',1).run();
    assert.equal(inserted.results[0].id,'example');
    assert.equal(inserted.meta.changes,2);
    const results=await db.batch([
      db.prepare('UPDATE fixture_counter SET value=? WHERE id=? RETURNING id').bind(2,'example'),
      db.prepare('SELECT value FROM fixture_counter_mirror WHERE id=?').bind('example'),
      db.prepare('UPDATE fixture_counter SET value=? WHERE id=?').bind(3,'missing'),
    ]);
    assert.deepEqual(results.map(result=>result.meta.changes),[2,0,0]);
    assert.equal(results[0].results[0].id,'example');
    assert.equal(results[1].results[0].value,2);
  }finally{db.sqlite.close();}
});

test('D1 fixture batch keeps trigger writes inside the transaction',async()=>{
  const db=counterDatabase();
  try{
    await assert.rejects(db.batch([
      db.prepare('INSERT INTO fixture_counter(id,value) VALUES(?,?)').bind('example',1),
      db.prepare('INSERT INTO fixture_counter(id,value) VALUES(?,?)').bind('example',2),
    ]));
    assert.equal(await db.prepare('SELECT id FROM fixture_counter WHERE id=?').bind('example').first(),null);
    assert.equal(await db.prepare('SELECT id FROM fixture_counter_mirror WHERE id=?').bind('example').first(),null);
  }finally{db.sqlite.close();}
});

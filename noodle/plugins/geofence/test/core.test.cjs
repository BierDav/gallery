const {test} = require('node:test');
const assert = require('node:assert/strict');
const {run, point, distance, KEY} = require('../src/core.cjs');
const sourceTags={one:'source-one',two:'source-two'};
const owner = 'owner', enabledAfter = '2026-10-29T00:00:00Z';
const photo = (id, latitude = 48, longitude = 16) => ({id, ownerId: owner, type: 'IMAGE',
  createdAt: '2026-10-30T00:00:00Z', exifInfo: {latitude, longitude}});
const album = (id, albumName = '!Holidays') => ({id, albumName, albumUsers: [{user: {id: owner}}]});
function fixture() {
  const f = {albums: [album('one')], members: {one: [photo('seed')]}, states: {}, added: [], writes: [], calls: [], fail: false, sources: new Set(['seed'])};
  f.api = (method, path, body) => {
    f.calls.push({method,path,body});
    if (path === '/tags') return f.albums.map(a=>({id:'source-'+a.id,value:'Standortquelle/'+a.id}));
    if (path.startsWith('/albums?assetId=')) return f.albums.filter(a=>(f.members[a.id]||[]).some(p=>p.id===decodeURIComponent(path.split('=')[1])));
    if (path === '/albums') return structuredClone(f.albums);
    const match = path.match(/^\/assets\/([^/]+)\/metadata$/);
    if (match) {
      const id = match[1];
      if (method === 'GET') return f.states[id] ? [{key: KEY, value: structuredClone(f.states[id])}] : [];
      f.states[id] = structuredClone(body.items[0].value); f.writes.push(id); return [];
    }
    if (path === '/search/metadata') return {assets: {items: structuredClone((f.members[body.albumIds[0]] || []).filter(p=>!body.tagIds || (f.sourceByAlbum?.[body.albumIds[0]] ?? f.sources).has(p.id))), nextCursor: null}};
    const a = path.match(/^\/albums\/([^/]+)\/assets$/);
    if (a) {
      assert.ok(f.states[body.ids[0]].targets.includes(a[1]), 'provenance must precede album membership');
      if (f.fail) throw new Error('network failure');
      f.added.push([a[1], body.ids[0]]);
      return [{id: body.ids[0], success: true}];
    }
    throw new Error('Unexpected request '+method+' '+path);
  };
  f.run = asset => run({trigger: 'AssetMetadataExtraction', config: {ownerId: owner, enabledAfter, sourceTags}, data: {asset}}, f.api);
  return f;
}
test('250 m inclusive, far points excluded, dateline supported', () => {
  assert.equal(distance([0,0],[0,0]),0);
  assert.ok(distance([48,16], [48.002,16]) < 250);
  assert.ok(distance([48,16], [48.003,16]) > 250);
  assert.ok(distance([0,179.999], [0,-179.999]) < 250);
  assert.equal(point(photo('a',null)),null);
  assert.deepEqual(point(photo('a',0,0)),[0,0]);
  assert.equal(point(photo('a',91)),null);
});
test('matches only prefix ! and adds nearby image', () => {
  const f=fixture(); f.albums.push(album('two','Holiday!')); f.run(photo('new',48.001));
  assert.deepEqual(f.added,[['one','new']]); assert.equal(f.states.new.done,true);
});
test('union of multiple spots, no distance drift', () => {
  const f=fixture(); f.members.one.push(photo('manual2',49,17),photo('automatic',50,18)); f.sources.add('manual2');
  f.states.automatic={done:true,targets:['one']};
  f.run(photo('near2',49.001,17)); f.run(photo('drift',50.001,18));
  assert.deepEqual(f.added,[['one','near2']]);
});
test('processing metadata does not determine source status', () => {
  const f=fixture(); f.states.seed={done:true,targets:['other-album']}; f.run(photo('new'));
  assert.equal(f.added.length,1);
});
test('old uploads, videos, other users, trash and locked images untouched', () => {
  const f=fixture();
  for(const patch of [{createdAt:enabledAfter},{createdAt:'2020-01-01T00:00:00Z'},{type:'VIDEO'},
    {ownerId:'other'},{deletedAt:'2026-10-30T00:00:00Z'},{visibility:'locked'}]) f.run({...photo('new'),...patch});
  assert.equal(f.calls.length,0);
});
test('no GPS or no match becomes final, never retrospectively matched', () => {
  const f=fixture(); f.run(photo('new',null)); f.run(photo('new'));
  f.run(photo('far',0,0)); f.members.one.push(photo('later',0,0)); f.run(photo('far',0,0));
  assert.equal(f.added.length,0);
});
test('re-extraction is a no-op; manual removal is respected', () => {
  const f=fixture(); f.run(photo('new')); f.run(photo('new'));
  assert.equal(f.added.length,1);
});
test('manual membership never becomes an automatic marker', () => {
  const f=fixture(); f.members.one.push(photo('new')); f.run(photo('new'));
  assert.deepEqual(f.states.new.targets,[]); assert.equal(f.added.length,0);
});
test('one upload can join multiple albums', () => {
  const f=fixture(); f.albums.push(album('two')); f.members.two=[photo('seed2')]; f.sources.add('seed2'); f.run(photo('new'));
  assert.deepEqual(f.added,[['one','new'],['two','new']]);
});
test('failed add is retried with persisted intent, without expanding to new albums', () => {
  const f=fixture(); f.fail=true; assert.throws(()=>f.run(photo('new')),/network/);
  assert.equal(f.states.new.done,false); f.fail=false;
  f.albums.push(album('two')); f.members.two=[photo('seed2')]; f.sources.add('seed2'); f.run(photo('new'));
  assert.deepEqual(f.added,[['one','new']]);
});
test('removing ! stops a pending retry', () => {
  const f=fixture(); f.fail=true; assert.throws(()=>f.run(photo('new')));
  f.fail=false; f.albums[0].albumName='Holidays'; f.run(photo('new')); assert.equal(f.added.length,0);
});
test('never adds to albums owned by another user', () => {
  const f=fixture(); f.albums[0].albumUsers[0].user.id='other'; f.run(photo('new')); assert.equal(f.added.length,0);
});
test('all seed pages are read, even after a location match', () => {
  const f=fixture(), original=f.api;
  f.api=(method,path,body)=>path==='/search/metadata' ? {assets: body.cursor
    ? {items:[photo('new')],nextCursor:null} : {items:[photo('seed')],nextCursor:'next'}} : original(method,path,body);
  run({trigger:'AssetMetadataExtraction',config:{ownerId:owner,enabledAfter,sourceTags},data:{asset:photo('new')}},f.api);
  assert.deepEqual(f.states.new.targets,[]);
});
test('tag lookup failure makes no additions and records no success', () => {
  const f=fixture(), original=f.api;
  f.api=(method,path,body)=>{if(path==='/tags')throw new Error('forbidden');return original(method,path,body);};
  assert.throws(()=>run({trigger:'AssetMetadataExtraction',config:{ownerId:owner,enabledAfter,sourceTags},data:{asset:photo('new')}},f.api),/forbidden/);
  assert.equal(f.added.length,0); assert.equal(f.states.new,undefined);
});
test('removing a manual seed stops matching new uploads at that location', () => {
  const f=fixture(); f.members.one.push(photo('other-seed',49,17)); f.sources.add('other-seed');
  f.run(photo('before'));
  f.members.one=f.members.one.filter(p=>p.id!=='seed');
  f.run(photo('after')); f.run(photo('other-location',49,17));
  assert.deepEqual(f.added,[['one','before'],['one','other-location']]);
});
test('removed seed cannot authorize a delayed retry', () => {
  const f=fixture(); f.fail=true; assert.throws(()=>f.run(photo('new')));
  f.fail=false; f.members.one=[]; f.run(photo('new'));
  assert.equal(f.added.length,0); assert.equal(f.states.new.done,true);
});
test('only the album source tag determines source status, even for a former auto-added image',()=>{
 const f=fixture();f.states.seed={done:true,targets:['one']};f.run(photo('new'));
 assert.equal(f.added.length,1);
 f.sources.delete('seed');f.run(photo('after-tag-removal'));assert.equal(f.added.length,1);
});
test('same image in two albums supplies only the album matching its nested tag',()=>{
 const f=fixture();f.albums.push(album('two'));f.members.two=[photo('seed')];
 f.sourceByAlbum={one:new Set(['seed']),two:new Set()};f.run(photo('new'));
 assert.deepEqual(f.added,[['one','new']]);
});

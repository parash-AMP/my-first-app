const test=require('node:test');
const assert=require('node:assert/strict');
const makeProfile=require('../personalization.js');
const {makeEnvironment,jpeg}=require('./storage-fixture.cjs');
const environment=options=>{const fixture=makeEnvironment(options);return {...fixture,api:makeProfile(fixture.env)};};

test('profile defaults are optional and saving metadata leaves original module keys untouched',()=>{
  const original='original financial and habit data',f=environment({localEntries:[['amp-personal-space-v1',original],['property-manager-v1',original],['amp-tax-v1',original]]});
  assert.deepEqual(f.api.load(),{version:1,displayName:'',status:'',avatarPhotoId:'',propertyPhotos:{}});
  const saved={...f.api.defaults(),displayName:'Parash',unknown:{keep:true}};f.api.save(saved,{expectedRaw:null});
  assert.deepEqual(f.api.load(),saved);
  for(const key of ['amp-personal-space-v1','property-manager-v1','amp-tax-v1'])assert.equal(f.map.get(key),original);
  assert.equal(f.control.docWrites,0);
});

test('optional profile status saves safely while earlier metadata without status remains valid',()=>{
  const legacy={version:1,displayName:'Parash',avatarPhotoId:'',propertyPhotos:{}};
  const raw=JSON.stringify(legacy),f=environment({localEntries:[['amp-profile-v1',raw]]});
  assert.deepEqual(f.api.load(),legacy);assert.equal(f.api.getRaw(),raw);
  f.api.save({...legacy,status:'Building good habits.'},{expectedRaw:raw});
  assert.equal(f.api.load().status,'Building good habits.');
  f.api.save({...legacy,status:'x'.repeat(160)});assert.equal(f.api.load().status.length,160);
  const saved=f.api.getRaw();
  for(const status of ['x'.repeat(161),null,42,false,{}])assert.throws(()=>f.api.save({...legacy,status}),/160 characters/);
  assert.equal(f.api.getRaw(),saved);
});

test('corrupt profile and stale edit guard refuse to overwrite existing metadata',()=>{
  const f=environment({localEntries:[['amp-profile-v1','broken JSON']]});
  assert.throws(()=>f.api.load(),/kept unchanged/);assert.throws(()=>f.api.save(f.api.defaults()),/No profile changes/);assert.equal(f.map.get('amp-profile-v1'),'broken JSON');
  f.map.delete('amp-profile-v1');f.api.save({...f.api.defaults(),displayName:'Newest'});
  assert.throws(()=>f.api.save({...f.api.defaults(),displayName:'Old'},{expectedRaw:null}),/another tab/);assert.equal(f.api.load().displayName,'Newest');
});

test('profile metadata validates photo references, names and dangerous object keys',()=>{
  const f=environment();
  for(const bad of [{...f.api.defaults(),displayName:'x'.repeat(101)},{...f.api.defaults(),avatarPhotoId:{}},{...f.api.defaults(),propertyPhotos:[]},{...f.api.defaults(),propertyPhotos:JSON.parse('{"__proto__":"photo"}') }])assert.throws(()=>f.api.save(bad));
  assert.equal(f.api.propertyKey(123),'123');assert.throws(()=>f.api.propertyKey('__proto__'));
  assert.equal(f.control.writes,0);
});

test('property and avatar photos are resized, rasterized and stored as new private JPEG Blobs',async()=>{
  const doc={id:'existing-doc',caseId:'case',blob:new Blob(['original document'])},f=environment({documents:[doc]});
  const source=new Blob([jpeg(4000,3000)],{type:'image/jpeg'});
  const property=await f.api.savePhoto(source,{kind:'property',propertyId:123});
  assert.equal(property.width,1600);assert.equal(property.height,1200);assert.equal(property.propertyId,'123');assert.equal(property.type,'image/jpeg');
  assert.equal(property.name,undefined);assert.equal(property.filename,undefined);
  const avatar=await f.api.savePhoto(source,{kind:'avatar'});
  assert.equal(avatar.width,512);assert.equal(avatar.height,384);assert.notEqual(avatar.id,property.id);
  assert.equal(f.assets('photos').length,2);assert.equal(await f.assets('documents')[0].blob.text(),'original document');
  assert.equal(f.databases.get('amp-documents').version,2);assert.equal(f.control.bitmapClosed,2);
  assert.equal((await f.api.getPhoto(property.id)).blob.type,'image/jpeg');
  assert.equal(f.map.has(f.api.storageKey),false);
});

test('SVG and spoofed image files, huge/empty images and failed canvas processing are rejected',async()=>{
  const f=environment();
  for(const file of [new Blob(['<svg></svg>'],{type:'image/svg+xml'}),new Blob(['<svg></svg>'],{type:'image/jpeg'}),new Blob([],{type:'image/jpeg'})])await assert.rejects(f.api.savePhoto(file,{kind:'avatar'}));
  const source=new Blob([jpeg()],{type:'image/jpeg'});f.control.bitmapWidth=50000;f.control.bitmapHeight=50000;
  await assert.rejects(f.api.savePhoto(source,{kind:'avatar'}),/dimensions/);
  f.control.bitmapWidth=100;f.control.bitmapHeight=100;f.control.canvasFails=true;
  await assert.rejects(f.api.savePhoto(source,{kind:'avatar'}),/compressed/);
  assert.equal(f.assets('photos').length,0);assert.equal(f.control.writes,0);
});

test('iPhone HEIC converts when browser decoding works and gives an actionable fallback otherwise',async()=>{
  const f=environment(),file=new Blob([new Uint8Array([0,0,0,24]),'ftypheic',new Uint8Array(12)],{type:'image/heic'});
  assert.equal((await f.api.savePhoto(file,{kind:'avatar'})).type,'image/jpeg');
  f.control.bitmapFails=true;
  await assert.rejects(f.api.savePhoto(file,{kind:'avatar'}),/Choose a JPEG, PNG or WebP/);
});

test('low quota and failed photo transaction retain earlier photos and profile metadata',async()=>{
  const f=environment(),source=new Blob([jpeg()],{type:'image/jpeg'}),old=await f.api.savePhoto(source,{kind:'avatar'});
  f.api.save({...f.api.defaults(),avatarPhotoId:old.id});const raw=f.api.getRaw();
  f.control.quota=1;
  await assert.rejects(f.api.savePhoto(source,{kind:'avatar'}),/Not enough browser storage/);
  f.control.quota=1e9;f.control.failCommit=true;
  await assert.rejects(f.api.savePhoto(source,{kind:'avatar'}));
  assert.equal(f.assets('photos').length,1);assert.equal(f.api.getRaw(),raw);
});

test('removing a shared referenced photo is refused until every reference is removed',async()=>{
  const f=environment(),photo=await f.api.savePhoto(new Blob([jpeg()],{type:'image/jpeg'}),{kind:'property',propertyId:'p'});
  f.api.save({...f.api.defaults(),propertyPhotos:{p:photo.id,q:photo.id}});
  assert.equal(await f.api.removePhoto(photo.id),false);assert.equal(f.assets('photos').length,1);
  f.api.save({...f.api.defaults(),propertyPhotos:{q:photo.id}});assert.equal(await f.api.removePhoto(photo.id),false);
  f.api.save(f.api.defaults());assert.equal(await f.api.removePhoto(photo.id),true);assert.equal(f.assets('photos').length,0);
});

test('metadata quota failure retains old raw profile; explicit clear removes only photos',async()=>{
  const f=environment(),source=new Blob([jpeg()],{type:'image/jpeg'});const photo=await f.api.savePhoto(source,{kind:'avatar'});
  f.api.save({...f.api.defaults(),avatarPhotoId:photo.id});const original=f.api.getRaw();let failed=false;
  f.control.failStorage=key=>{if(key===f.api.storageKey&&!failed){failed=true;return true;}return false;};
  assert.throws(()=>f.api.save({...f.api.defaults(),displayName:'Changed'}),/previous saved profile was retained/);
  assert.equal(f.api.getRaw(),original);await f.api.clearPhotos();assert.equal(f.assets('photos').length,0);
});

test('blocked database upgrades provide a close-other-tabs instruction',async()=>{
  const f=environment();f.control.blocked=true;
  await assert.rejects(f.api.getPhoto('photo'),/Close other AMP tabs/);
});

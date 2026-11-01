const test = require('node:test');
const assert = require('node:assert/strict');
const makeBackup = require('../backup.js');
const makeProfile = require('../personalization.js');
const makeAchievements = require('../achievements.js');
const {makeEnvironment,jpeg}=require('./storage-fixture.cjs');

const keys = {app:'app', property:'property', tax:'tax'};
const base = () => ({
  format:'amp-backup-v2',
  app:{version:1, habits:[{id:'habit-1', name:'Gym', extra:'retained'}], checks:{'2026-11-01':{'habit-1':true}}, goals:[{id:'goal-1',name:'Goal',steps:[{id:'step-1',name:'Step',done:true}]}], cases:[{id:'case-1',title:'Case',history:[{title:'Opened'}]}], unknown:{keep:true}},
  property:{properties:[{id:'property-1',name:'Home',model:{rate:'4.2'},extra:'retained'}], transactions:[{id:'transaction-1',propertyId:'property-1',type:'expense',amount:'25',date:'2026-10-01'}], custom:'keep'},
  tax:{version:1, years:{'2026':{salary:'50000',custom:'keep'}}},
  documents:[{id:'doc-1',caseId:'case-1',name:'letter.txt',type:'text/plain',date:'2026-10-01',size:3,data:'data:text/plain;base64,YWJj',custom:'keep'}]
});

function environment(initial = base()) {
  const decode=({data,...record})=>({...record,blob:new Blob([Buffer.from(data.split(',')[1],'base64')],{type:record.type})});
  const localEntries=Object.keys(keys).map(name=>[keys[name],JSON.stringify(initial[name])]);
  if(initial.personalization)localEntries.push(['amp-profile-v1',JSON.stringify(initial.personalization)]);
  if(initial.achievements)localEntries.push(['amp-achievements-v1',JSON.stringify(initial.achievements)]);
  const fixture=makeEnvironment({documents:initial.documents.map(decode),photos:(initial.photos||[]).map(decode),localEntries});
  fixture.env.AMPProfile=makeProfile(fixture.env);
  fixture.env.AMPAchievements=makeAchievements(fixture.env);
  return {...fixture,api:makeBackup(fixture.env),documents:()=>fixture.assets('documents'),photos:()=>fixture.assets('photos')};
}

test('complete export preserves unknown records and document bytes',async()=>{
  const original=base(), env=environment(original);
  const result=await env.api.exportPayload(original);
  assert.equal(result.format,'amp-backup-v3');
  assert.deepEqual(result.app,original.app);
  assert.deepEqual(result.property,original.property);
  assert.deepEqual(result.tax,original.tax);
  assert.deepEqual(result.documents,original.documents);
});

test('export fails rather than silently omitting unreadable documents',async()=>{
  const env=environment();env.control.failRead=true;
  await assert.rejects(env.api.exportPayload(base()));
  assert.equal(env.control.writes,0);
});

test('old AMP v1 backups remain readable and receive empty tax storage',()=>{
  const env=environment(), payload=base();payload.format='amp-backup-v1';delete payload.tax;
  const result=env.api.validate(payload);
  assert.deepEqual(result.tax,{version:1,years:{}});
  assert.deepEqual(result.property,payload.property);
  assert.deepEqual(result.app,payload.app);
});

test('legacy numeric property IDs are preserved without conversion',()=>{
  const env=environment(), payload=base();
  payload.property.properties[0].id=123;
  payload.property.transactions[0].propertyId=123;
  const result=env.api.validate(payload);
  assert.equal(result.property.properties[0].id,123);
  assert.equal(result.property.transactions[0].propertyId,123);
});

test('invalid or duplicate attachment is rejected before touching existing data',async()=>{
  for(const mutate of [p=>p.documents[0].data='data:text/plain;base64,!!!',p=>p.documents[0].size=9,p=>p.documents.push({...p.documents[0]}),p=>p.app.goals[0].steps=null]){
    const env=environment(), payload=base();mutate(payload);
    await assert.rejects(env.api.restore(payload,{storageKeys:keys}));
    assert.equal(env.control.writes,0);assert.equal(env.control.docWrites,0);
  }
});

test('successful restore retains recovery copy of all previous modules and attachments',async()=>{
  const original=base(), env=environment(original), replacement=base();
  replacement.app.habits[0].name='New';replacement.property.properties[0].name='New home';
  replacement.tax.years['2026'].salary='60000';replacement.documents=[];
  const result=await env.api.restore(replacement,{storageKeys:keys});
  for(const name of Object.keys(keys))assert.deepEqual(JSON.parse(env.map.get(keys[name])),replacement[name]);
  assert.deepEqual(env.documents(),[]);
  assert.deepEqual(result.documents,[]);
  const recovery=await env.api.readRecovery();
  for(const name of Object.keys(keys))assert.deepEqual(recovery[name],original[name]);
  assert.deepEqual(recovery.documents,original.documents);
});

test('document commit failure rolls localStorage back and keeps previous documents',async()=>{
  const original=base(), env=environment(original), replacement=base();
  replacement.app.habits=[];replacement.documents=[];env.control.failCommit=true;
  await assert.rejects(env.api.restore(replacement,{storageKeys:keys}),/previous records were restored/);
  for(const name of Object.keys(keys))assert.deepEqual(JSON.parse(env.map.get(keys[name])),original[name]);
  assert.equal(env.documents().length,1);assert.equal(env.documents()[0].id,'doc-1');
  assert.equal(await env.documents()[0].blob.text(),'abc');
  assert.ok(await env.api.readRecovery());
});

test('partial localStorage write failure rolls back without changing documents',async()=>{
  const original=base(), env=environment(original), replacement=base();replacement.app.habits=[];replacement.tax.years={};
  let failed=false;
  env.control.failStorage=key=>{if(key==='tax'&&!failed){failed=true;return true;}return false;};
  await assert.rejects(env.api.restore(replacement,{storageKeys:keys}),/previous records were restored/);
  for(const name of Object.keys(keys))assert.deepEqual(JSON.parse(env.map.get(keys[name])),original[name]);
  assert.equal(env.control.docWrites,0);assert.equal(env.documents().length,1);
});

test('refuses restore when complete recovery copy cannot be persisted',async()=>{
  const original=base(), env=environment(original);
  env.control.failRecovery=true;
  await assert.rejects(env.api.restore(base(),{storageKeys:keys}),/No records were replaced/);
  for(const name of Object.keys(keys))assert.deepEqual(JSON.parse(env.map.get(keys[name])),original[name]);
  assert.equal(env.control.docWrites,0);
});

test('invalid existing records are not silently replaced by a restore',async()=>{
  const env=environment();env.map.set('property','broken JSON');
  await assert.rejects(env.api.restore(base(),{storageKeys:keys}));
  assert.equal(env.map.get('property'),'broken JSON');assert.equal(env.control.writes,0);assert.equal(env.control.docWrites,0);
});

test('tax validation preserves supported known fields, future years, blanks and unknown fields',()=>{
  const env=environment(), payload=base();
  payload.tax.years['2035']={employment:'0',paye:'',annualRent:'1000000000',rentMode:'records',financeMode:'annual',complete:false,standard:true,transactions:{'transaction-1':{treatment:'expense',amount:'25.00',futureMetadata:'keep'}},futureMetadata:{keep:true}};
  const result=env.api.validate(payload);
  assert.deepEqual(result.tax,payload.tax);
});

test('malformed known tax fields and unsafe year keys are rejected before writes',async()=>{
  const mutations=[
    p=>p.tax.years['2026'].employment=-1,
    p=>p.tax.years['2026'].employment='-1',
    p=>p.tax.years['2026'].paye='Infinity',
    p=>p.tax.years['2026'].annualRent='1000000000.01',
    p=>p.tax.years['2026'].annualFinance={},
    p=>p.tax.years['2026'].pensionNet=' ',
    p=>p.tax.years['2026'].rentMode='anything',
    p=>p.tax.years['2026'].financeMode=null,
    p=>p.tax.years['2026'].standard='true',
    p=>p.tax.years['2026'].complete=1,
    p=>p.tax.years['2026'].transactions=[],
    p=>p.tax.years['2026'].transactions={a:{treatment:'expense',amount:''}},
    p=>p.tax.years['2026'].transactions={a:{treatment:'invalid',amount:'1'}},
    p=>p.tax.years['2026'].transactions={a:{treatment:'finance',amount:'-0.01'}},
    p=>p.tax.years['2026'].transactions={a:{treatment:'income',amount:'1000000001'}},
    p=>p.tax.years['2026'].transactions=JSON.parse('{"__proto__":{"treatment":"expense","amount":"1"}}'),
    p=>p.tax.years['2026'].transactions={a:{treatment:'review',amount:null}},
    p=>p.tax.years=JSON.parse('{"__proto__":{}}'),
    p=>p.tax.years={constructor:{}},
    p=>p.tax.years={'2026/27':{}},
    p=>p.tax.years={'next year':{}}
  ];
  for(const mutate of mutations){
    const env=environment(), payload=base();mutate(payload);
    await assert.rejects(env.api.restore(payload,{storageKeys:keys}));
    assert.equal(env.control.writes,0);assert.equal(env.control.docWrites,0);
  }
});

test('tax source evidence and explicit student loan review survive backup validation and export',async()=>{
  const payload=base();
  Object.assign(payload.tax.years['2026'],{studentLoanReviewRequired:true,studentLoanPlan:'unknown',sourceEvidence:[{kind:'payslip',filename:'payslip.pdf',taxYear:'2026',notes:'Loan repayment shown',future:{retain:true}}],futureTaxField:'retained'});
  const env=environment(payload);
  assert.deepEqual(env.api.validate(payload).tax,payload.tax);
  const exported=await env.api.exportPayload(payload);
  assert.deepEqual(exported.tax,payload.tax);
  payload.tax.years['2026'].studentLoanReviewRequired=false;
  payload.tax.years['2026'].sourceEvidence=[];
  assert.deepEqual(env.api.validate(payload).tax,payload.tax);
});

test('malformed student loan review and source evidence are rejected before writes',async()=>{
  const mutations=[
    p=>p.tax.years['2026'].studentLoanReviewRequired='true',
    p=>p.tax.years['2026'].studentLoanReviewRequired=1,
    p=>p.tax.years['2026'].studentLoanReviewRequired=null,
    p=>p.tax.years['2026'].studentLoanPlan={},
    p=>p.tax.years['2026'].studentLoanPlan=2,
    p=>p.tax.years['2026'].sourceEvidence={},
    p=>p.tax.years['2026'].sourceEvidence=['payslip.pdf'],
    p=>p.tax.years['2026'].sourceEvidence=[null],
    p=>p.tax.years['2026'].sourceEvidence=[[]],
    p=>p.tax.years['2026'].sourceEvidence=[JSON.parse('{"__proto__":{}}')],
    p=>p.tax.years['2026'].sourceEvidence=[JSON.parse('{"details":{"constructor":{}}}')]
  ];
  for(const mutate of mutations){
    const env=environment(), payload=base();mutate(payload);
    await assert.rejects(env.api.restore(payload,{storageKeys:keys}));
    assert.equal(env.control.writes,0);assert.equal(env.control.docWrites,0);
  }
});

function photo(id,kind,propertyId=''){
  const bytes=jpeg(1,1);return {id,kind,propertyId,type:'image/jpeg',size:bytes.length,width:1,height:1,createdAt:'2026-11-01T12:00:00.000Z',data:'data:image/jpeg;base64,'+Buffer.from(bytes).toString('base64')};
}
function withPhotos(){
  return {...base(),format:'amp-backup-v3',personalization:{version:1,displayName:'Parash',avatarPhotoId:'avatar-1',propertyPhotos:{'property-1':'house-1'}},photos:[photo('avatar-1','avatar'),photo('house-1','property','property-1')]};
}

test('v3 complete export preserves metadata and original compressed photo bytes',async()=>{
  const original=withPhotos(),env=environment(original),exported=await env.api.exportPayload(original);
  assert.equal(exported.format,'amp-backup-v3');assert.deepEqual(exported.personalization,original.personalization);assert.deepEqual(exported.photos,original.photos);
  assert.deepEqual(exported.app,original.app);assert.deepEqual(exported.property,original.property);assert.deepEqual(exported.tax,original.tax);
});

test('v3 profile status round-trips while older v3 metadata without status remains supported',async()=>{
  const legacy=withPhotos(),env=environment(legacy);
  assert.deepEqual(env.api.validate(legacy).personalization,legacy.personalization);
  const incoming=withPhotos();incoming.personalization.status='Making progress.';
  const restored=await env.api.restore(incoming,{storageKeys:keys});
  assert.equal(restored.personalization.status,'Making progress.');
  assert.equal((await env.api.exportPayload(restored)).personalization.status,'Making progress.');
  const invalid=withPhotos();invalid.personalization.status='x'.repeat(161);
  assert.throws(()=>env.api.validate(invalid),/160 characters/);
});

test('v3 restore commits documents/photos together and recovery keeps native Blobs outside localStorage',async()=>{
  const original=withPhotos(),env=environment(original),replacement=withPhotos();
  replacement.personalization={version:1,displayName:'New profile',avatarPhotoId:'new-avatar',propertyPhotos:{}};
  replacement.photos=[photo('new-avatar','avatar')];replacement.documents=[];
  env.control.failStorage=key=>key===env.api.recoveryKey;
  await env.api.restore(replacement,{storageKeys:{...keys,personalization:'amp-profile-v1'}});
  assert.deepEqual(JSON.parse(env.map.get('amp-profile-v1')),replacement.personalization);assert.deepEqual(env.photos().map(p=>p.id),['new-avatar']);assert.deepEqual(env.documents(),[]);
  assert.equal(env.map.has(env.api.recoveryKey),false);
  const snapshot=env.recovery();assert.equal(snapshot.photos.length,2);assert.ok(snapshot.photos[0].blob instanceof Blob);assert.equal(snapshot.photos[0].data,undefined);
  assert.ok(snapshot.documents[0].blob instanceof Blob);assert.equal(snapshot.documents[0].data,undefined);
  const recovery=await env.api.readRecovery();assert.deepEqual(recovery.photos,original.photos);assert.deepEqual(recovery.personalization,original.personalization);assert.deepEqual(recovery.documents,original.documents);
});

test('old v1 and v2 full restores preserve the current profile metadata and photos exactly',async()=>{
  for(const format of ['amp-backup-v1','amp-backup-v2']){
    const original=withPhotos(),env=environment(original),replacement={...base(),format};if(format==='amp-backup-v1')delete replacement.tax;
    const oldRaw=env.map.get('amp-profile-v1');replacement.documents=[];
    const result=await env.api.restore(replacement,{storageKeys:keys});
    assert.equal(env.map.get('amp-profile-v1'),oldRaw);assert.deepEqual(result.personalization,original.personalization);assert.deepEqual(env.photos().map(p=>p.id),['avatar-1','house-1']);
    assert.equal(await env.photos()[0].blob.arrayBuffer().then(b=>Buffer.from(b).toString('base64')),original.photos[0].data.split(',')[1]);assert.deepEqual(env.documents(),[]);
  }
});

test('photo transaction failure preserves old documents, photos and every local record key',async()=>{
  const original=withPhotos(),env=environment(original),replacement=withPhotos();replacement.photos=[];replacement.personalization={version:1,displayName:'New',avatarPhotoId:'',propertyPhotos:{}};replacement.documents=[];
  env.control.failCommit=true;
  await assert.rejects(env.api.restore(replacement,{storageKeys:keys}),/previous records were restored/);
  for(const name of Object.keys(keys))assert.deepEqual(JSON.parse(env.map.get(keys[name])),original[name]);
  assert.deepEqual(JSON.parse(env.map.get('amp-profile-v1')),original.personalization);assert.equal(env.documents().length,1);assert.equal(env.photos().length,2);assert.ok(await env.api.readRecovery());
});

test('profile metadata quota failure rolls back all local keys before any asset replacement',async()=>{
  const original=withPhotos(),env=environment(original),replacement=withPhotos();replacement.app.habits=[];replacement.personalization.displayName='New';
  let failed=false;env.control.failStorage=key=>{if(key==='amp-profile-v1'&&!failed){failed=true;return true;}return false;};
  await assert.rejects(env.api.restore(replacement,{storageKeys:keys}),/previous records were restored/);
  for(const name of Object.keys(keys))assert.deepEqual(JSON.parse(env.map.get(keys[name])),original[name]);
  assert.deepEqual(JSON.parse(env.map.get('amp-profile-v1')),original.personalization);assert.equal(env.control.docWrites,0);
});

test('quota preflight refuses replacement before recovery or original records are mutated',async()=>{
  const original=withPhotos(),env=environment(original);env.control.quota=1;
  await assert.rejects(env.api.restore(withPhotos(),{storageKeys:keys}),/No records were replaced/);
  assert.equal(env.control.writes,0);assert.equal(env.control.docWrites,0);assert.equal(env.control.recoveryWrites,0);assert.equal(env.photos().length,2);
});

test('missing references, SVG/spoofed photos and wrong dimensions are rejected before writes',async()=>{
  const mutations=[p=>p.photos=[],p=>p.photos.push({...p.photos[0]}),p=>p.photos[0].width=1601,p=>p.photos[0].width=2,p=>p.photos[0].data='data:image/svg+xml;base64,PHN2Zy8+',p=>{const bytes=Buffer.from('<svg/>');Object.assign(p.photos[0],{data:'data:image/jpeg;base64,'+bytes.toString('base64'),size:bytes.length});}];
  for(const mutate of mutations){const env=environment(),incoming=withPhotos();mutate(incoming);await assert.rejects(env.api.restore(incoming,{storageKeys:keys}));assert.equal(env.control.writes,0);assert.equal(env.control.docWrites,0);assert.equal(env.control.recoveryWrites,0);}
});

test('corrupt saved profile blocks a complete export instead of silently omitting it',async()=>{
  const env=environment();env.map.set('amp-profile-v1','broken profile');
  await assert.rejects(env.api.exportPayload({...base(),personalization:{version:1,displayName:'',avatarPhotoId:'',propertyPhotos:{}}}),/could not be read/);
  assert.equal(env.control.writes,0);
});

test('legacy local recovery stays readable and explicit recovery erase removes both generations',async()=>{
  const env=environment();env.map.set(env.api.recoveryKey,JSON.stringify({format:'amp-recovery-v1',payload:base()}));
  assert.equal((await env.api.readRecovery()).format,'amp-backup-v2');
  await env.api.restore(base(),{storageKeys:keys});assert.equal((await env.api.readRecovery()).format,'amp-backup-v3');
  await env.api.clearRecovery();assert.equal(env.map.has(env.api.recoveryKey),false);assert.equal(await env.api.readRecovery(),null);
});

const badge=(habitId='habit-1')=>({id:'7-day:'+encodeURIComponent(habitId),habitId,habitName:'Gym',kind:'week',earnedOn:'2026-10-25'});

test('v3 complete exports include saved badges without inferring any achievements from habit history',async()=>{
  const original=withPhotos();original.achievements={version:1,badges:[badge()]};
  const env=environment(original),exported=await env.api.exportPayload(original);
  assert.deepEqual(exported.achievements,original.achievements);
  assert.deepEqual(exported.app,original.app);assert.deepEqual(exported.property,original.property);assert.deepEqual(exported.tax,original.tax);
  const noSaved=environment();
  const checks={};for(let day=19;day<=25;day++)checks['2026-10-'+day]={'habit-1':true};
  const history={...base(),app:{...base().app,checks}};
  assert.deepEqual((await noSaved.api.exportPayload(history)).achievements,{version:1,badges:[]});
});

test('v1, v2 and earlier v3 restores keep current saved badges and their exact raw storage',async()=>{
  for(const format of ['amp-backup-v1','amp-backup-v2','amp-backup-v3']){
    const original=withPhotos();original.achievements={version:1,badges:[badge()]};
    const env=environment(original),incoming=format==='amp-backup-v3'?withPhotos():{...base(),format};
    if(format==='amp-backup-v1')delete incoming.tax;
    const raw=env.map.get('amp-achievements-v1');
    const restored=await env.api.restore(incoming,{storageKeys:keys});
    assert.equal(env.map.get('amp-achievements-v1'),raw);assert.deepEqual(restored.achievements,original.achievements);
    assert.deepEqual((await env.api.readRecovery()).achievements,original.achievements);
  }
});

test('explicit v3 badge restore is recoverable and rolls back the fifth key on asset failure',async()=>{
  const original=withPhotos();original.achievements={version:1,badges:[badge()]};
  const env=environment(original),incoming=withPhotos();incoming.achievements={version:1,badges:[badge('new-badge')]};
  await env.api.restore(incoming,{storageKeys:{...keys,achievements:'amp-achievements-v1'}});
  assert.deepEqual(JSON.parse(env.map.get('amp-achievements-v1')),incoming.achievements);
  assert.deepEqual(env.recovery().records.achievements,original.achievements);
  const next=withPhotos();next.achievements={version:1,badges:[]};env.control.failCommit=true;
  const raw=env.map.get('amp-achievements-v1');
  await assert.rejects(env.api.restore(next,{storageKeys:keys}),/previous records were restored/);
  assert.equal(env.map.get('amp-achievements-v1'),raw);
  assert.deepEqual((await env.api.readRecovery()).achievements,incoming.achievements);
});

test('badge storage quota failure rolls all preceding local writes back before replacing assets',async()=>{
  const original=withPhotos();original.achievements={version:1,badges:[badge()]};
  const env=environment(original),incoming=withPhotos();incoming.achievements={version:1,badges:[]};incoming.app.habits[0].name='Changed';incoming.personalization.displayName='Changed';
  let failed=false;env.control.failStorage=key=>{if(key==='amp-achievements-v1'&&!failed){failed=true;return true;}return false;};
  await assert.rejects(env.api.restore(incoming,{storageKeys:keys}),/previous records were restored/);
  assert.deepEqual(JSON.parse(env.map.get('app')),original.app);assert.deepEqual(JSON.parse(env.map.get('amp-profile-v1')),original.personalization);assert.deepEqual(JSON.parse(env.map.get('amp-achievements-v1')),original.achievements);assert.equal(env.control.docWrites,0);
});

test('malformed or corrupt saved achievement data blocks backup or restore before mutation',async()=>{
  for(const bad of [{version:1,badges:'bad'},{version:1,badges:[{...badge(),kind:'untrusted'}]},{version:1,badges:[badge(),badge()]}]){
    const env=environment(),incoming=withPhotos();incoming.achievements=bad;
    await assert.rejects(env.api.restore(incoming,{storageKeys:keys}));assert.equal(env.control.writes,0);assert.equal(env.control.docWrites,0);
  }
  const env=environment();env.map.set('amp-achievements-v1','broken badge JSON');
  await assert.rejects(env.api.exportPayload(base()));assert.equal(env.control.writes,0);
});

test('achievement storage keys must remain separate from every other persisted module',async()=>{
  const env=environment(),incoming=withPhotos();incoming.achievements={version:1,badges:[]};
  await assert.rejects(env.api.restore(incoming,{storageKeys:{...keys,achievements:'property'}}),/Invalid storage keys/);
  assert.equal(env.control.writes,0);assert.equal(env.control.docWrites,0);
});

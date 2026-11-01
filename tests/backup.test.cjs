const test = require('node:test');
const assert = require('node:assert/strict');
const makeBackup = require('../backup.js');

const keys = {app:'app', property:'property', tax:'tax'};
const base = () => ({
  format:'amp-backup-v2',
  app:{version:1, habits:[{id:'habit-1', name:'Gym', extra:'retained'}], checks:{'2026-11-01':{'habit-1':true}}, goals:[{id:'goal-1',name:'Goal',steps:[{id:'step-1',name:'Step',done:true}]}], cases:[{id:'case-1',title:'Case',history:[{title:'Opened'}]}], unknown:{keep:true}},
  property:{properties:[{id:'property-1',name:'Home',model:{rate:'4.2'},extra:'retained'}], transactions:[{id:'transaction-1',propertyId:'property-1',type:'expense',amount:'25',date:'2026-10-01'}], custom:'keep'},
  tax:{version:1, years:{'2026':{salary:'50000',custom:'keep'}}},
  documents:[{id:'doc-1',caseId:'case-1',name:'letter.txt',type:'text/plain',date:'2026-10-01',size:3,data:'data:text/plain;base64,YWJj',custom:'keep'}]
});

function environment(initial = base()) {
  const control = {failRead:false, failCommit:false, failStorage:null, writes:0, docWrites:0};
  const map = new Map(Object.keys(keys).map(name => [keys[name],JSON.stringify(initial[name])]));
  let documents = initial.documents.map(({data,...d}) => ({...d,blob:new Blob([Buffer.from(data.split(',')[1],'base64')],{type:d.type})}));
  const localStorage = {
    getItem(key){return map.get(key) ?? null;},
    setItem(key,value){control.writes++;if(control.failStorage?.(key,value))throw new Error('Quota exceeded');map.set(key,String(value));},
    removeItem(key){control.writes++;map.delete(key);}
  };
  const db = {transaction(_name,mode){
    let staged = structuredClone(documents), stopped = false;
    const actions = [];
    const tx = {error:null,abort(){stopped=true;queueMicrotask(()=>tx.onabort?.());},objectStore(){return {
      getAll(){const request={};actions.push(()=>{if(control.failRead)throw new Error('Unreadable');request.result=structuredClone(documents);request.onsuccess?.();});return request;},
      clear(){actions.push(()=>{staged=[];});return {};},
      put(document){actions.push(()=>{staged.push(structuredClone(document));});return {};}
    };}};
    setTimeout(()=>{
      if(stopped)return;
      try {
        for(const action of actions)action();
        if(mode==='readwrite'&&control.failCommit)throw new Error('Commit failed');
        if(mode==='readwrite'){documents=staged;control.docWrites++;}
        tx.oncomplete?.();
      } catch(error){tx.error=error;tx.onabort?.();}
    },0);
    return tx;
  }};
  const indexedDB = {open(){const request={};queueMicrotask(()=>{request.result=db;request.onsuccess?.();});return request;}};
  return {api:makeBackup({localStorage,indexedDB,Blob,atob,btoa}),control,map,documents:()=>documents};
}

test('complete export preserves unknown records and document bytes',async()=>{
  const original=base(), env=environment(original);
  const result=await env.api.exportPayload(original);
  assert.equal(result.format,'amp-backup-v2');
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
  const recovery=env.api.readRecovery();
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
  assert.ok(env.api.readRecovery());
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
  env.control.failStorage=key=>key===env.api.recoveryKey;
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

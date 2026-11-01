const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP_KEY='amp-personal-space-v1', PROPERTY_KEY='property-manager-v1', TAX_KEY='amp-tax-v1', PROFILE_KEY='amp-profile-v1', ACHIEVEMENTS_KEY='amp-achievements-v1', RECOVERY_KEY='amp-before-tax-v1';
const json = value => JSON.parse(JSON.stringify(value));
const fixture = () => ({
  app:{version:1,habits:[{id:'habit-1',name:'Gym',color:'#32835f',custom:'keep'}],checks:{'2026-11-01':{'habit-1':true}},goals:[{id:'goal-1',name:'Save',steps:[{id:'step-1',name:'First step',done:true}],custom:'keep'}],cases:[{id:'case-1',title:'Insurance',status:'action',history:[{date:'2026-10-01',title:'Started'}],custom:'keep'}],futureSettings:{theme:'original'}},
  property:{properties:[{id:'property-1',name:'Home',value:300000,mortgage:150000,rent:1200,payment:800,model:{baseDate:'2026-01-01',baseBalance:'150000',rate:'4.2',monthlyPayment:'800',custom:'keep'},custom:'keep'}],transactions:[{id:'rent-1',propertyId:'property-1',type:'income',category:'Rent received',amount:1200,date:'2026-04-06',note:'April rent',custom:'keep'},{id:'cost-1',propertyId:'property-1',type:'expense',category:'Maintenance',amount:100,date:'2027-04-05',note:'Repair',custom:'keep'},{id:'old-1',propertyId:'property-1',type:'expense',category:'Insurance',amount:200,date:'2026-04-05',note:'Previous year'}],futurePropertySettings:{keep:true}}
});

function harness({existingTax,existingProfile,existingAchievements,initialRecords,profileApiOverrides,failStorage,rawOverrides={},initialPhotos=[],currentDate='2026-11-01T12:00:00Z'}={}) {
  const initial=initialRecords?json(initialRecords):fixture(), initialRaw={app:JSON.stringify(initial.app,null,2),property:JSON.stringify(initial.property,null,2)};
  const store=new Map([[APP_KEY,initialRaw.app],[PROPERTY_KEY,initialRaw.property]]);
  if(existingTax)store.set(TAX_KEY,JSON.stringify(existingTax));
  if(existingProfile)store.set(PROFILE_KEY,JSON.stringify(existingProfile));
  if(existingAchievements)store.set(ACHIEVEMENTS_KEY,JSON.stringify(existingAchievements));
  for(const [key,value] of Object.entries(rawOverrides))store.set(key,value);
  const writes=[], elements=new Map(), downloads=[], documentListeners=new Map(), windowListeners=new Map();
  const element = key => {
    if(!elements.has(key))elements.set(key,{innerHTML:'',textContent:'',style:{},dataset:{},open:false,classList:{add(){},remove(){}},addEventListener(){},showModal(){this.open=true;},close(){this.open=false;},querySelector:selector=>element(key+' '+selector),querySelectorAll:()=>[],appendChild(){},click(){},remove(){}});
    return elements.get(key);
  };
  const document={querySelector:element,querySelectorAll:()=>[],addEventListener:(name,fn)=>documentListeners.set(name,fn),body:{appendChild(){}},createElement(){return {click(){downloads.at(-1).name=this.download;},remove(){}};}};
  const localStorage={getItem:key=>store.get(key)??null,setItem(key,value){if(failStorage?.(key,value))throw Error('Quota exceeded');writes.push({key,value:String(value)});store.set(key,String(value));},removeItem(key){writes.push({key,removed:true});store.delete(key);}};
  // A shared, transactional DB supports the document vault's v1-to-v2 photos upgrade.
  const databases=new Map(),dbWrites=[];
  function makeDB(name){
    const stores=new Map([['documents',new Map()]]);
    if(initialPhotos.length)stores.set('photos',new Map(initialPhotos.map(row=>[row.id,structuredClone(row)])));
    const db={version:1,objectStoreNames:{contains:key=>stores.has(key)},close(){},
      createObjectStore(key){stores.set(key,new Map());return {createIndex(){}}},
      transaction(names,mode='readonly'){
        const named=Array.isArray(names)?names:[names],staged=new Map(named.map(key=>[key,new Map(stores.get(key)||[])])),actions=[];
        let aborted=false;const tx={error:null,abort(){aborted=true;queueMicrotask(()=>tx.onabort?.())},
          objectStore(key){if(!staged.has(key))throw Error('Unknown object store: '+key);const map=staged.get(key);
            const request=fn=>{const req={};actions.push(()=>{req.result=fn();req.onsuccess?.()});return req};
            return {getAll(){return request(()=>Array.from(map.values(),value=>structuredClone(value)))},get(id){return request(()=>structuredClone(map.get(id)))},put(row){return request(()=>{map.set(row.id,structuredClone(row));return row.id})},delete(id){return request(()=>map.delete(id))},clear(){return request(()=>map.clear())}};
          }};
        queueMicrotask(()=>{if(aborted)return;try{for(const action of actions)action();if(mode==='readwrite'){for(const [key,map]of staged)stores.set(key,map);dbWrites.push({name,stores:named})}tx.oncomplete?.()}catch(e){tx.error=e;tx.onabort?.()}});return tx;
      }};return {db,stores};
  }
  const indexedDB={open(name,version=1){const request={};queueMicrotask(()=>{if(!databases.has(name))databases.set(name,makeDB(name));const {db}=databases.get(name);request.result=db;if(version>db.version){const oldVersion=db.version;db.version=version;request.onupgradeneeded?.({oldVersion,newVersion:version})}request.onsuccess?.()});return request}};
  class FormDataStub {
    constructor(form){this.values=new Map(Object.entries(form.values??{}));}
    get(key){return this.values.get(key)??null;}
    entries(){return this.values.entries();}
    [Symbol.iterator](){return this.entries();}
  }
  const nowMs=new Date(currentDate).getTime();
  class FixedDate extends Date{constructor(...args){super(...(args.length?args:[nowMs]))}static now(){return nowMs}}
  const context={Date:FixedDate,document,localStorage,indexedDB,Blob,Uint8Array,atob,btoa,Intl,URL:{createObjectURL(blob){downloads.push({blob});return 'blob:test';},revokeObjectURL(){}},FormData:FormDataStub,navigator:{},location:{hash:'',protocol:'file:'},history:{replaceState(){}},confirm:()=>true,setTimeout:()=>1,clearTimeout(){},requestAnimationFrame:fn=>fn(),crypto:{randomUUID:()=> 'generated-id'},console};
  context.window=context;context.addEventListener=(name,fn)=>windowListeners.set(name,fn);context.scrollTo=()=>{};
  vm.createContext(context);
  const base=path.join(__dirname,'..');
  for(const file of ['personalization.js','achievements.js','backup.js','enrichment.js','tax-engine.js','tax-ui.js'])vm.runInContext(fs.readFileSync(path.join(base,file),'utf8'),context,{filename:file});
  if(profileApiOverrides)context.AMPProfile={...context.AMPProfile,...profileApiOverrides};
  let source=fs.readFileSync(path.join(base,'app.js'),'utf8');
  assert.match(source,/\}\)\(\);\s*$/);
  source=source.replace(/\}\)\(\);\s*$/,`globalThis.__appTest={load,save,handleTaxSubmit,exportAll,importAll,importMissing,handleSubmit,handleAction,go,ui,render,loadProfile,saveProfileDetails,importPhoto,removeProfilePhoto,reconcileAchievements,saveBadgePoints:(...args)=>saveBadgePoints(...args),disciplineReviewRange:(...args)=>disciplineReviewRange(...args),disciplinePointsView:(...args)=>disciplinePointsView(...args),profileStatusLevel:()=>profileStatusLevel(),handleReviewSubmit:(...args)=>handleReviewSubmit(...args),state:()=>({app,property,tax,profile,profileError,profileBusy,achievements})};})();`);
  vm.runInContext(source,context,{filename:'app.js'});
  const api=context.__appTest;
  function submitTax(year='2026',overrides={}) {
    const previous=api.state().tax.years[year];
    const values={...json(context.AMPTaxUI.defaults()),...json(previous??{}),paye:'7486',paidOnAccount:'0',...overrides};
    const rows=context.AMPTaxUI.records(api.state().property,year);
    for(const [i,row] of rows.entries()){
      values['treatment_'+i]=row.type==='income'?'income':'expense';values['amount_'+i]=String(row.amount);
    }
    delete values.transactions;
    api.ui.taxYear=year;
    const event={target:{id:'taxForm',dataset:{year},values},preventDefault(){this.prevented=true;}};
    const handled=api.handleTaxSubmit(event);
    return {handled,event};
  }
  return {context,api,initial,initialRaw,store,writes,downloads,elements,submitTax,windowListeners,documentListeners,databases,dbWrites};
}

function assertLegacyUnchanged(h){
  assert.equal(h.store.get(APP_KEY),h.initialRaw.app);
  assert.equal(h.store.get(PROPERTY_KEY),h.initialRaw.property);
  assert.deepEqual(json(h.api.state().app),h.initial.app);
  assert.deepEqual(json(h.api.state().property),h.initial.property);
}

test('actual app startup loads every module and preserves exact raw legacy data without writes',()=>{
  const h=harness();
  assertLegacyUnchanged(h);
  assert.equal(h.writes.length,0);
  assert.match(h.elements.get('#main').innerHTML,/Everything moving/);
});

test('tax save classifies actual year records separately and does not alter original records',()=>{
  const h=harness();
  const {handled,event}=h.submitTax('2026',{employment:'50000',complete:'on',standard:'on'});
  assert.equal(handled,true);assert.equal(event.prevented,true);
  assertLegacyUnchanged(h);
  const tax=JSON.parse(h.store.get(TAX_KEY));
  assert.equal(tax.years['2026'].employment,'50000');
  assert.equal(tax.years['2026'].transactions['rent-1'].treatment,'income');
  assert.equal(tax.years['2026'].transactions['cost-1'].amount,'100');
  assert.equal(tax.years['2026'].transactions['old-1'],undefined);
  assert.equal(tax.years['2026'].travelActual,'0');
  assert.equal(tax.years['2026'].travelEstimate,'1000');
  assert.equal(h.writes.some(w=>[APP_KEY,PROPERTY_KEY].includes(w.key)),false);
});

test('first tax save keeps exact original raw recovery data and repeated saves are idempotent',()=>{
  const h=harness();h.submitTax();
  const recoveryRaw=h.store.get(RECOVERY_KEY),recovery=JSON.parse(recoveryRaw);
  assert.equal(recovery.app,h.initialRaw.app);assert.equal(recovery.property,h.initialRaw.property);
  h.submitTax('2026',{employment:'51000'});
  assert.equal(h.store.get(RECOVERY_KEY),recoveryRaw);
  assert.equal(h.writes.filter(w=>w.key===RECOVERY_KEY).length,1);
  assert.equal(JSON.parse(h.store.get(TAX_KEY)).years['2026'].employment,'51000');
  assertLegacyUnchanged(h);
});

test('selected tax years keep independent settings and reload retains both',()=>{
  const h=harness();h.submitTax('2026',{employment:'50000'});h.submitTax('2025',{employment:'42000'});
  const tax=JSON.parse(h.store.get(TAX_KEY));
  assert.equal(tax.years['2026'].employment,'50000');assert.equal(tax.years['2025'].employment,'42000');
  assert.equal(tax.years['2025'].transactions['old-1'].treatment,'expense');
  assert.equal(tax.years['2025'].transactions['rent-1'],undefined);
  const selection={target:{id:'taxYearForm',values:{year:'2026'}},preventDefault(){}};
  assert.equal(h.api.handleTaxSubmit(selection),true);assert.equal(h.api.ui.taxYear,'2026');
  const reloaded=harness({existingTax:tax});
  assert.deepEqual(json(reloaded.api.state().tax),tax);
  assertLegacyUnchanged(reloaded);
});

test('tax quota failure leaves raw legacy records and prior tax state unchanged',()=>{
  for(const key of [RECOVERY_KEY,TAX_KEY]){
    const h=harness({failStorage:attempt=>attempt===key});
    h.submitTax();assertLegacyUnchanged(h);
    assert.equal(h.store.has(TAX_KEY),false);
    assert.deepEqual(json(h.api.state().tax),{version:1,years:{}});
    assert.match(h.elements.get('#toast').textContent,/not saved/);
  }
  const prior={version:1,years:{'2025':{employment:'40000'}}};
  const h=harness({existingTax:prior,failStorage:key=>key===TAX_KEY});h.submitTax();
  assert.deepEqual(JSON.parse(h.store.get(TAX_KEY)),prior);assert.deepEqual(json(h.api.state().tax),prior);assertLegacyUnchanged(h);
});

test('ordinary module save preserves unknown top-level and nested fields',()=>{
  const h=harness();
  assert.equal(h.api.save(),true);
  assert.deepEqual(JSON.parse(h.store.get(APP_KEY)),h.initial.app);
  assert.deepEqual(JSON.parse(h.store.get(PROPERTY_KEY)),h.initial.property);
});

test('actual exportAll includes independent yearly tax settings and all existing module records',async()=>{
  const h=harness();h.submitTax('2026',{employment:'50000'});h.submitTax('2025',{employment:'42000'});
  await h.api.exportAll();
  assert.equal(h.downloads.length,1);
  const exported=JSON.parse(await h.downloads[0].blob.text());
  assert.equal(exported.format,'amp-backup-v3');
  assert.deepEqual(exported.app,h.initial.app);assert.deepEqual(exported.property,h.initial.property);
  assert.deepEqual(exported.tax,JSON.parse(h.store.get(TAX_KEY)));
  assert.deepEqual(exported.documents,[]);
  assert.match(h.downloads[0].name,/^AMP-backup-/);
  assertLegacyUnchanged(h);
});

test('unsupported tax year selection changes neither selected year nor saved records',()=>{
  const h=harness();const event={target:{id:'taxYearForm',values:{year:'9999'}},preventDefault(){}};
  h.api.handleTaxSubmit(event);
  assert.equal(h.api.ui.taxYear,'2026');assert.equal(h.writes.length,0);assertLegacyUnchanged(h);
});

test('corrupt existing legacy keys block ordinary save and incomplete export without overwrites',async()=>{
  for(const key of [APP_KEY,PROPERTY_KEY]){
    for(const broken of ['broken JSON',JSON.stringify({unexpected:'shape'})]){
      const h=harness({rawOverrides:{[key]:broken}});
      assert.equal(h.api.save(),false);
      assert.equal(h.store.get(key),broken);
      assert.equal(h.writes.length,0);
      assert.match(h.elements.get('#toast').textContent,/Saving stopped/);
      await h.api.exportAll();
      assert.equal(h.downloads.length,0);
      assert.equal(h.writes.length,0);
      assert.equal(h.store.get(key),broken);
      assert.match(h.elements.get('#toast').textContent,/incomplete backup/);
    }
  }
});

test('partial ordinary save failure rolls both raw legacy keys back to their exact original values',()=>{
  let failed=false;
  const h=harness({failStorage:key=>{if(key===PROPERTY_KEY&&!failed){failed=true;return true;}return false;}});
  h.api.state().app.habits[0].name='Changed habit';
  h.api.state().property.properties[0].name='Changed property';
  assert.equal(h.api.save(),false);
  assert.equal(h.store.get(APP_KEY),h.initialRaw.app);
  assert.equal(h.store.get(PROPERTY_KEY),h.initialRaw.property);
  assert.match(h.elements.get('#toast').textContent,/Previous stored records were retained/);
  assert.equal(h.writes.filter(write=>write.key===APP_KEY).length,2);
});

test('tax reviews become pending and stop deductions when the source transaction changes',()=>{
  const mutations=[
    row=>row.amount=90,
    row=>row.type='income',
    row=>row.date='2027-04-04',
    row=>row.propertyId='another-property',
    row=>row.category='Other',
    row=>row.note='Changed details'
  ];
  for(const mutate of mutations){
    const h=harness();h.submitTax();
    const state=h.api.state(),settings=state.tax.years['2026'];
    const before=h.context.AMPTaxUI.totals(settings,h.context.AMPTaxUI.records(state.property,'2026'));
    assert.equal(before.pending,0);assert.equal(before.expenses,100);
    mutate(state.property.transactions.find(row=>row.id==='cost-1'));
    const after=h.context.AMPTaxUI.totals(settings,h.context.AMPTaxUI.records(state.property,'2026'));
    assert.equal(after.pending,1);assert.equal(after.expenses,0);
    assert.equal(after.rentalIncome,1200);
    assert.equal(settings.transactions['cost-1'].amount,'100');
  }
});

test('tax totals reject stale fingerprints, excessive eligible amounts and incompatible classifications',()=>{
  const h=harness();h.submitTax();
  const state=h.api.state(),rows=h.context.AMPTaxUI.records(state.property,'2026');
  for(const override of [{source:'old fingerprint'},{amount:'101'},{amount:'NaN'},{amount:'-1'},{treatment:'income'}]){
    const settings=json(state.tax.years['2026']);Object.assign(settings.transactions['cost-1'],override);
    const result=h.context.AMPTaxUI.totals(settings,rows);
    assert.equal(result.pending,1);assert.equal(result.expenses,0);
  }
});

test('tax numeric inputs are saved canonically so exponent input remains usable in number fields',()=>{
  const h=harness();h.submitTax('2026',{employment:'5e4',annualRent:'1.2e4',travelEstimate:'1e3'});
  const saved=JSON.parse(h.store.get(TAX_KEY)).years['2026'];
  assert.equal(saved.employment,'50000');assert.equal(saved.annualRent,'12000');assert.equal(saved.travelEstimate,'1000');
  assertLegacyUnchanged(h);
});

test('an explicit student loan review requirement blocks the main January result despite confirmation flags',()=>{
  const h=harness();h.submitTax('2026',{employment:'50000',complete:'on',standard:'on'});
  const state=h.api.state(),year=state.tax.years['2026'];
  assert.equal(year.complete,true);assert.equal(year.standard,true);
  year.studentLoanReviewRequired=true;year.studentLoanPlan='unknown';
  const blocked=h.context.AMPTaxUI.render({tax:state.tax,property:state.property,year:'2026'});
  assert.match(blocked,/31 JAN 2028<\/span><div class="metric-value">—<\/div>/);
  year.studentLoanReviewRequired=false;
  const ready=h.context.AMPTaxUI.render({tax:state.tax,property:state.property,year:'2026'});
  assert.doesNotMatch(ready,/31 JAN 2028<\/span><div class="metric-value">—<\/div>/);
});


test('document-derived payroll values require explicit source review before the January headline is available',()=>{
 const h=harness({existingTax:{version:1,years:{'2026':{employment:'50000',paye:'7486',paidOnAccount:'0',sourceReviewRequired:true}}}});
 h.submitTax('2026',{complete:'on',standard:'on'});h.api.ui.taxOpen=true;h.api.ui.page='property';
 const html=h.context.AMPTaxUI.render({tax:h.api.state().tax,property:h.api.state().property,year:'2026'});
 assert.match(html,/name="sourceReviewed"/);assert.match(html,/Needs your review/);assert.equal(h.api.state().tax.years['2026'].sourceReviewRequired,true);
 h.submitTax('2026',{complete:'on',standard:'on',sourceReviewed:'on'});
 assert.equal(h.api.state().tax.years['2026'].sourceReviewRequired,false);
 assert.match(h.context.AMPTaxUI.render({tax:h.api.state().tax,property:h.api.state().property,year:'2026'}),/Current-year estimate|Estimate ready/);
 assertLegacyUnchanged(h);
});

const profileFixture=()=>({version:1,displayName:'Sample person',avatarPhotoId:'avatar-old',propertyPhotos:{'property-1':'home-old'},futureProfileField:{keep:true}});
function photoFixture(id,kind='avatar',propertyId=''){
 const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jHn8AAAAASUVORK5CYII=','base64');
 return {id,kind,propertyId,type:'image/png',size:bytes.length,width:1,height:1,createdAt:'2026-10-01T12:00:00.000Z',blob:new Blob([bytes],{type:'image/png'})};
}
function assertPrivateCoreUnchanged(h,taxRaw){assertLegacyUnchanged(h);assert.equal(h.store.get(TAX_KEY),taxRaw);}

test('profile startup loads independent metadata without writing original records or profile storage',()=>{
 const prior=profileFixture(),h=harness({existingProfile:prior});
 assert.deepEqual(json(h.api.state().profile),prior);assert.equal(h.api.state().profileError,'');
 assert.equal(h.writes.length,0);assertLegacyUnchanged(h);
});

test('saving a profile name preserves original finances, all modules, tax and photo references',()=>{
 const prior=profileFixture(),h=harness({existingProfile:prior,existingTax:{version:1,years:{'2026':{employment:'45000'}}}}),taxRaw=h.store.get(TAX_KEY);
 h.api.ui.profileExpectedRaw=h.store.get(PROFILE_KEY);
 h.api.saveProfileDetails({values:{displayName:'  Updated name  '}});
 const saved=JSON.parse(h.store.get(PROFILE_KEY));
 assert.equal(saved.displayName,'Updated name');assert.equal(saved.avatarPhotoId,prior.avatarPhotoId);assert.deepEqual(saved.propertyPhotos,prior.propertyPhotos);assert.deepEqual(saved.futureProfileField,prior.futureProfileField);
 assert.deepEqual(h.writes.map(row=>row.key),[PROFILE_KEY]);assertPrivateCoreUnchanged(h,taxRaw);
});

test('profile quota failure and stale profile form leave the previous profile and original data intact',()=>{
 const prior=profileFixture(),h=harness({existingProfile:prior,failStorage:key=>key===PROFILE_KEY}),before=h.store.get(PROFILE_KEY);
 h.api.ui.profileExpectedRaw=before;h.api.saveProfileDetails({values:{displayName:'Will not save'}});
 assert.equal(h.store.get(PROFILE_KEY),before);assert.deepEqual(json(h.api.state().profile),prior);assert.match(h.elements.get('#toast').textContent,/not saved/);assertLegacyUnchanged(h);
 const other=harness({existingProfile:prior}),original=other.store.get(PROFILE_KEY),newer={...prior,displayName:'Newer tab name'};
 other.api.ui.profileExpectedRaw=original;other.store.set(PROFILE_KEY,JSON.stringify(newer));
 other.api.saveProfileDetails({values:{displayName:'Stale form name'}});
 assert.deepEqual(JSON.parse(other.store.get(PROFILE_KEY)),newer);assert.match(other.elements.get('#toast').textContent,/another tab/);assertLegacyUnchanged(other);
});

test('an unreadable saved profile is kept unchanged while existing modules stay usable',async()=>{
 const broken='corrupt profile JSON',h=harness({rawOverrides:{[PROFILE_KEY]:broken}});
 assert.ok(h.api.state().profileError);assertLegacyUnchanged(h);assert.equal(h.writes.length,0);
 h.api.ui.profileExpectedRaw=broken;h.api.saveProfileDetails({values:{displayName:'Do not overwrite'}});
 await h.api.importPhoto(new Blob(['unused'],{type:'image/png'}),{kind:'avatar'});
 assert.equal(h.store.get(PROFILE_KEY),broken);assert.equal(h.writes.length,0);assertLegacyUnchanged(h);
});

test('a successful property photo change writes only profile metadata and preserves every original record',async()=>{
 const removed=[],calls=[],prior=profileFixture(),h=harness({existingProfile:prior,existingTax:{version:1,years:{}},profileApiOverrides:{async savePhoto(file,target){calls.push(target);return {id:'home-new'}},async removePhoto(id){removed.push(id)}}}),taxRaw=h.store.get(TAX_KEY);
 await h.api.importPhoto(new Blob(['synthetic photo'],{type:'image/png'}),{kind:'property',propertyId:'property-1'});
 const saved=JSON.parse(h.store.get(PROFILE_KEY));assert.equal(saved.propertyPhotos['property-1'],'home-new');assert.equal(saved.avatarPhotoId,'avatar-old');assert.equal(saved.displayName,prior.displayName);
 assert.deepEqual(json(calls),[{kind:'property',propertyId:'property-1'}]);assert.deepEqual(removed,['home-old']);assert.equal(h.api.state().profileBusy,false);
 assert.deepEqual(h.writes.map(row=>row.key),[PROFILE_KEY]);assertPrivateCoreUnchanged(h,taxRaw);
});

test('an unreadable or uncompressible photo cannot change metadata or original data',async()=>{
 const prior=profileFixture(),h=harness({existingProfile:prior,profileApiOverrides:{async savePhoto(){throw Error('Synthetic compression failure')}}}),before=h.store.get(PROFILE_KEY);
 await h.api.importPhoto(new Blob(['invalid'],{type:'image/png'}),{kind:'avatar'});
 assert.equal(h.store.get(PROFILE_KEY),before);assert.deepEqual(json(h.api.state().profile),prior);assert.equal(h.api.state().profileBusy,false);assert.equal(h.writes.length,0);
 assert.match(h.elements.get('#toast').textContent,/Photo was not changed/);assertLegacyUnchanged(h);
});

test('a profile metadata failure after photo creation deletes only the new orphan photo',async()=>{
 const removed=[],prior=profileFixture(),h=harness({existingProfile:prior,failStorage:key=>key===PROFILE_KEY,profileApiOverrides:{async savePhoto(){return {id:'new-orphan'}},async removePhoto(id){removed.push(id)}}}),before=h.store.get(PROFILE_KEY);
 await h.api.importPhoto(new Blob(['unused'],{type:'image/png'}),{kind:'avatar'});
 assert.deepEqual(removed,['new-orphan']);assert.equal(h.store.get(PROFILE_KEY),before);assert.deepEqual(json(h.api.state().profile),prior);assert.equal(h.api.state().profileBusy,false);assertLegacyUnchanged(h);
});

test('photo updates reject deleted property IDs and concurrent metadata edits without disturbing saved data',async()=>{
 let calls=0;const deleted=harness({existingProfile:profileFixture(),profileApiOverrides:{async savePhoto(){calls++;return {id:'unexpected'}}}}),before=deleted.store.get(PROFILE_KEY);
 await deleted.api.importPhoto(new Blob(['unused'],{type:'image/png'}),{kind:'property',propertyId:'deleted-property'});
 assert.equal(calls,0);assert.equal(deleted.store.get(PROFILE_KEY),before);assertLegacyUnchanged(deleted);
 const removed=[],prior=profileFixture();let newer,h;
 h=harness({existingProfile:prior,profileApiOverrides:{async savePhoto(){newer={...prior,displayName:'Newer in other tab'};h.store.set(PROFILE_KEY,JSON.stringify(newer));return {id:'new-orphan'}},async removePhoto(id){removed.push(id)}}});
 await h.api.importPhoto(new Blob(['unused'],{type:'image/png'}),{kind:'avatar'});
 assert.deepEqual(JSON.parse(h.store.get(PROFILE_KEY)),newer);assert.deepEqual(removed,['new-orphan']);assert.equal(h.api.state().profileBusy,false);assertLegacyUnchanged(h);
});

test('removing a profile photo preserves property photo, original data and metadata on save failure',async()=>{
 const removed=[],prior=profileFixture(),h=harness({existingProfile:prior,profileApiOverrides:{async removePhoto(id){removed.push(id)}}});
 await h.api.removeProfilePhoto({kind:'avatar'});
 const saved=JSON.parse(h.store.get(PROFILE_KEY));assert.equal(saved.avatarPhotoId,'');assert.equal(saved.propertyPhotos['property-1'],'home-old');assert.equal(saved.displayName,prior.displayName);assert.deepEqual(removed,['avatar-old']);assertLegacyUnchanged(h);
 const failedRemoved=[],failed=harness({existingProfile:prior,failStorage:key=>key===PROFILE_KEY,profileApiOverrides:{async removePhoto(id){failedRemoved.push(id)}}}),before=failed.store.get(PROFILE_KEY);
 await failed.api.removeProfilePhoto({kind:'property',propertyId:'property-1'});
 assert.equal(failed.store.get(PROFILE_KEY),before);assert.deepEqual(failedRemoved,[]);assert.deepEqual(json(failed.api.state().profile),prior);assertLegacyUnchanged(failed);
});

test('older private enrichment leaves current profile metadata and photo storage untouched',()=>{
 const prior=profileFixture(),h=harness({existingProfile:prior,initialPhotos:[photoFixture('avatar-old'),photoFixture('home-old','property','property-1')]}),profileRaw=h.store.get(PROFILE_KEY),state=h.api.state();
 const donor={format:'amp-backup-v2',app:json(state.app),property:json(state.property),tax:{version:1,years:{}},documents:[]};
 donor.property.properties[0].address='Synthetic additional address';
 const validated=h.context.AMPBackup.validate(donor),result=h.context.AMPEnrichment.mergeMissing({property:state.property,tax:state.tax},validated);
 h.context.AMPEnrichment.persistMissing(result,{storageKeys:{property:PROPERTY_KEY,tax:TAX_KEY}});
 assert.equal(h.store.get(PROFILE_KEY),profileRaw);assert.deepEqual(json(h.api.state().profile),prior);assert.equal(h.dbWrites.length,0);assert.equal(h.store.get(APP_KEY),h.initialRaw.app);
});

test('complete export includes profile metadata and photo bytes without changing original modules',async()=>{
 const prior=profileFixture(),avatar=photoFixture('avatar-old'),home=photoFixture('home-old','property','property-1'),h=harness({existingProfile:prior,initialPhotos:[avatar,home]}),before=h.store.get(PROFILE_KEY);
 await h.api.exportAll();assert.equal(h.downloads.length,1);
 const exported=JSON.parse(await h.downloads[0].blob.text());assert.equal(exported.format,'amp-backup-v3');assert.deepEqual(exported.personalization,prior);
 assert.equal(exported.photos.length,2);for(const photo of exported.photos){assert.ok(photo.data.startsWith('data:image/png;base64,'));assert.equal(Buffer.from(photo.data.split(',')[1],'base64').length,photo.size)}
 assert.deepEqual(exported.app,h.initial.app);assert.deepEqual(exported.property,h.initial.property);assert.equal(h.store.get(PROFILE_KEY),before);assertLegacyUnchanged(h);
});

test('photo actions cannot overwrite a newer profile whose storage event has not been delivered yet',async()=>{
 const prior=profileFixture(),newer={...prior,displayName:'Newer name',propertyPhotos:{...prior.propertyPhotos,'property-2':'another-newer-photo'}};
 for(const action of ['import','remove']){
  const h=harness({existingProfile:prior,profileApiOverrides:{async savePhoto(){return {id:'new-avatar'}},async removePhoto(){}}});
  h.store.set(PROFILE_KEY,JSON.stringify(newer)); // The other tab wrote before this action; its event is still queued.
  if(action==='import')await h.api.importPhoto(new Blob(['unused'],{type:'image/png'}),{kind:'avatar'});
  else await h.api.removeProfilePhoto({kind:'avatar'});
  const saved=JSON.parse(h.store.get(PROFILE_KEY));assert.equal(saved.displayName,newer.displayName);assert.equal(saved.propertyPhotos['property-2'],'another-newer-photo');assertLegacyUnchanged(h);
 }
});

test('a property deleted while its photo is prepared is not recreated or assigned a photo',async()=>{
 let h;const removed=[],prior=profileFixture();
 h=harness({existingProfile:prior,profileApiOverrides:{async savePhoto(){h.api.state().property.properties=[];return {id:'unused-property-photo'}},async removePhoto(id){removed.push(id)}}});
 const before=h.store.get(PROFILE_KEY);await h.api.importPhoto(new Blob(['unused'],{type:'image/png'}),{kind:'property',propertyId:'property-1'});
 assert.equal(h.store.get(PROFILE_KEY),before);assert.deepEqual(removed,['unused-property-photo']);assert.equal(h.api.state().property.properties.length,0);
 assert.equal(h.store.get(PROPERTY_KEY),h.initialRaw.property);assert.equal(h.store.get(APP_KEY),h.initialRaw.app);assert.equal(h.api.state().profileBusy,false);
});

test('photo preparation blocks backup actions and profile edits until it has completed',async()=>{
 let releasePhoto,reads=0;const prior=profileFixture(),h=harness({existingProfile:prior,profileApiOverrides:{savePhoto(){return new Promise(resolve=>releasePhoto=resolve)},async removePhoto(){}}});
 const upload=h.api.importPhoto(new Blob(['unused'],{type:'image/png'}),{kind:'avatar'}),before=h.store.get(PROFILE_KEY);
 assert.equal(h.api.state().profileBusy,true);h.api.ui.profileExpectedRaw=before;
 h.api.saveProfileDetails({values:{displayName:'Blocked while busy'}});
 const file={size:2,async text(){reads++;return '{}'}};
 await h.api.importAll(file);await h.api.importMissing(file);await h.api.exportAll();
 assert.equal(reads,0);assert.equal(h.downloads.length,0);assert.equal(h.store.get(PROFILE_KEY),before);assert.equal(h.writes.length,0);assertLegacyUnchanged(h);
 releasePhoto({id:'avatar-ready'});await upload;
 assert.equal(h.api.state().profileBusy,false);assert.equal(JSON.parse(h.store.get(PROFILE_KEY)).displayName,prior.displayName);assertLegacyUnchanged(h);
});

test('restore preparation blocks every profile mutation without writing profile or core records',async()=>{
 let calls=0;const prior=profileFixture(),h=harness({existingProfile:prior,profileApiOverrides:{async savePhoto(){calls++;return {id:'unexpected'}},async removePhoto(){calls++}}}),before=h.store.get(PROFILE_KEY);
 h.api.ui.restoreBusy=true;h.api.ui.profileExpectedRaw=before;
 h.api.saveProfileDetails({values:{displayName:'Blocked during restore'}});
 await h.api.importPhoto(new Blob(['unused'],{type:'image/png'}),{kind:'avatar'});await h.api.removeProfilePhoto({kind:'avatar'});
 assert.equal(calls,0);assert.equal(h.store.get(PROFILE_KEY),before);assert.equal(h.writes.length,0);assertLegacyUnchanged(h);
});

function actionEvent(action,dataset={}){
 const button={dataset:{action,...dataset}};
 return {target:{closest(selector){return selector==='[data-action]'?button:null}}};
}

test('a profile storage event refreshes metadata without replacing an unsaved tax form',()=>{
 const h=harness({existingProfile:profileFixture()}),newer={...profileFixture(),displayName:'Newer profile name',status:'Newer profile status'};
 h.api.ui.taxDirty=true;h.api.ui.taxOpen=true;h.api.ui.page='property';
 const taxDraft='<form id="taxForm">Unsaved tax edits must stay here</form>';h.elements.get('#main').innerHTML=taxDraft;
 h.store.set(PROFILE_KEY,JSON.stringify(newer));h.windowListeners.get('storage')({key:PROFILE_KEY,newValue:h.store.get(PROFILE_KEY)});
 assert.deepEqual(json(h.api.state().profile),newer);assert.equal(h.elements.get('#main').innerHTML,taxDraft);assert.equal(h.api.ui.taxDirty,true);assert.equal(h.writes.length,0);assertLegacyUnchanged(h);
});

test('both private-backup imports block profile changes while their file text is still being read',async()=>{
 for(const method of ['importAll','importMissing']){
  let finishRead,photoCalls=0;const prior=profileFixture(),h=harness({existingProfile:prior,profileApiOverrides:{async savePhoto(){photoCalls++;return {id:'unexpected'}},async removePhoto(){photoCalls++}}}),before=h.store.get(PROFILE_KEY);
  const operation=h.api[method]({size:2,text(){return new Promise(resolve=>finishRead=resolve)}});
  assert.equal(h.api.ui.restoreBusy,true);h.api.ui.profileExpectedRaw=before;
  h.api.saveProfileDetails({values:{displayName:'Must not replace name'}});
  await h.api.importPhoto(new Blob(['unused'],{type:'image/png'}),{kind:'avatar'});await h.api.removeProfilePhoto({kind:'avatar'});
  assert.equal(photoCalls,0);assert.equal(h.store.get(PROFILE_KEY),before);assert.equal(h.writes.length,0);assertLegacyUnchanged(h);
  finishRead('{}');await operation;assert.equal(h.api.ui.restoreBusy,false);assert.equal(h.store.get(PROFILE_KEY),before);assertLegacyUnchanged(h);
 }
});

test('same-page module actions and tax submissions cannot change records while a restore is active',()=>{
 const h=harness({existingTax:{version:1,years:{'2026':{employment:'50000'}}}}),beforeTax=h.store.get(TAX_KEY),beforePage=h.api.ui.page;
 h.api.ui.restoreBusy=true;
 h.api.handleAction(actionEvent('toggleHabit',{id:'habit-1',date:'2026-11-02'}));
 h.submitTax('2026',{employment:'60000'});
 h.api.ui.modal={kind:'property',id:'property-1'};
 h.api.handleSubmit({target:{id:'modalForm',values:{name:'Must not rename',value:'1',mortgage:'1',rent:'1',payment:'1'}},preventDefault(){}});
 assert.equal(h.api.save(),false);h.api.go('goals');
 assert.equal(h.api.ui.page,beforePage);assert.equal(h.store.get(TAX_KEY),beforeTax);assert.equal(h.writes.length,0);assertLegacyUnchanged(h);
});

test('opening the profile editor loads a delayed newer snapshot and keeps its photo references and status',()=>{
 const prior={...profileFixture(),status:'Earlier status'},h=harness({existingProfile:prior}),newer={...prior,displayName:'Newer name',status:'Newer status',avatarPhotoId:'newer-avatar',propertyPhotos:{'property-1':'newer-property-photo'}};
 h.store.set(PROFILE_KEY,JSON.stringify(newer));h.api.handleAction(actionEvent('profile'));
 assert.deepEqual(json(h.api.state().profile),newer);assert.equal(h.api.ui.profileExpectedRaw,JSON.stringify(newer));
 assert.match(h.elements.get('#modalContent').innerHTML,/Newer status/);assert.match(h.elements.get('#modalContent').innerHTML,/newer-avatar/);
 h.api.saveProfileDetails({values:{displayName:'Edited name',status:h.api.state().profile.status}});
 const saved=JSON.parse(h.store.get(PROFILE_KEY));assert.equal(saved.displayName,'Edited name');assert.equal(saved.status,newer.status);assert.equal(saved.avatarPhotoId,newer.avatarPhotoId);assert.deepEqual(saved.propertyPhotos,newer.propertyPhotos);assertLegacyUnchanged(h);
});

test('export loads fresh profile metadata even if another tab’s storage event has not arrived',async()=>{
 const h=harness({existingProfile:profileFixture()}),newer={...profileFixture(),avatarPhotoId:'',propertyPhotos:{},displayName:'Fresh export name',status:'Fresh export status'};
 h.store.set(PROFILE_KEY,JSON.stringify(newer));await h.api.exportAll();
 assert.equal(h.downloads.length,1);const exported=JSON.parse(await h.downloads[0].blob.text());assert.deepEqual(exported.personalization,newer);assert.deepEqual(json(h.api.state().profile),newer);assert.equal(h.writes.length,0);assertLegacyUnchanged(h);
});

function habitFixtureForDates(dates){const data=fixture();data.app.checks=Object.fromEntries(dates.map(date=>[date,{'habit-1':true}]));return data;}
const earnedWeek=()=>({version:1,badges:[{id:'7-day:habit-1',habitId:'habit-1',habitName:'Gym',kind:'week',earnedOn:'2026-10-25'}]});

test('startup awards an existing seven-day habit run using only the achievements key',()=>{
 const initial=habitFixtureForDates(['2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30','2026-10-31','2026-11-01']),h=harness({initialRecords:initial});
 assertLegacyUnchanged(h);assert.deepEqual(h.writes.map(write=>write.key),[ACHIEVEMENTS_KEY]);
 const saved=JSON.parse(h.store.get(ACHIEVEMENTS_KEY));assert.equal(saved.badges.length,1);assert.equal(saved.badges[0].habitId,'habit-1');assert.equal(saved.badges[0].earnedOn,'2026-11-01');
 assert.deepEqual(json(h.api.state().achievements),saved);assert.equal(h.elements.get('#achievementDialog')?.open||false,false);
 const before=h.writes.length;assert.equal(h.api.reconcileAchievements({celebrate:true}),false);assert.equal(h.writes.length,before);
});

test('a saved seventh-day habit toggle unlocks once and repeated toggles keep the original badge',()=>{
 const initial=habitFixtureForDates(['2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30','2026-10-31']),h=harness({initialRecords:initial});
 assert.equal(h.store.has(ACHIEVEMENTS_KEY),false);
 h.api.handleAction(actionEvent('toggleHabit',{id:'habit-1',date:'2026-11-01'}));
 assert.equal(h.api.state().app.checks['2026-11-01']['habit-1'],true);assert.equal(JSON.parse(h.store.get(APP_KEY)).checks['2026-11-01']['habit-1'],true);
 const first=h.store.get(ACHIEVEMENTS_KEY);assert.equal(JSON.parse(first).badges.length,1);assert.equal(h.elements.get('#achievementDialog').open,true);assert.match(h.elements.get('#achievementDialog').innerHTML,/ACHIEVEMENT UNLOCKED/);
 h.api.handleAction(actionEvent('toggleHabit',{id:'habit-1',date:'2026-11-01'}));
 h.api.handleAction(actionEvent('toggleHabit',{id:'habit-1',date:'2026-11-01'}));
 assert.equal(h.store.get(ACHIEVEMENTS_KEY),first);assert.equal(h.api.state().achievements.badges.length,1);assert.equal(h.writes.filter(write=>write.key===ACHIEVEMENTS_KEY).length,1);
 assert.deepEqual(json(h.api.state().property),initial.property);assert.deepEqual(json(h.api.state().app.goals),initial.app.goals);assert.deepEqual(json(h.api.state().app.cases),initial.app.cases);
});

test('future habit checkmarks cannot award a badge or count toward current progress',()=>{
 const initial=habitFixtureForDates(['2026-11-02','2026-11-03','2026-11-04','2026-11-05','2026-11-06','2026-11-07','2026-11-08']),h=harness({initialRecords:initial});
 assert.equal(h.store.has(ACHIEVEMENTS_KEY),false);assert.equal(h.api.state().achievements.badges.length,0);assert.equal(h.writes.length,0);assertLegacyUnchanged(h);
 const result=h.context.AMPAchievements.evaluate({habits:h.api.state().app.habits,checks:h.api.state().app.checks,achievements:h.api.state().achievements,today:'2026-11-01'});
 assert.equal(result.progress[0].currentStreak,0);assert.equal(result.progress[0].nextAwardCount,0);assert.equal(result.newBadges.length,0);
});

test('a failed habit save cannot award an unsaved seventh-day badge',()=>{
 const initial=habitFixtureForDates(['2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30','2026-10-31']),h=harness({initialRecords:initial,failStorage:key=>key===APP_KEY});
 h.api.handleAction(actionEvent('toggleHabit',{id:'habit-1',date:'2026-11-01'}));
 assert.equal(h.store.has(ACHIEVEMENTS_KEY),false);assert.equal(h.api.state().achievements.badges.length,0);assert.equal(h.store.get(APP_KEY),h.initialRaw.app);assert.equal(h.store.get(PROPERTY_KEY),h.initialRaw.property);
 assert.equal(h.elements.get('#achievementDialog')?.open||false,false);
});

test('badges appear in both Profile and Discipline without rewriting habit checkmarks',()=>{
 const prior=earnedWeek(),h=harness({existingAchievements:prior}),beforeApp=h.store.get(APP_KEY);
 h.api.handleAction(actionEvent('profile'));assert.match(h.elements.get('#modalContent').innerHTML,/Your badges/);assert.match(h.elements.get('#modalContent').innerHTML,/7-day consistency/);
 h.api.go('discipline');assert.match(h.elements.get('#main').innerHTML,/badge earned|badges earned/);assert.match(h.elements.get('#main').innerHTML,/role="progressbar"/);
 assert.equal(h.store.get(APP_KEY),beforeApp);assert.equal(h.store.get(ACHIEVEMENTS_KEY),JSON.stringify(prior));assert.equal(h.writes.length,0);assertLegacyUnchanged(h);
});

test('older complete backups preserve existing badges as well as profile metadata',async()=>{
 const badges=earnedWeek(),profile={...profileFixture(),avatarPhotoId:'',propertyPhotos:{}},h=harness({existingAchievements:badges,existingProfile:profile}),badgeRaw=h.store.get(ACHIEVEMENTS_KEY),profileRaw=h.store.get(PROFILE_KEY);
 const legacy={format:'amp-backup-v1',app:json(h.initial.app),property:json(h.initial.property),documents:[]},text=JSON.stringify(legacy);
 await h.api.importAll({size:Buffer.byteLength(text),async text(){return text}});
 assert.equal(h.api.ui.restoreBusy,false);assert.match(h.elements.get('#toast').textContent,/Backup restored/);
 assert.equal(h.store.get(ACHIEVEMENTS_KEY),badgeRaw);assert.equal(h.store.get(PROFILE_KEY),profileRaw);assert.deepEqual(json(h.api.state().achievements),badges);
 assert.deepEqual(json(h.api.state().app),h.initial.app);assert.deepEqual(json(h.api.state().property),h.initial.property);
});

function currentWeekBadge(){const value=earnedWeek();value.badges[0].earnedOn='2026-11-01';return value;}

test('editing badge points writes only achievement metadata and retroactively changes the displayed review',()=>{
 const badges=currentWeekBadge(),profile=profileFixture(),h=harness({existingAchievements:badges,existingProfile:profile,initialPhotos:[photoFixture('avatar-old'),photoFixture('home-old','property','property-1')],existingTax:{version:1,years:{'2026':{employment:'45000'}}}}),profileRaw=h.store.get(PROFILE_KEY),taxRaw=h.store.get(TAX_KEY);
 h.api.ui.page='discipline';h.api.ui.disciplineReviewMode='week';h.api.ui.disciplineReviewDate='2026-11-01';h.api.render();
 const before=h.api.disciplinePointsView();
 const beforeReview=h.context.AMPAchievements.review({habits:h.api.state().app.habits,checks:h.api.state().app.checks,achievements:h.api.state().achievements,start:'2026-10-26',end:'2026-11-01',today:'2026-11-01',pointsMode:'badge'});
 assert.equal(beforeReview.totalPoints,10);
 h.api.saveBadgePoints({values:{points:'35'}},'habit-1');
 const after=h.api.disciplinePointsView(),saved=JSON.parse(h.store.get(ACHIEVEMENTS_KEY));
 assert.equal(saved.pointValues['habit-1'],35);assert.deepEqual(saved.badges,badges.badges);assert.notEqual(after,before);assert.ok(h.elements.get('#main').innerHTML.includes(after));
 const afterReview=h.context.AMPAchievements.review({habits:h.api.state().app.habits,checks:h.api.state().app.checks,achievements:h.api.state().achievements,start:'2026-10-26',end:'2026-11-01',today:'2026-11-01',pointsMode:'badge'});
 assert.equal(afterReview.totalPoints,35);assert.equal(h.store.get(PROFILE_KEY),profileRaw);assert.deepEqual(json(h.api.state().profile),profile);assert.deepEqual(h.writes.map(write=>write.key),[ACHIEVEMENTS_KEY]);assert.equal(h.dbWrites.length,0);assertPrivateCoreUnchanged(h,taxRaw);
});

test('a daily check-in without an earned badge contributes no review points',()=>{
 const h=harness();h.api.ui.disciplineReviewMode='week';h.api.ui.disciplineReviewDate='2026-11-01';
 const range=h.api.disciplineReviewRange('week','2026-11-01'),result=h.context.AMPAchievements.review({habits:h.api.state().app.habits,checks:h.api.state().app.checks,achievements:h.api.state().achievements,...json(range),today:'2026-11-01',pointsMode:'badge'});
 assert.equal(result.totalCompletions,1);assert.equal(result.totalPoints,0);assert.equal(result.badges.length,0);assertLegacyUnchanged(h);
});

test('invalid and failed badge point changes retain the saved badges, profile and original module data',()=>{
 for(const points of ['-1','1.5','1001','not-a-number']){
  const h=harness({existingAchievements:currentWeekBadge(),existingProfile:profileFixture()}),before=h.store.get(ACHIEVEMENTS_KEY),profileRaw=h.store.get(PROFILE_KEY);
  h.api.saveBadgePoints({values:{points}},'habit-1');
  assert.equal(h.store.get(ACHIEVEMENTS_KEY),before);assert.equal(h.store.get(PROFILE_KEY),profileRaw);assert.equal(h.writes.length,0);assertLegacyUnchanged(h);
 }
 const h=harness({existingAchievements:currentWeekBadge(),existingProfile:profileFixture(),failStorage:key=>key===ACHIEVEMENTS_KEY}),before=h.store.get(ACHIEVEMENTS_KEY),profileRaw=h.store.get(PROFILE_KEY);
 h.api.saveBadgePoints({values:{points:'25'}},'habit-1');assert.equal(h.store.get(ACHIEVEMENTS_KEY),before);assert.equal(h.store.get(PROFILE_KEY),profileRaw);assertLegacyUnchanged(h);
});

test('review week and month selection rerenders without changing any saved records',()=>{
 const h=harness({existingAchievements:currentWeekBadge(),existingProfile:profileFixture()});h.api.ui.page='discipline';h.api.render();
 const before=h.elements.get('#main').innerHTML;
 const handled=h.api.handleReviewSubmit({target:{id:'disciplineReviewForm',values:{period:'month',reviewDate:'2026-10-15'}},preventDefault(){}});
 assert.equal(handled,true);assert.equal(h.api.ui.disciplineReviewMode,'month');assert.equal(h.api.ui.disciplineReviewDate,'2026-10-15');assert.notEqual(h.elements.get('#main').innerHTML,before);
 assert.deepEqual(json(h.api.disciplineReviewRange('week','2026-11-01')),{start:'2026-10-26',end:'2026-11-01'});
 assert.deepEqual(json(h.api.disciplineReviewRange('month','2026-10-15')),{start:'2026-10-01',end:'2026-10-31'});
 assert.equal(h.writes.length,0);assertLegacyUnchanged(h);
});

test('two weekly badges for one habit keep status based on one distinct habit',()=>{
 const dates=Array.from({length:14},(_,i)=>new Date(Date.UTC(2026,9,18+i)).toISOString().slice(0,10)),h=harness({initialRecords:habitFixtureForDates(dates)});
 const badges=h.api.state().achievements.badges;assert.equal(badges.length,2);assert.equal(new Set(badges.map(badge=>badge.habitId)).size,1);assertLegacyUnchanged(h);
 assert.equal(h.api.profileStatusLevel(),1);
 const result=h.context.AMPAchievements.review({habits:h.api.state().app.habits,checks:h.api.state().app.checks,achievements:h.api.state().achievements,start:'2026-10-01',end:'2026-10-31',today:'2026-11-01',pointsMode:'badge'});
 assert.equal(result.badges.length,2);assert.equal(result.totalPoints,20);assert.equal(h.writes.filter(write=>write.key===ACHIEVEMENTS_KEY).length,1);
});

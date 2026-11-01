const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP_KEY='amp-personal-space-v1', PROPERTY_KEY='property-manager-v1', TAX_KEY='amp-tax-v1', RECOVERY_KEY='amp-before-tax-v1';
const json = value => JSON.parse(JSON.stringify(value));
const fixture = () => ({
  app:{version:1,habits:[{id:'habit-1',name:'Gym',color:'#32835f',custom:'keep'}],checks:{'2026-11-01':{'habit-1':true}},goals:[{id:'goal-1',name:'Save',steps:[{id:'step-1',name:'First step',done:true}],custom:'keep'}],cases:[{id:'case-1',title:'Insurance',status:'action',history:[{date:'2026-10-01',title:'Started'}],custom:'keep'}],futureSettings:{theme:'original'}},
  property:{properties:[{id:'property-1',name:'Home',value:300000,mortgage:150000,rent:1200,payment:800,model:{baseDate:'2026-01-01',baseBalance:'150000',rate:'4.2',monthlyPayment:'800',custom:'keep'},custom:'keep'}],transactions:[{id:'rent-1',propertyId:'property-1',type:'income',category:'Rent received',amount:1200,date:'2026-04-06',note:'April rent',custom:'keep'},{id:'cost-1',propertyId:'property-1',type:'expense',category:'Maintenance',amount:100,date:'2027-04-05',note:'Repair',custom:'keep'},{id:'old-1',propertyId:'property-1',type:'expense',category:'Insurance',amount:200,date:'2026-04-05',note:'Previous year'}],futurePropertySettings:{keep:true}}
});

function harness({existingTax,failStorage,rawOverrides={}}={}) {
  const initial=fixture(), initialRaw={app:JSON.stringify(initial.app,null,2),property:JSON.stringify(initial.property,null,2)};
  const store=new Map([[APP_KEY,initialRaw.app],[PROPERTY_KEY,initialRaw.property]]);
  if(existingTax)store.set(TAX_KEY,JSON.stringify(existingTax));
  for(const [key,value] of Object.entries(rawOverrides))store.set(key,value);
  const writes=[], elements=new Map(), downloads=[], documentListeners=new Map(), windowListeners=new Map();
  const element = key => {
    if(!elements.has(key))elements.set(key,{innerHTML:'',textContent:'',style:{},dataset:{},open:false,classList:{add(){},remove(){}},addEventListener(){},showModal(){this.open=true;},close(){this.open=false;},querySelector:selector=>element(key+' '+selector),querySelectorAll:()=>[],appendChild(){},click(){},remove(){}});
    return elements.get(key);
  };
  const document={querySelector:element,querySelectorAll:()=>[],addEventListener:(name,fn)=>documentListeners.set(name,fn),body:{appendChild(){}},createElement(){return {click(){downloads.at(-1).name=this.download;},remove(){}};}};
  const localStorage={getItem:key=>store.get(key)??null,setItem(key,value){if(failStorage?.(key,value))throw Error('Quota exceeded');writes.push({key,value:String(value)});store.set(key,String(value));},removeItem(key){writes.push({key,removed:true});store.delete(key);}};
  // Transactional read-only document store for exercising the actual backup export path.
  const indexedDB={open(){const request={};queueMicrotask(()=>{request.result={transaction(){let read;const tx={objectStore(){return {getAll(){read={};return read;}};}};queueMicrotask(()=>{read.result=[];read.onsuccess?.();tx.oncomplete?.();});return tx;}};request.onsuccess?.();});return request;}};
  class FormDataStub {
    constructor(form){this.values=new Map(Object.entries(form.values??{}));}
    get(key){return this.values.get(key)??null;}
    entries(){return this.values.entries();}
    [Symbol.iterator](){return this.entries();}
  }
  const context={document,localStorage,indexedDB,Blob,Uint8Array,atob,btoa,Intl,URL:{createObjectURL(blob){downloads.push({blob});return 'blob:test';},revokeObjectURL(){}},FormData:FormDataStub,navigator:{},location:{hash:'',protocol:'file:'},history:{replaceState(){}},confirm:()=>true,setTimeout:()=>1,clearTimeout(){},requestAnimationFrame:fn=>fn(),crypto:{randomUUID:()=> 'generated-id'},console};
  context.window=context;context.addEventListener=(name,fn)=>windowListeners.set(name,fn);context.scrollTo=()=>{};
  vm.createContext(context);
  const base=path.join(__dirname,'..');
  for(const file of ['backup.js','tax-engine.js','tax-ui.js'])vm.runInContext(fs.readFileSync(path.join(base,file),'utf8'),context,{filename:file});
  let source=fs.readFileSync(path.join(base,'app.js'),'utf8');
  assert.match(source,/\}\)\(\);\s*$/);
  source=source.replace(/\}\)\(\);\s*$/,`globalThis.__appTest={load,save,handleTaxSubmit,exportAll,handleSubmit,handleAction,go,ui,state:()=>({app,property,tax})};})();`);
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
  return {context,api,initial,initialRaw,store,writes,downloads,elements,submitTax,windowListeners,documentListeners};
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
  assert.equal(exported.format,'amp-backup-v2');
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

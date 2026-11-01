const test = require('node:test');
const assert = require('node:assert/strict');
const makeEnrichment = require('../enrichment.js');
const copy = value => JSON.parse(JSON.stringify(value));
const fixture = () => ({
  app:{habits:[{id:'h',name:'New habit'}],cases:[{id:'c',title:'New case'}],goals:[{id:'g',name:'New goal'}]},
  property:{properties:[{id:'p',name:'New device name',address:'',lender:'Latest lender',value:300000,mortgage:123456,rent:1400,payment:900,model:{rate:'5.2',fixedEnd:'',baseBalance:'123456',monthlyPayment:'900'},unknown:{keep:true}}],transactions:[{id:'new',amount:50,date:'2026-11-01'}],unknown:'keep'},
  tax:{version:1,years:{'2026':{employment:'53000',paye:'',annualRent:'0',annualFinance:'',travelActual:'0',complete:false,standard:false,transactions:{new:{treatment:'expense',amount:'50'}},studentLoanReviewRequired:false,sourceEvidence:[{sourceUrl:'existing',title:'Latest',date:'2026-11-01',valueText:'Keep',status:'accepted'}],unknown:'keep'}},unknown:'keep'}
});
const donor = () => ({
  app:{habits:[],cases:[],goals:[]},
  property:{properties:[{id:'p',name:'Old name',address:'1 Example Road',lender:'Old lender',value:200000,mortgage:999999,rent:1000,payment:700,model:{rate:'4.2',fixedEnd:'2028-01-01',baseBalance:'999999',monthlyPayment:'700'},documentEvidence:[{title:'Mortgage letter'}]},{id:'deleted',name:'Deleted property'}],transactions:[{id:'donor',amount:999}]},
  tax:{version:1,years:{'2026':{employment:'50000',paye:'7486',annualRent:'18000',annualFinance:'5000',travelActual:'1000',complete:true,standard:true,rentMode:'annual',financeMode:'annual',transactions:{donor:{treatment:'expense',amount:'999'}},studentLoanReviewRequired:true,sourceReviewRequired:true,sourceEvidence:[{sourceUrl:'doc',title:'P60',date:'2026-04-05',valueText:'Pay £50k',status:'candidate',note:'Extracted'}]},'2025':{employment:'49000',complete:true,standard:true,transactions:{old:{treatment:'income',amount:'100'}},sourceEvidence:[{sourceUrl:'older',title:'P60',date:'2025-04-05',valueText:'49k'}]}}}
});
function environment(current=fixture(),fail) {
  const original={property:JSON.stringify(current.property,null,2),tax:JSON.stringify(current.tax,null,2)};
  const map=new Map([['property',original.property],['tax',original.tax],['app',JSON.stringify(current.app)],['untouched','keep']]);
  const writes=[];
  const api=makeEnrichment({localStorage:{getItem:key=>map.get(key)??null,setItem(key,value){if(fail?.(key,value))throw Error('Quota exceeded');writes.push({key,value});map.set(key,String(value));},removeItem(key){writes.push({key,removed:true});map.delete(key);}}});
  return {api,map,writes,original};
}
const options={storageKeys:{property:'property',tax:'tax'}};

test('fills only missing permitted property details without replacing newer device data',()=>{
  const current=fixture(),before=copy(current),env=environment(current),result=env.api.mergeMissing(current,donor());
  assert.deepEqual(current,before);
  const p=result.property.properties[0];
  assert.equal(p.address,'1 Example Road');assert.equal(p.lender,'Latest lender');assert.equal(p.model.rate,'5.2');assert.equal(p.model.fixedEnd,'2028-01-01');
  for(const key of ['name','value','mortgage','rent','payment'])assert.deepEqual(p[key],current.property.properties[0][key]);
  assert.equal(p.model.baseBalance,'123456');assert.equal(p.model.monthlyPayment,'900');
  assert.deepEqual(result.property.transactions,current.property.transactions);
  assert.deepEqual(p.documentEvidence,[{title:'Mortgage letter'}]);
  assert.equal(result.property.properties.length,1);assert.equal(result.report.propertiesSkipped,1);
  assert.equal(result.app,undefined);
});

test('preserves salary, zero, false, original classifications, and appends deduplicated review evidence',()=>{
  const current=fixture(),env=environment(current),incoming=donor();
  incoming.tax.years['2026'].sourceEvidence.push(copy(incoming.tax.years['2026'].sourceEvidence[0]));
  const result=env.api.mergeMissing(current,incoming),year=result.tax.years['2026'];
  assert.equal(year.employment,'53000');assert.equal(year.paye,'7486');assert.equal(year.annualRent,'0');assert.equal(year.annualFinance,'5000');assert.equal(year.travelActual,'0');
  assert.equal(year.complete,false);assert.equal(year.standard,false);
  assert.deepEqual(year.transactions,current.tax.years['2026'].transactions);
  assert.equal(year.studentLoanReviewRequired,true);assert.equal(year.sourceReviewRequired,true);
  assert.equal(year.sourceEvidence.length,2);assert.equal(year.sourceEvidence[0].status,'accepted');
  assert.equal(year.sourceEvidence[1].status,'review');assert.match(year.sourceEvidence[1].note,/Existing inputs kept/);
  assert.equal(year.unknown,'keep');assert.equal(result.tax.unknown,'keep');
  const added=result.tax.years['2025'];assert.equal(added.employment,'49000');assert.equal(added.complete,false);assert.equal(added.standard,false);assert.deepEqual(added.transactions,{});
});

test('does not mark annual source review when all existing annual values are already present',()=>{
  const current=fixture();current.tax.years['2026'].annualFinance='0';current.tax.years['2026'].paye='8000';
  const env=environment(current),result=env.api.mergeMissing(current,donor());
  assert.equal(result.tax.years['2026'].sourceReviewRequired,undefined);
});

test('P60 employment or PAYE candidates copied into empty fields require source review',()=>{
  for(const field of ['employment','paye']){
    const current=fixture();Object.assign(current.tax.years['2026'],{employment:'53000',paye:'8000',annualRent:'0',annualFinance:'0'});current.tax.years['2026'][field]='';
    const env=environment(current),result=env.api.mergeMissing(current,donor());
    assert.equal(result.tax.years['2026'][field],donor().tax.years['2026'][field]);
    assert.equal(result.tax.years['2026'].sourceReviewRequired,true);
  }
});

test('a newly filled mortgage rate requires confirmation while an existing newer rate stays untouched',()=>{
  const current=fixture();current.property.properties[0].model.rate='';
  const env=environment(current),result=env.api.mergeMissing(current,donor());
  assert.equal(result.property.properties[0].model.rate,'4.2');
  assert.equal(result.property.properties[0].model.rateNeedsConfirmation,true);
  assert.equal(result.property.properties[0].model.baseBalance,'123456');
  const newer=fixture(),unchanged=env.api.mergeMissing(newer,donor());
  assert.equal(unchanged.property.properties[0].model.rate,'5.2');
  assert.equal(unchanged.property.properties[0].model.rateNeedsConfirmation,undefined);
});

test('merge is idempotent and a second unchanged merge produces no storage writes',()=>{
  const current=fixture(),env=environment(current),first=env.api.mergeMissing(current,donor());env.api.persistMissing(first,options);
  const firstRecovery=env.map.get(env.api.recoveryKey),beforeWrites=env.writes.length;
  const second=env.api.mergeMissing({app:current.app,property:first.property,tax:first.tax},donor());
  assert.equal(second.report.propertyChanged,false);assert.equal(second.report.taxChanged,false);
  assert.equal(env.api.persistMissing(second,options).changed,false);
  assert.equal(env.writes.length,beforeWrites);assert.equal(env.map.get(env.api.recoveryKey),firstRecovery);
  assert.equal(env.map.get('app'),JSON.stringify(current.app));assert.equal(env.map.get('untouched'),'keep');
});

test('persists only changed property/tax keys and saves exact original raw values once',()=>{
  const current=fixture(),env=environment(current),result=env.api.mergeMissing(current,donor());
  const saved=env.api.persistMissing(result,options);
  assert.equal(saved.changed,true);assert.deepEqual(saved.writtenKeys,['property','tax']);
  const recovery=JSON.parse(env.map.get(env.api.recoveryKey));
  assert.equal(recovery.property,env.original.property);assert.equal(recovery.tax,env.original.tax);
  assert.deepEqual(env.writes.map(item=>item.key),[env.api.recoveryKey,'property','tax']);
  const more=copy(donor());more.tax.years['2024']={employment:'45000'};
  const next=env.api.mergeMissing({property:result.property,tax:result.tax},more);env.api.persistMissing(next,options);
  assert.equal(env.map.get(env.api.recoveryKey),JSON.stringify(recovery));
  assert.equal(env.writes.filter(item=>item.key===env.api.recoveryKey).length,1);
});

test('writes only tax when property has no missing details',()=>{
  const current=fixture();current.property.properties=[];
  const env=environment(current),result=env.api.mergeMissing(current,donor());
  assert.deepEqual(env.api.persistMissing(result,options).writtenKeys,['tax']);
  assert.equal(env.map.get('property'),env.original.property);
});

test('recovery copy failure causes no original record writes',()=>{
  const current=fixture(),env=environment(current,key=>key==='amp-before-enrichment-v1'),result=env.api.mergeMissing(current,donor());
  assert.throws(()=>env.api.persistMissing(result,options),/No enrichment was saved/);
  assert.equal(env.map.get('property'),env.original.property);assert.equal(env.map.get('tax'),env.original.tax);assert.equal(env.writes.length,0);
});

test('partial save failure rolls both keys back to their exact original raw values',()=>{
  let failed=false;const current=fixture(),env=environment(current,key=>{if(key==='tax'&&!failed){failed=true;return true;}return false;});
  const result=env.api.mergeMissing(current,donor());
  assert.throws(()=>env.api.persistMissing(result,options),/previous device records were retained/);
  assert.equal(env.map.get('property'),env.original.property);assert.equal(env.map.get('tax'),env.original.tax);
  assert.equal(env.map.get('app'),JSON.stringify(current.app));assert.ok(env.map.get(env.api.recoveryKey));
});

test('refuses to overwrite device edits made after enrichment was prepared',()=>{
  const current=fixture(),env=environment(current),result=env.api.mergeMissing(current,donor());
  const newer=copy(current.tax);newer.years['2026'].employment='60000';env.map.set('tax',JSON.stringify(newer));
  assert.throws(()=>env.api.persistMissing(result,options),/preserve newer edits/);
  assert.equal(env.writes.length,0);assert.equal(JSON.parse(env.map.get('tax')).years['2026'].employment,'60000');
});

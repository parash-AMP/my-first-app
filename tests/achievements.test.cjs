const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const create=require('../achievements.js');
const memory=()=>{const rows=new Map();return {getItem:k=>rows.get(k)??null,setItem:(k,v)=>rows.set(k,v),removeItem:k=>rows.delete(k),rows};};
const api=create({localStorage:memory()});
const habit={id:'gym',name:'Gym'};
const checked=(...dates)=>Object.fromEntries(dates.map(d=>[d,{gym:true}]));
const evaluate=(checks,today='2026-11-01',achievements=api.defaults(),habits=[habit])=>api.evaluate({habits,checks,today,achievements});

test('awards the first seven consecutive dates once, using the original name snapshot',()=>{
  const checks=checked('2026-10-01','2026-10-02','2026-10-03','2026-10-04','2026-10-05','2026-10-06','2026-10-07','2026-10-08');
  const first=evaluate(checks);assert.deepEqual(first.newBadges,[{id:'7-day:gym',habitId:'gym',habitName:'Gym',kind:'week',earnedOn:'2026-10-07'}]);
  const again=evaluate(checks,'2026-11-01',first.achievements);assert.equal(again.newBadges.length,0);assert.equal(again.achievements.badges.length,1);
});
test('gaps and false checkmarks break runs; later legitimate run still earns',()=>{
  const checks=checked('2026-10-01','2026-10-02','2026-10-04','2026-10-05','2026-10-06','2026-10-07','2026-10-08','2026-10-09','2026-10-10');
  checks['2026-10-03']={gym:false};assert.equal(evaluate(checks).newBadges[0].earnedOn,'2026-10-10');
});
test('future and invalid calendar dates cannot complete a badge',()=>{
  const checks=checked('2026-10-27','2026-10-28','2026-10-29','2026-10-30','2026-10-31','2026-11-01','2026-11-02','2026-02-30','2026-13-01','2026-2-01');
  const result=evaluate(checks);assert.equal(result.newBadges.length,0);assert.equal(result.progress[0].currentStreak,6);
});
test('today can be incomplete while yesterday’s streak remains in progress',()=>{
  const checks=checked('2026-10-29','2026-10-30','2026-10-31');
  assert.equal(evaluate(checks).progress[0].currentStreak,3);
  checks['2026-11-01']={gym:false};assert.equal(evaluate(checks).progress[0].currentStreak,3);
  checks['2026-11-01']={gym:true};assert.equal(evaluate(checks).progress[0].currentStreak,4);
  assert.equal(evaluate(checks,'2026-11-03').progress[0].currentStreak,0);
});
test('award progress counts toward the next seven-day block while actual streak keeps growing',()=>{
  const dates=Array.from({length:10},(_,i)=>'2026-10-'+String(i+1).padStart(2,'0'));
  const result=evaluate(checked(...dates),'2026-10-10');assert.equal(result.progress[0].currentStreak,10);assert.equal(result.progress[0].nextAwardCount,3);assert.equal(result.progress[0].earned,true);
});
test('earned records survive unchecked history, a broken streak, renames and deleted habits',()=>{
  const earned={version:1,badges:[{id:'7-day:gym',habitId:'gym',habitName:'Gym',kind:'week',earnedOn:'2026-10-07'}]};
  const renamed=evaluate({},'2026-11-01',earned,[{id:'gym',name:'Strength'}]);assert.equal(renamed.achievements.badges[0].habitName,'Gym');assert.equal(renamed.progress[0].habitName,'Strength');assert.equal(renamed.progress[0].earned,true);
  const deleted=evaluate({},'2026-11-01',earned,[]);assert.deepEqual(deleted.achievements,earned);assert.deepEqual(deleted.progress,[]);
});
test('multiple habits award independently and input data is never mutated',()=>{
  const habits=[habit,{id:'journal',name:'Journal'}],checks=checked('2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30','2026-10-31','2026-11-01');
  for(const date of Object.keys(checks))checks[date].journal=true;
  const achievements=api.defaults(),before=JSON.stringify({habits,checks,achievements});const result=evaluate(checks,'2026-11-01',achievements,habits);
  assert.equal(result.newBadges.length,2);assert.equal(JSON.stringify({habits,checks,achievements}),before);result.achievements.badges[0].habitName='Changed';assert.equal(result.newBadges[0].habitName,'Gym');
});
test('calendar arithmetic crosses leap days, years and UK DST changes',()=>{
  assert.equal(evaluate(checked('2024-02-26','2024-02-27','2024-02-28','2024-02-29','2024-03-01','2024-03-02','2024-03-03'),'2024-03-03').newBadges[0].earnedOn,'2024-03-03');
  assert.equal(evaluate(checked('2025-12-28','2025-12-29','2025-12-30','2025-12-31','2026-01-01','2026-01-02','2026-01-03'),'2026-01-03').newBadges.length,1);
  assert.equal(evaluate(checked('2026-03-26','2026-03-27','2026-03-28','2026-03-29','2026-03-30','2026-03-31','2026-04-01'),'2026-04-01').progress[0].currentStreak,7);
  assert.equal(evaluate(checked('2026-10-22','2026-10-23','2026-10-24','2026-10-25','2026-10-26','2026-10-27','2026-10-28'),'2026-10-28').progress[0].currentStreak,7);
});
test('IDs are deterministic, name independent and collision safe',()=>{
  assert.equal(api.badgeId('gym'),'7-day:gym');assert.notEqual(api.badgeId('a:b'),api.badgeId('a%3Ab'));assert.notEqual(api.badgeId('7'),api.badgeId(7));
  assert.notEqual(api.badgeId('__proto__'),api.badgeId('constructor'));
});
test('validation rejects bad dates, duplicates and inconsistent identities',()=>{
  const badge={id:'7-day:gym',habitId:'gym',habitName:'Gym',kind:'week',earnedOn:'2026-10-07'};
  for(const changes of [{earnedOn:'2026-02-29'},{earnedOn:'2026-04-31'},{earnedOn:'0000-01-01'},{kind:'other'},{id:'7-day:changed'},{habitName:0}])assert.throws(()=>api.validate({version:1,badges:[{...badge,...changes}]}));
  assert.throws(()=>api.validate({version:1,badges:[badge,badge]}));assert.throws(()=>evaluate({},'2026-02-30'));
});
test('load defaults only when absent and leaves corrupt saved records untouched',()=>{
  const localStorage=memory(),service=create({localStorage});assert.deepEqual(service.load(),service.defaults());
  localStorage.setItem(service.storageKey,'broken');assert.throws(()=>service.load(),/not changed/);assert.equal(localStorage.getItem(service.storageKey),'broken');
});
test('save guards against another tab, quota failures and failed readback',()=>{
  const localStorage=memory(),service=create({localStorage});const saved=service.save(service.defaults(),{expectedRaw:null});assert.deepEqual(service.load(),saved);
  assert.throws(()=>service.save(service.defaults(),{expectedRaw:null}),/another AMP tab/);
  assert.throws(()=>create({localStorage:{getItem:()=>null,setItem:()=>{throw Error('Quota');}}}).save(service.defaults()),/Previous saved badges and points were retained/);
  assert.throws(()=>create({localStorage:{getItem:()=>null,setItem:()=>{}}}).save(service.defaults()),/Previous saved badges and points were retained/);
});
test('loads as a browser global without CommonJS',()=>{
  const context=vm.createContext({window:{localStorage:memory()}});vm.runInContext(fs.readFileSync(require.resolve('../achievements.js'),'utf8'),context);assert.equal(context.window.AMPAchievements.storageKey,'amp-achievements-v1');assert.equal(context.window.AMPAchievements.defaults().badges.length,0);
});
test('point allocations are optional, default to ten and survive storage and award evaluation',()=>{
  assert.equal(api.pointValue(api.defaults(),'gym'),10);
  const localStorage=memory(),service=create({localStorage}),data={version:1,badges:[],pointValues:{gym:25,journal:0}};
  service.save(data,{expectedRaw:null});assert.deepEqual(service.load(),data);assert.equal(service.pointValue(data,'gym'),25);assert.equal(service.pointValue(data,'journal'),0);assert.equal(service.pointValue(data,'new-habit'),10);
  assert.deepEqual(evaluate({},'2026-11-01',data).achievements.pointValues,data.pointValues);
});
test('point validation rejects non-integers, out-of-range values and prototype-sensitive keys',()=>{
  for(const value of [-1,1001,1.5,'10',NaN,Infinity,null])assert.throws(()=>api.validate({version:1,badges:[],pointValues:{gym:value}}));
  for(const key of ['__proto__','prototype','constructor'])assert.throws(()=>api.validate(JSON.parse('{"version":1,"badges":[],"pointValues":{"'+key+'":10}}')));
  assert.throws(()=>api.validate({version:1,badges:[],pointValues:[]}));assert.equal(api.pointValue(api.defaults(),'__proto__'),10);
});
test('weekly review counts inclusive checked dates and immediately applies changed current values',()=>{
  const checks=checked('2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30','2026-10-31','2026-11-01');
  const input={habits:[habit],checks,achievements:{version:1,badges:[],pointValues:{gym:20}},start:'2026-10-26',end:'2026-11-01',today:'2026-11-01'};
  const before=JSON.stringify(input),first=api.review(input);assert.equal(first.totalPoints,140);assert.equal(first.totalCompletions,7);assert.equal(first.byHabit[0].pointValue,20);assert.equal(JSON.stringify(input),before);
  const revised=api.review({...input,achievements:{...input.achievements,pointValues:{gym:5}}});assert.equal(revised.totalPoints,35);assert.equal(revised.totalCompletions,7);
});
test('monthly review ignores invalid/future dates, unchecked values and days outside the period',()=>{
  const checks=checked('2026-10-01','2026-10-20','2026-10-31','2026-11-01','2026-09-30','2026-10-32');checks['2026-10-02']={gym:false};checks['2026-10-03']={gym:1};
  const result=api.review({habits:[habit],checks,achievements:api.defaults(),start:'2026-10-01',end:'2026-10-31',today:'2026-10-20'});
  assert.equal(result.totalCompletions,2);assert.equal(result.totalPoints,20);assert.equal(result.start,'2026-10-01');assert.equal(result.end,'2026-10-31');
});
test('completion and badge review modes use distinct earning events but the same current values',()=>{
  const checks=checked('2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30','2026-10-31','2026-11-01');
  const achievements=evaluate(checks).achievements;achievements.pointValues={gym:30};
  const input={habits:[habit],checks,achievements,start:'2026-10-26',end:'2026-11-01',today:'2026-11-01'};
  assert.equal(api.review(input).totalPoints,210);
  const badgeReview=api.review({...input,pointsMode:'badge'});assert.equal(badgeReview.totalPoints,30);assert.equal(badgeReview.totalCompletions,7);assert.equal(badgeReview.badges.length,1);
  assert.equal(api.review({...input,pointsMode:'badge',end:'2026-10-31'}).totalPoints,0);
});
test('removed habits retain badge snapshots and badge points but do not invent completion points',()=>{
  const achievements={version:1,badges:[{id:'7-day:removed',habitId:'removed',habitName:'Old task',kind:'week',earnedOn:'2026-10-10'}],pointValues:{removed:50}};
  const input={habits:[],checks:{'2026-10-10':{removed:true,unknown:true}},achievements,start:'2026-10-01',end:'2026-10-31',today:'2026-11-01'};
  assert.deepEqual(api.review(input).byHabit,[{habitId:'removed',habitName:'Old task',pointValue:50,completions:0,points:0}]);
  assert.equal(api.review({...input,pointsMode:'badge'}).totalPoints,50);
});
test('review uses current names for current habits and rejects invalid ranges or modes',()=>{
  const input={habits:[{id:'gym',name:'Strength'}],checks:{},achievements:api.defaults(),start:'2026-10-01',end:'2026-10-31',today:'2026-11-01'};
  assert.equal(api.review(input).byHabit[0].habitName,'Strength');
  for(const changes of [{start:'2026-02-30'},{start:'2026-11-01'},{today:'bad'},{pointsMode:'other'}])assert.throws(()=>api.review({...input,...changes}));
});
test('continuing streaks award non-overlapping badges at days seven, fourteen and twenty-one',()=>{
  const dates=Array.from({length:23},(_,i)=>'2026-10-'+String(i+1).padStart(2,'0'));
  const result=evaluate(checked(...dates),'2026-10-23');
  assert.deepEqual(result.newBadges.map(b=>b.earnedOn),['2026-10-07','2026-10-14','2026-10-21']);
  assert.deepEqual(result.newBadges.map(b=>b.id),['7-day:gym','7-day:gym:2026-10-14','7-day:gym:2026-10-21']);
  assert.equal(result.progress[0].currentStreak,23);assert.equal(result.progress[0].nextAwardCount,2);
  const again=evaluate(checked(...dates),'2026-10-23',result.achievements);assert.equal(again.newBadges.length,0);assert.equal(again.achievements.badges.length,3);
});
test('qualifying day resets next-award progress to zero; incomplete today preserves remaining progress',()=>{
  const dates=Array.from({length:14},(_,i)=>'2026-10-'+String(i+1).padStart(2,'0'));
  const first=evaluate(checked(...dates),'2026-10-14');assert.equal(first.progress[0].currentStreak,14);assert.equal(first.progress[0].nextAwardCount,0);
  const laterChecks=checked(...dates,'2026-10-15','2026-10-16');
  assert.equal(evaluate(laterChecks,'2026-10-17',first.achievements).progress[0].nextAwardCount,2);
});
test('legacy single-badge records resume subsequent weekly blocks without re-awarding the first',()=>{
  const legacy={version:1,badges:[{id:'7-day:gym',habitId:'gym',habitName:'Gym',kind:'week',earnedOn:'2026-10-07'}]};
  const dates=Array.from({length:14},(_,i)=>'2026-10-'+String(i+1).padStart(2,'0'));
  const result=evaluate(checked(...dates),'2026-10-14',legacy);assert.equal(result.newBadges.length,1);assert.equal(result.newBadges[0].id,'7-day:gym:2026-10-14');assert.deepEqual(result.achievements.badges[0],legacy.badges[0]);
});
test('backfilled dates cannot shift an existing award anchor and reuse consumed days',()=>{
  const dates=Array.from({length:7},(_,i)=>'2026-10-'+String(i+2).padStart(2,'0'));
  const first=evaluate(checked(...dates),'2026-10-08');assert.equal(first.newBadges[0].earnedOn,'2026-10-08');
  const edited=checked('2026-10-01',...dates,'2026-10-09','2026-10-10','2026-10-11','2026-10-12','2026-10-13','2026-10-14');
  assert.equal(evaluate(edited,'2026-10-14',first.achievements).newBadges.length,0);
  edited['2026-10-15']={gym:true};assert.equal(evaluate(edited,'2026-10-15',first.achievements).newBadges[0].earnedOn,'2026-10-15');
});
test('a removed checkmark never revokes an award or makes its dates reusable',()=>{
  const dates=Array.from({length:14},(_,i)=>'2026-10-'+String(i+1).padStart(2,'0'));
  const first=evaluate(checked(...dates),'2026-10-14');
  const edited=checked(...dates);edited['2026-10-07']={gym:false};
  const result=evaluate(edited,'2026-10-14',first.achievements);assert.equal(result.newBadges.length,0);assert.equal(result.achievements.badges.length,2);assert.equal(result.progress[0].nextAwardCount,0);
});
test('multiple weekly badges earn current point values in their own review periods',()=>{
  const dates=Array.from({length:21},(_,i)=>'2026-10-'+String(i+1).padStart(2,'0'));
  const achievements=evaluate(checked(...dates),'2026-10-21').achievements;achievements.pointValues={gym:40};
  const input={habits:[habit],checks:checked(...dates),achievements,start:'2026-10-01',end:'2026-10-31',today:'2026-10-21',pointsMode:'badge'};
  assert.equal(api.review(input).totalPoints,120);assert.equal(api.review({...input,start:'2026-10-08',end:'2026-10-14'}).totalPoints,40);
  achievements.pointValues.gym=15;assert.equal(api.review(input).totalPoints,45);
});
test('validator accepts repeated dated awards but rejects duplicate habit and earned date under alternate IDs',()=>{
  const first={id:'7-day:gym',habitId:'gym',habitName:'Gym',kind:'week',earnedOn:'2026-10-07'};
  const repeat={...first,id:'7-day:gym:2026-10-14',earnedOn:'2026-10-14'};
  assert.equal(api.validate({version:1,badges:[first,repeat]}).badges.length,2);
  assert.throws(()=>api.validate({version:1,badges:[first,{...first,id:'7-day:gym:2026-10-07'}]}));
  assert.throws(()=>api.validate({version:1,badges:[first,{...repeat,id:'7-day:gym:2026-10-15'}]}));
});
test('failed save readback restores the exact previous badge and point metadata bytes',()=>{
  const previousRaw=' { "version": 1, "badges": [{"id":"7-day:gym","habitId":"gym","habitName":"Gym","kind":"week","earnedOn":"2026-10-07"}], "pointValues": {"gym":25} } ';
  let raw=previousRaw,failNextRead=false;
  const localStorage={getItem:()=>{if(failNextRead){failNextRead=false;return 'unverified';}return raw;},setItem:(key,value)=>{raw=value;if(value!==previousRaw)failNextRead=true;},removeItem:()=>{raw=null;}};
  const service=create({localStorage}),next=service.load();next.pointValues.gym=100;
  assert.throws(()=>service.save(next,{expectedRaw:previousRaw}),/Previous saved badges and points were retained/);
  assert.equal(raw,previousRaw);assert.equal(service.load().pointValues.gym,25);assert.equal(service.load().badges.length,1);
});
test('failed first save removes the newly created key and leaves the prior absent state',()=>{
  let raw=null,failNextRead=false;
  const localStorage={getItem:()=>{if(failNextRead){failNextRead=false;return 'unverified';}return raw;},setItem:(key,value)=>{raw=value;failNextRead=true;},removeItem:()=>{raw=null;}};
  const service=create({localStorage});assert.throws(()=>service.save(service.defaults(),{expectedRaw:null}),/Previous saved badges and points were retained/);assert.equal(raw,null);
});
test('saving refuses existing corrupt metadata instead of replacing badges with defaults',()=>{
  const localStorage=memory(),service=create({localStorage});localStorage.setItem(service.storageKey,'{"version":1,"badges":"corrupt"}');
  const previousRaw=localStorage.getItem(service.storageKey);assert.throws(()=>service.save(service.defaults(),{expectedRaw:previousRaw}),/No badge or point changes were saved/);assert.equal(localStorage.getItem(service.storageKey),previousRaw);
});
test('failed write recovery reports that storage could not be recovered',()=>{
  const previousRaw=JSON.stringify(api.defaults());let raw=previousRaw,writeCount=0;
  const localStorage={getItem:()=>raw,setItem:(key,value)=>{writeCount++;if(writeCount>1)throw Error('Recovery blocked');raw='broken-write';},removeItem:()=>{throw Error('Recovery blocked');}};
  const service=create({localStorage});assert.throws(()=>service.save({...api.defaults(),pointValues:{gym:20}}),/Could not save or recover achievement storage/);assert.equal(raw,'broken-write');
});

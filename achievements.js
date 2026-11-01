/* Local achievement records. Habit checkmarks remain the source of truth. */
(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory;
  else root.AMPAchievements=factory(root);
})(typeof window==='undefined'?globalThis:window,function(env){
  'use strict';
  const storageKey='amp-achievements-v1',dayLength=86400000,target=7;
  const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  const clone=value=>JSON.parse(JSON.stringify(value));
  const validId=value=>(typeof value==='string'&&value.length>0)||(typeof value==='number'&&Number.isFinite(value));
  const safeKey=key=>typeof key==='string'&&key.length>0&&!['__proto__','prototype','constructor'].includes(key);
  const has=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
  function badgeId(habitId,earnedOn){
    if(!validId(habitId))throw Error('Invalid achievement habit ID');
    // Encode the ID, not the name: renaming a habit never creates a new award.
    // The numeric prefix also keeps numeric 7 distinct from the string "7".
    const id='7-day:'+(typeof habitId==='number'?'#'+habitId:encodeURIComponent(habitId));
    if(earnedOn===undefined)return id;
    if(dayNumber(earnedOn)===null)throw Error('Invalid achievement award date');
    return id+':'+earnedOn;
  }
  function dayNumber(date){
    if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||date.slice(0,4)==='0000')return null;
    const ms=Date.parse(date+'T00:00:00.000Z');
    if(!Number.isFinite(ms)||new Date(ms).toISOString().slice(0,10)!==date)return null;
    return ms/dayLength;
  }
  const dateForDay=day=>new Date(day*dayLength).toISOString().slice(0,10);
  const defaults=()=>({version:1,badges:[]});
  function validate(data){
    if(!object(data)||data.version!==1||!Array.isArray(data.badges))throw Error('Invalid AMP achievement records');
    if(data.pointValues!==undefined){
      if(!object(data.pointValues))throw Error('Invalid habit point allocations');
      for(const [key,value] of Object.entries(data.pointValues)){
        if(!safeKey(key)||!Number.isInteger(value)||value<0||value>1000)throw Error('Habit points must be whole numbers from 0 to 1000 with a valid habit ID');
      }
    }
    const ids=new Set(),habitDates=new Set();
    for(const badge of data.badges){
      if(!object(badge)||!validId(badge.habitId)||badge.kind!=='week'||typeof badge.habitName!=='string'||dayNumber(badge.earnedOn)===null)throw Error('Invalid AMP achievement badge');
      const habitDate=badgeId(badge.habitId,badge.earnedOn);
      if((badge.id!==badgeId(badge.habitId)&&badge.id!==habitDate)||ids.has(badge.id)||habitDates.has(habitDate))throw Error('Invalid or duplicate AMP achievement badge');
      ids.add(badge.id);
      habitDates.add(habitDate);
    }
    return clone(data);
  }
  function currentValue(data,habitId){
    if(!validId(habitId))throw Error('Invalid achievement habit ID');
    const key=String(habitId);
    return safeKey(key)&&data.pointValues&&has(data.pointValues,key)?data.pointValues[key]:10;
  }
  function pointValue(achievements,habitId){
    return currentValue(validate(achievements),habitId);
  }
  function storage(){
    if(!env.localStorage)throw Error('Achievement storage is unavailable');
    return env.localStorage;
  }
  function load(){
    const raw=storage().getItem(storageKey);
    if(raw===null)return defaults();
    try{return validate(JSON.parse(raw));}
    catch(error){throw Error('Saved achievements could not be read. Existing records were not changed.');}
  }
  function save(data,options={}){
    const clean=validate(data),store=storage(),previousRaw=store.getItem(storageKey);
    if(previousRaw!==null){
      try{validate(JSON.parse(previousRaw));}
      catch(error){throw Error('Existing achievements could not be read. No badge or point changes were saved.');}
    }
    if(Object.prototype.hasOwnProperty.call(options,'expectedRaw')&&previousRaw!==options.expectedRaw)throw Error('Achievements changed in another AMP tab. Reload before saving.');
    const raw=JSON.stringify(clean);
    if(raw===previousRaw)return clean;
    try{
      store.setItem(storageKey,raw);
      if(store.getItem(storageKey)!==raw)throw Error('Could not verify saved achievements');
    }catch(error){
      let retained=false;
      try{
        // A quota failure may have left the exact previous value in place.
        // Otherwise undo this write, including removing a newly created key.
        if(store.getItem(storageKey)!==previousRaw){
          if(previousRaw===null)store.removeItem(storageKey);
          else store.setItem(storageKey,previousRaw);
        }
        retained=store.getItem(storageKey)===previousRaw;
      }catch(recoveryError){retained=false;}
      throw Error(retained?'Could not save achievements. Previous saved badges and points were retained.':'Could not save or recover achievement storage. Keep this browser data and restore from your backup.');
    }
    return clean;
  }
  function evaluate({habits,checks,achievements,today}){
    const lastDay=dayNumber(today);
    if(lastDay===null)throw Error('Enter a real calendar date for achievements');
    if(!Array.isArray(habits)||!object(checks))throw Error('Invalid habits or checkmarks');
    const result=validate(achievements===undefined?defaults():achievements),newBadges=[],progress=[];
    const earnedHabits=new Set(result.badges.map(badge=>badge.habitId)),habitIds=new Set();
    const dates=Object.keys(checks).map(date=>({date,day:dayNumber(date)})).filter(entry=>entry.day!==null&&entry.day<=lastDay&&object(checks[entry.date])).sort((a,b)=>a.day-b.day);
    for(const habit of habits){
      if(!object(habit)||!validId(habit.id)||typeof habit.name!=='string'||habitIds.has(habit.id))throw Error('Invalid or duplicate habit');
      habitIds.add(habit.id);
      const checkedDays=new Set(),consumedDays=new Set();
      // An awarded week remains earned even if old checkmarks later change.
      // Reserve that exact seven-day block so backdating cannot earn it twice.
      for(const badge of result.badges){
        if(badge.habitId===habit.id){
          const end=dayNumber(badge.earnedOn);
          for(let day=end-target+1;day<=end;day++)consumedDays.add(day);
        }
      }
      let run=0,previousDay=null;
      for(const entry of dates){
        if(!Object.prototype.hasOwnProperty.call(checks[entry.date],habit.id)||checks[entry.date][habit.id]!==true)continue;
        checkedDays.add(entry.day);
        if(consumedDays.has(entry.day)){run=0;previousDay=null;continue;}
        run=previousDay!==null&&entry.day===previousDay+1?run+1:1;
        previousDay=entry.day;
        if(run===target){
          const earnedOn=dateForDay(entry.day);
          // Keep the original first-badge ID compatible with existing exports.
          const id=earnedHabits.has(habit.id)?badgeId(habit.id,earnedOn):badgeId(habit.id);
          const badge={id,habitId:habit.id,habitName:habit.name,kind:'week',earnedOn};
          result.badges.push(badge);newBadges.push({...badge});earnedHabits.add(habit.id);
          for(let day=entry.day-target+1;day<=entry.day;day++)consumedDays.add(day);
          run=0;previousDay=null;
        }
      }
      let cursor=checkedDays.has(lastDay)?lastDay:lastDay-1,currentStreak=0;
      while(checkedDays.has(cursor)){currentStreak++;cursor--;}
      cursor=checkedDays.has(lastDay)?lastDay:lastDay-1;
      let nextAwardCount=0;
      while(checkedDays.has(cursor)&&!consumedDays.has(cursor)){nextAwardCount++;cursor--;}
      progress.push({habitId:habit.id,habitName:habit.name,currentStreak,nextAwardCount,target,earned:earnedHabits.has(habit.id)});
    }
    return {achievements:result,newBadges,progress};
  }
  function review({habits,checks,achievements,start,end,today,pointsMode='completion'}){
    const startDay=dayNumber(start),endDay=dayNumber(end),lastDay=dayNumber(today);
    if(startDay===null||endDay===null||lastDay===null||startDay>endDay)throw Error('Choose a valid inclusive review date range');
    if(!['completion','badge'].includes(pointsMode))throw Error('Choose completion or badge points');
    if(!Array.isArray(habits)||!object(checks))throw Error('Invalid habits or checkmarks');
    const clean=validate(achievements===undefined?defaults():achievements),byHabit=[],rows=new Map(),currentIds=new Set();
    for(const habit of habits){
      if(!object(habit)||!validId(habit.id)||typeof habit.name!=='string'||currentIds.has(habit.id))throw Error('Invalid or duplicate habit');
      currentIds.add(habit.id);
      const row={habitId:habit.id,habitName:habit.name,pointValue:currentValue(clean,habit.id),completions:0,points:0};
      byHabit.push(row);rows.set(habit.id,row);
    }
    // Retained badge names preserve context for removed habits. Old unlinked
    // checkmarks cannot safely recover a removed habit's name or identity.
    for(const badge of clean.badges){
      if(!rows.has(badge.habitId)){
        const row={habitId:badge.habitId,habitName:badge.habitName,pointValue:currentValue(clean,badge.habitId),completions:0,points:0};
        byHabit.push(row);rows.set(badge.habitId,row);
      }
    }
    for(const [date,values] of Object.entries(checks)){
      const day=dayNumber(date);
      if(day===null||day<startDay||day>endDay||day>lastDay||!object(values))continue;
      // Count currently defined habits only. Removal may also have removed the
      // original app's checkmarks; no historical completions are invented.
      for(const habit of habits){
        if(has(values,habit.id)&&values[habit.id]===true)rows.get(habit.id).completions++;
      }
    }
    const badges=clean.badges.filter(badge=>{
      const day=dayNumber(badge.earnedOn);
      return day>=startDay&&day<=endDay&&day<=lastDay;
    }).map(badge=>({...badge}));
    if(pointsMode==='completion'){
      for(const row of byHabit)row.points=row.completions*row.pointValue;
    }else{
      for(const badge of badges)rows.get(badge.habitId).points+=currentValue(clean,badge.habitId);
    }
    return {start,end,totalPoints:byHabit.reduce((sum,row)=>sum+row.points,0),totalCompletions:byHabit.reduce((sum,row)=>sum+row.completions,0),byHabit,badges};
  }
  return Object.freeze({storageKey,defaults,validate,load,save,evaluate,badgeId,pointValue,review});
});

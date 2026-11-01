/* Complete AMP backups. No network requests; documents stay on this device. */
(function(root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.AMPBackup = factory(root);
})(typeof window === 'undefined' ? globalThis : window, function(env) {
  'use strict';
  const RECOVERY_KEY = 'amp-before-restore-v1';
  let pendingDB, pendingRecoveryDB, restoring = false;
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const clone = value => JSON.parse(JSON.stringify(value));
  const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
  const validKey = value => typeof value === 'string' && value.length > 0;
  // Older property app versions may use numeric IDs. Preserve their type exactly.
  const validId = value => validKey(value) || (typeof value === 'number' && Number.isFinite(value));
  const safeKey = key => !['__proto__','prototype','constructor'].includes(key);
  const safeTree = value => Array.isArray(value) ? value.every(safeTree) : !object(value) ||
    Object.entries(value).every(([key, nested]) => safeKey(key) && safeTree(nested));
  const taxAmounts = ['employment','paye','paidOnAccount','annualRent','annualFinance','lossBroughtForward','financeBroughtForward','pensionNet','giftAidNet','travelActual','travelEstimate'];
  const validAmount = (value, blank = true) => typeof value === 'string' &&
    ((blank && value === '') || (value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 1e9));

  function records(value, label) {
    requireValue(Array.isArray(value), 'Invalid ' + label);
    const ids = new Set();
    for (const row of value) {
      requireValue(object(row) && validId(row.id) && !ids.has(row.id), 'Invalid or duplicate ' + label + ' ID');
      ids.add(row.id);
    }
  }

  function validate(input) {
    const result = clone(input);
    requireValue(object(result) && ['amp-backup-v1','amp-backup-v2','amp-backup-v3'].includes(result.format), 'Unsupported AMP backup format');
    const app = result.app, property = result.property;
    requireValue(object(app) && object(property), 'Missing AMP records');
    records(app.habits, 'habits'); records(app.goals, 'goals'); records(app.cases, 'cases');
    requireValue(object(app.checks), 'Invalid habit checkmarks');
    for (const values of Object.values(app.checks)) {
      requireValue(object(values) && Object.values(values).every(value => typeof value === 'boolean'), 'Invalid habit checkmarks');
    }
    for (const habit of app.habits) requireValue(typeof habit.name === 'string', 'Invalid habit name');
    for (const goal of app.goals) {
      requireValue(typeof goal.name === 'string', 'Invalid goal name');
      records(goal.steps, 'goal checkpoints');
      for (const step of goal.steps) requireValue(typeof step.name === 'string' && typeof step.done === 'boolean', 'Invalid goal checkpoint');
    }
    for (const record of app.cases) {
      requireValue(typeof record.title === 'string', 'Invalid case title');
      if (record.history !== undefined) requireValue(Array.isArray(record.history) && record.history.every(object), 'Invalid case history');
    }
    records(property.properties, 'properties'); records(property.transactions, 'transactions');
    for (const record of property.properties) requireValue(typeof record.name === 'string', 'Invalid property name');
    for (const record of property.transactions) {
      requireValue(validId(record.propertyId) && ['income','expense'].includes(record.type) &&
        typeof record.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(record.date) &&
        Number.isFinite(Number(record.amount)) && Number(record.amount) >= 0, 'Invalid property transaction');
    }
    if (result.format === 'amp-backup-v1') result.tax = {version:1, years:{}};
    requireValue(object(result.tax) && result.tax.version === 1 && object(result.tax.years), 'Invalid tax settings');
    for (const [yearKey, year] of Object.entries(result.tax.years)) {
      requireValue(safeKey(yearKey) && /^\d{4}$/.test(yearKey) && object(year), 'Invalid tax year');
      for (const key of taxAmounts) {
        if (year[key] !== undefined) requireValue(validAmount(year[key]), 'Invalid tax amount: ' + key);
      }
      for (const key of ['rentMode','financeMode']) {
        if (year[key] !== undefined) requireValue(['records','annual'].includes(year[key]), 'Invalid tax source: ' + key);
      }
      for (const key of ['complete','standard','studentLoanReviewRequired','sourceReviewRequired']) {
        if (year[key] !== undefined) requireValue(typeof year[key] === 'boolean', 'Invalid tax confirmation: ' + key);
      }
      if (year.studentLoanPlan !== undefined) requireValue(typeof year.studentLoanPlan === 'string', 'Invalid student loan plan');
      if (year.sourceEvidence !== undefined) {
        requireValue(Array.isArray(year.sourceEvidence) && year.sourceEvidence.every(evidence => object(evidence) &&
          safeTree(evidence)), 'Invalid tax source evidence');
      }
      if (year.transactions !== undefined) {
        requireValue(object(year.transactions), 'Invalid tax transaction reviews');
        for (const [id, review] of Object.entries(year.transactions)) {
          requireValue(safeKey(id) && object(review) && ['review','income','expense','finance','exclude'].includes(review.treatment) &&
            validAmount(review.amount, false), 'Invalid tax transaction review');
        }
      }
    }
    records(result.documents, 'documents');
    // Decode every attachment now, before any existing records can be touched.
    for (const doc of result.documents) decodeDocument(doc);
    if (result.format === 'amp-backup-v3') {
      requireValue(env.AMPProfile, 'Profile storage support is unavailable');
      result.personalization = env.AMPProfile.validate(result.personalization);
      if (Object.prototype.hasOwnProperty.call(result,'achievements')) {
        requireValue(env.AMPAchievements, 'Achievement storage support is unavailable');
        result.achievements = env.AMPAchievements.validate(result.achievements);
      }
      records(result.photos, 'photos');
      const photos = new Map();
      for (const photo of result.photos) { decodePhoto(photo); photos.set(photo.id, photo); }
      const avatar = result.personalization.avatarPhotoId;
      if (avatar) requireValue(photos.get(avatar)?.kind === 'avatar', 'Profile photo is missing from this backup');
      for (const [propertyId, id] of Object.entries(result.personalization.propertyPhotos)) {
        if (id) requireValue(photos.get(id)?.kind === 'property' && String(photos.get(id).propertyId) === propertyId, 'Property photo is missing or belongs to another property');
      }
    }
    return result;
  }

  function decodePhoto(photo) {
    requireValue(typeof photo.data === 'string', 'Invalid photo contents');
    const match = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/]*={0,2})$/.exec(photo.data);
    requireValue(match && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(match[2]), 'Invalid raster photo encoding');
    let bytes;try { bytes = Uint8Array.from(env.atob(match[2]),char => char.charCodeAt(0)); } catch (_) { throw Error('Invalid raster photo encoding'); }
    requireValue(photo.type === match[1] && env.AMPProfile, 'Invalid raster photo type');
    env.AMPProfile.validatePhoto(photo,bytes);
    const result = {...photo,blob:new env.Blob([bytes],{type:match[1]})};delete result.data;return result;
  }

  function decodeDocument(doc) {
    requireValue(validId(doc.caseId) && typeof doc.name === 'string' && typeof doc.date === 'string' &&
      typeof doc.data === 'string', 'Invalid attached document');
    const match = /^data:([^,]*);base64,([A-Za-z0-9+/]*={0,2})$/.exec(doc.data);
    requireValue(match && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(match[2]), 'Invalid attached document encoding');
    let bytes;
    try {
      const binary = env.atob(match[2]);
      bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    } catch (_) { throw new Error('Invalid attached document encoding'); }
    requireValue(Number.isInteger(doc.size) && doc.size === bytes.length, 'Attached document size does not match its contents');
    const result = {...doc, blob:new env.Blob([bytes], {type:match[1] || 'application/octet-stream'})};
    delete result.data;
    return result;
  }

  function openDatabase(name,version,upgrade,recovery=false) {
    if (!env.indexedDB) return Promise.reject(new Error('Device storage unavailable; no complete backup can be created'));
    let settled=false;
    return new Promise((resolve,reject)=>{
      const request=env.indexedDB.open(name,version);
      request.onupgradeneeded=()=>upgrade(request.result);
      request.onerror=()=>{settled=true;reject(request.error||Error('Device storage unavailable'));};
      request.onblocked=()=>{settled=true;reject(Error('Close other AMP tabs and reopen this app before backup or restore'));};
      request.onsuccess=()=>{const db=request.result;if(settled){db.close();return;}db.onversionchange=()=>{db.close();if(recovery)pendingRecoveryDB=null;else pendingDB=null;};resolve(db);};
    });
  }
  function openDB() {
    if(!pendingDB)pendingDB=openDatabase('amp-documents',2,db=>{
      if(!db.objectStoreNames.contains('documents')){const store=db.createObjectStore('documents',{keyPath:'id'});store.createIndex('byCase','caseId',{unique:false});}
      if(!db.objectStoreNames.contains('photos'))db.createObjectStore('photos',{keyPath:'id'});
    }).catch(error=>{pendingDB=null;throw error;});
    return pendingDB;
  }
  function openRecoveryDB() {
    if(!pendingRecoveryDB)pendingRecoveryDB=openDatabase('amp-backup-recovery',1,db=>{
      if(!db.objectStoreNames.contains('snapshots'))db.createObjectStore('snapshots',{keyPath:'id'});
    },true).catch(error=>{pendingRecoveryDB=null;throw error;});
    return pendingRecoveryDB;
  }
  async function readAssets() {
    const db=await openDB();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(['documents','photos'],'readonly'),assets={};
      for(const name of ['documents','photos']){const request=tx.objectStore(name).getAll();request.onsuccess=()=>{assets[name]=request.result;};}
      tx.oncomplete=()=>resolve(assets);tx.onabort=()=>reject(tx.error||Error('Could not read all documents and photos'));tx.onerror=()=>{};
    });
  }
  async function replaceAssets(documents,photos,replacePhotos) {
    const db=await openDB();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(['documents','photos'],'readwrite');
      tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error||Error('Document and photo restore failed'));tx.onerror=()=>{};
      try{
        const docs=tx.objectStore('documents');docs.clear();for(const record of documents)docs.put(record);
        if(replacePhotos){const store=tx.objectStore('photos');store.clear();for(const record of photos)store.put(record);}
      }catch(error){try{tx.abort();}catch(_){}reject(error);}
    });
  }
  async function recoveryTransaction(mode,operation) {
    const db=await openRecoveryDB();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('snapshots',mode);let result;
      tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(tx.error||Error('Recovery storage failed'));tx.onerror=()=>{};
      try{const request=operation(tx.objectStore('snapshots'));if(request)request.onsuccess=()=>{result=request.result;};}
      catch(error){try{tx.abort();}catch(_){}reject(error);}
    });
  }
  async function ensureSpace(bytes) {
    if(!env.navigator?.storage?.estimate)return;
    let estimate;try{estimate=await env.navigator.storage.estimate();}catch(_){return;}
    if(Number.isFinite(estimate.quota)&&Number.isFinite(estimate.usage))requireValue(estimate.quota-estimate.usage>=bytes+262144,'Not enough device storage for a complete recovery copy. No records were replaced.');
  }
  async function encodeDocument(document) {
    requireValue(document.blob && typeof document.blob.arrayBuffer === 'function', 'An attached document could not be read');
    const bytes = new Uint8Array(await document.blob.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 32768) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    }
    const result = {...document, size:bytes.length, data:'data:'+(document.blob.type || document.type || 'application/octet-stream')+';base64,'+env.btoa(binary)};
    delete result.blob;
    return result;
  }

  function profileDefaults(){requireValue(env.AMPProfile,'Profile storage support is unavailable');return env.AMPProfile.defaults();}
  function achievementDefaults(){requireValue(env.AMPAchievements,'Achievement storage support is unavailable');return env.AMPAchievements.defaults();}
  async function serializeSnapshot(snapshot){
    const documents=await Promise.all(snapshot.documents.map(encodeDocument));
    const photos=await Promise.all(snapshot.photos.map(encodeDocument));
    return validate({format:'amp-backup-v3',exportedAt:new Date().toISOString(),...clone(snapshot.records),documents,photos});
  }
  async function exportPayload({app,property,tax,personalization,achievements}) {
    const savedMetadata=env.AMPProfile?.load();
    const metadata=personalization===undefined?savedMetadata:personalization;
    requireValue(metadata,'Profile metadata could not be read');
    const savedAchievements=env.AMPAchievements?.load();
    const badgeState=achievements===undefined?savedAchievements:achievements;
    requireValue(badgeState,'Saved achievements could not be read');
    const records=clone({app,property,tax,personalization:metadata,achievements:badgeState});
    const assets=await readAssets();
    return serializeSnapshot({records,...assets});
  }
  async function readRecovery() {
    const snapshot=await recoveryTransaction('readonly',store=>store.get('latest'));
    if(snapshot){requireValue(snapshot.format==='amp-recovery-v2','Invalid recovery snapshot');return serializeSnapshot(snapshot);}
    // Recovery files created by the previous app remain downloadable.
    const saved=env.localStorage.getItem(RECOVERY_KEY);if(!saved)return null;
    const legacy=JSON.parse(saved);requireValue(legacy.format==='amp-recovery-v1','Invalid recovery snapshot');return validate(legacy.payload);
  }
  async function clearRecovery(){await recoveryTransaction('readwrite',store=>store.clear());env.localStorage.removeItem(RECOVERY_KEY);}
  function rollbackStorage(rawStorage) {
    const errors=[];for(const {key,value} of Object.values(rawStorage)){try{if(value===null)env.localStorage.removeItem(key);else env.localStorage.setItem(key,value);}catch(error){errors.push(error);}}return errors;
  }
  const assetFingerprint=assets=>JSON.stringify(['documents','photos'].map(name=>assets[name].map(record=>[record.id,record.caseId,record.propertyId,record.createdAt,record.date,record.type,record.size,record.blob?.size]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))));
  async function restore(input,{storageKeys}) {
    requireValue(!restoring,'A restore is already running');
    const payload=validate(input),photoRestore=payload.format==='amp-backup-v3',badgeRestore=photoRestore&&Object.prototype.hasOwnProperty.call(payload,'achievements');
    const keys={...storageKeys,personalization:storageKeys?.personalization||env.AMPProfile?.storageKey||'amp-profile-v1',achievements:storageKeys?.achievements||env.AMPAchievements?.storageKey||'amp-achievements-v1'};
    requireValue(['app','property','tax','personalization','achievements'].every(name=>validKey(keys[name]))&&new Set(Object.values(keys)).size===5&&!Object.values(keys).includes(RECOVERY_KEY),'Invalid storage keys');
    restoring=true;
    try{
      const rawStorage=Object.fromEntries(['app','property','tax','personalization','achievements'].map(name=>[name,{key:keys[name],value:env.localStorage.getItem(keys[name])}]));
      const parseCurrent=(name,fallback)=>rawStorage[name].value===null?fallback:JSON.parse(rawStorage[name].value);
      const records={app:parseCurrent('app',{version:1,habits:[],checks:{},goals:[],cases:[]}),property:parseCurrent('property',{properties:[],transactions:[]}),tax:parseCurrent('tax',{version:1,years:{}}),personalization:parseCurrent('personalization',profileDefaults()),achievements:parseCurrent('achievements',achievementDefaults())};
      const assets=await readAssets(),snapshot={id:'latest',format:'amp-recovery-v2',createdAt:new Date().toISOString(),rawStorage,records,...assets};
      // Verify that the current records can be exported completely before retaining them as recovery.
      await serializeSnapshot(snapshot);
      const documents=payload.documents.map(decodeDocument),photos=photoRestore?payload.photos.map(decodePhoto):assets.photos;
      const currentBytes=[...assets.documents,...assets.photos].reduce((sum,record)=>sum+record.blob.size,0);
      const incomingBytes=[...documents,...(photoRestore?photos:[])].reduce((sum,record)=>sum+record.blob.size,0);
      await ensureSpace(currentBytes+incomingBytes+JSON.stringify(records).length*2);
      try{
        await recoveryTransaction('readwrite',store=>store.put(snapshot));
        const stored=await recoveryTransaction('readonly',store=>store.get('latest'));
        requireValue(stored?.createdAt===snapshot.createdAt&&JSON.stringify(stored.rawStorage)===JSON.stringify(rawStorage)&&assetFingerprint(stored)===assetFingerprint(assets),'Recovery copy could not be verified');
      }catch(_){throw Error('Could not save a complete recovery copy. No records were replaced. Free device storage and retry.');}
      for(const {key,value} of Object.values(rawStorage))requireValue(env.localStorage.getItem(key)===value,'AMP data changed during preparation. Close other AMP tabs and retry.');
      requireValue(assetFingerprint(await readAssets())===assetFingerprint(assets),'Documents or photos changed during preparation. Close other AMP tabs and retry.');
      const nextPersonalization=photoRestore?payload.personalization:records.personalization;
      const nextAchievements=badgeRestore?payload.achievements:records.achievements;
      try{
        for(const name of ['app','property','tax',...(photoRestore?['personalization']:[]),...(badgeRestore?['achievements']:[])]){
          const value=JSON.stringify(name==='personalization'?nextPersonalization:name==='achievements'?nextAchievements:payload[name]);env.localStorage.setItem(keys[name],value);requireValue(env.localStorage.getItem(keys[name])===value,'Saved records could not be verified');
        }
        // Documents and photos commit together. Older backups leave the photo store untouched.
        await replaceAssets(documents,photos,photoRestore);
      }catch(_){
        const failures=rollbackStorage(rawStorage);
        if(failures.length)throw Error('Restore failed and browser records could not be fully rolled back. Download the saved recovery copy before continuing.');
        throw Error('Restore failed; your previous records were restored. A recovery copy is also available.');
      }
      return {...payload,personalization:clone(nextPersonalization),achievements:clone(nextAchievements)};
    }finally{restoring=false;}
  }
  return Object.freeze({exportPayload,validate,restore,readRecovery,clearRecovery,recoveryKey:RECOVERY_KEY});
});

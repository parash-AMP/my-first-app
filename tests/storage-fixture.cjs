// Transactional IndexedDB fixture shared by storage tests; no real user records.
function makeEnvironment({documents=[],photos=[],localEntries=[]}={}){
  const control={failRead:false,failCommit:false,failRecovery:false,failStorage:null,writes:0,docWrites:0,recoveryWrites:0,quota:1e9,usage:0,blocked:false,bitmapWidth:4000,bitmapHeight:3000,bitmapFails:false,canvasFails:false,bitmapClosed:0};
  const map=new Map(localEntries),databases=new Map([['amp-documents',{version:1,stores:new Map([['documents',new Map(documents.map(d=>[d.id,structuredClone(d)]))]])}]]);
  if(photos.length){databases.get('amp-documents').version=2;databases.get('amp-documents').stores.set('photos',new Map(photos.map(p=>[p.id,structuredClone(p)])));}
  const localStorage={getItem:key=>map.get(key)??null,setItem(key,value){control.writes++;if(control.failStorage?.(key,value))throw Error('Quota exceeded');map.set(key,String(value));},removeItem(key){control.writes++;map.delete(key);}};
  function connection(name,entry){
    const db={name,closed:false,objectStoreNames:{contains:key=>entry.stores.has(key)},close(){db.closed=true;},createObjectStore(key){entry.stores.set(key,new Map());return {createIndex(){}};},transaction(names,mode){
      const storeNames=typeof names==='string'?[names]:names;for(const key of storeNames)if(!entry.stores.has(key))throw Error('Missing store '+key);
      const staged=new Map(storeNames.map(key=>[key,structuredClone(entry.stores.get(key))])),actions=[];let stopped=false;
      const tx={error:null,abort(){stopped=true;queueMicrotask(()=>tx.onabort?.());},objectStore(key){if(!staged.has(key))throw Error('Missing transaction store');const store=staged.get(key);
        const enqueue=action=>{const request={};actions.push(()=>{if(control.failRead&&mode==='readonly'&&name==='amp-documents')throw Error('Unreadable');request.result=action();request.onsuccess?.();});return request;};
        return {getAll:()=>enqueue(()=>[...store.values()].map(v=>structuredClone(v))),get:id=>enqueue(()=>structuredClone(store.get(id))),clear:()=>enqueue(()=>store.clear()),delete:id=>enqueue(()=>store.delete(id)),put:value=>enqueue(()=>{store.set(value.id,structuredClone(value));return value.id;}),add:value=>enqueue(()=>{if(store.has(value.id))throw Error('Duplicate key');store.set(value.id,structuredClone(value));return value.id;})};
      }};
      setTimeout(()=>{if(stopped)return;try{for(const action of actions)action();if(mode==='readwrite'&&(name==='amp-documents'&&control.failCommit||name==='amp-backup-recovery'&&control.failRecovery))throw Error('Commit failed');if(mode==='readwrite'){for(const key of storeNames)entry.stores.set(key,staged.get(key));if(name==='amp-documents')control.docWrites++;else control.recoveryWrites++;}tx.oncomplete?.();}catch(error){tx.error=error;tx.onabort?.();}},0);
      return tx;
    }};return db;
  }
  const indexedDB={open(name,version){const request={};queueMicrotask(()=>{if(control.blocked){request.onblocked?.();return;}let entry=databases.get(name),old=entry?.version||0;if(entry&&version<old){request.error=Error('VersionError');request.onerror?.();return;}if(!entry){entry={version,stores:new Map()};databases.set(name,entry);}const db=connection(name,entry);request.result=db;if(version>old){request.onupgradeneeded?.({oldVersion:old,newVersion:version});entry.version=version;}request.onsuccess?.();});return request;}};
  const env={localStorage,indexedDB,Blob,Uint8Array,DataView,atob,btoa,navigator:{storage:{estimate:async()=>({quota:control.quota,usage:control.usage})}},crypto:{randomUUID:()=> 'photo-'+Math.random().toString(36).slice(2)},createImageBitmap:async()=>{if(control.bitmapFails)throw Error('Unsupported image');return {width:control.bitmapWidth,height:control.bitmapHeight,close(){control.bitmapClosed++;}};},document:{createElement(tag){if(tag!=='canvas')throw Error('Unexpected element');const canvas={width:0,height:0,getContext(){return {fillRect(){},drawImage(){}};},toBlob(callback,type){callback(control.canvasFails?null:new Blob([jpeg(canvas.width,canvas.height)],{type}));}};return canvas;}}};
  return {env,control,map,databases,assets:name=>[...(databases.get('amp-documents').stores.get(name)?.values()||[])],recovery:()=>databases.get('amp-backup-recovery')?.stores.get('snapshots')?.get('latest')};
}
function jpeg(width=1,height=1){return new Uint8Array([255,216,255,192,0,11,8,height>>8,height&255,width>>8,width&255,1,1,17,0,255,217]);}
module.exports={makeEnvironment,jpeg};

/* Private, optional profile metadata and compressed raster photos. No network requests. */
(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory;
  else root.AMPProfile=factory(root);
})(typeof window==='undefined'?globalThis:window,function(env){
  'use strict';
  const storageKey='amp-profile-v1';
  const defaults=()=>({version:1,displayName:'',status:'',avatarPhotoId:'',propertyPhotos:{}});
  const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  const safeKey=key=>!['__proto__','prototype','constructor'].includes(key);
  const safeTree=value=>Array.isArray(value)?value.every(safeTree):!object(value)||Object.entries(value).every(([key,nested])=>safeKey(key)&&safeTree(nested));
  const clone=value=>JSON.parse(JSON.stringify(value));
  const assert=(condition,message)=>{if(!condition)throw Error(message);};
  let pendingDB;
  function propertyKey(id){const key=String(id);assert((typeof id==='string'||typeof id==='number'&&Number.isFinite(id))&&key.length>0&&key.length<=128&&safeKey(key),'Invalid property reference');return key;}
  function validate(metadata){
    assert(object(metadata)&&metadata.version===1&&safeTree(metadata),'Invalid saved profile');
    assert(typeof metadata.displayName==='string'&&metadata.displayName.length<=100,'Profile name must be 100 characters or fewer');
    if(metadata.status!==undefined)assert(typeof metadata.status==='string'&&metadata.status.length<=160,'Profile status must be 160 characters or fewer');
    assert(typeof metadata.avatarPhotoId==='string'&&metadata.avatarPhotoId.length<=128,'Invalid profile photo reference');
    assert(object(metadata.propertyPhotos),'Invalid property photo references');
    for(const [key,id] of Object.entries(metadata.propertyPhotos)){propertyKey(key);assert(typeof id==='string'&&id.length<=128,'Invalid property photo reference');}
    return clone(metadata);
  }
  function getRaw(){return env.localStorage.getItem(storageKey);}
  function load(){const raw=getRaw();if(raw===null)return defaults();try{return validate(JSON.parse(raw));}catch(error){throw Error('Saved profile could not be read. It has been kept unchanged.');}}
  function save(metadata,options={}){
    const next=validate(metadata),raw=getRaw();
    if(raw!==null){try{validate(JSON.parse(raw));}catch(_){throw Error('Existing profile could not be read. No profile changes were saved.');}}
    if(Object.prototype.hasOwnProperty.call(options,'expectedRaw'))assert(options.expectedRaw===raw,'Profile changed in another tab. Reopen it before saving.');
    const serialized=JSON.stringify(next);if(serialized===raw)return next;
    try{env.localStorage.setItem(storageKey,serialized);assert(getRaw()===serialized,'Could not verify the saved profile');}
    catch(error){let retained=true;try{if(raw===null)env.localStorage.removeItem(storageKey);else env.localStorage.setItem(storageKey,raw);}catch(_){retained=false;}throw Error(retained?'Could not save your profile. The previous saved profile was retained.':'Could not save or recover profile storage. Keep this browser data and restore from your backup.');}
    return next;
  }
  function openDB(){
    if(!env.indexedDB)return Promise.reject(Error('Photo storage is unavailable in this browser'));
    if(!pendingDB)pendingDB=new Promise((resolve,reject)=>{
      let settled=false;const request=env.indexedDB.open('amp-documents',2);
      request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains('documents')){const store=db.createObjectStore('documents',{keyPath:'id'});store.createIndex('byCase','caseId',{unique:false});}if(!db.objectStoreNames.contains('photos'))db.createObjectStore('photos',{keyPath:'id'});};
      request.onerror=()=>{settled=true;reject(request.error||Error('Photo storage is unavailable'));};
      request.onblocked=()=>{settled=true;reject(Error('Close other AMP tabs and reopen this app to enable photos'));};
      request.onsuccess=()=>{const db=request.result;if(settled){db.close();return;}db.onversionchange=()=>{db.close();pendingDB=null;};resolve(db);};
    }).catch(error=>{pendingDB=null;throw error;});
    return pendingDB;
  }
  async function transaction(mode,operation){const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction('photos',mode);let result;tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(tx.error||Error('Photo storage change failed'));tx.onerror=()=>{};try{const request=operation(tx.objectStore('photos'));if(request)request.onsuccess=()=>{result=request.result;};}catch(error){try{tx.abort();}catch(_){}reject(error);}});}
  async function ensureSpace(bytes){
    if(!env.navigator?.storage?.estimate)return;
    let estimate;try{estimate=await env.navigator.storage.estimate();}catch(_){return;}
    if(Number.isFinite(estimate.quota)&&Number.isFinite(estimate.usage))assert(estimate.quota-estimate.usage>=bytes+65536,'Not enough browser storage for this photo. Export a backup and free device storage.');
  }
  function inspectImage(bytes){
    if(bytes.length>=24&&[137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value)&&String.fromCharCode(...bytes.subarray(12,16))==='IHDR'){
      const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);return {type:'image/png',width:view.getUint32(16),height:view.getUint32(20)};
    }
    if(bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255){
      let offset=2;while(offset+3<bytes.length){if(bytes[offset++]!==255)break;while(bytes[offset]===255)offset++;const marker=bytes[offset++];if(marker===217||marker===218)break;if(marker===216||marker===1||marker>=208&&marker<=215)continue;if(offset+1>=bytes.length)break;const length=(bytes[offset]<<8)|bytes[offset+1];if(length<2||offset+length>bytes.length)break;if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&length>=7)return {type:'image/jpeg',height:(bytes[offset+3]<<8)|bytes[offset+4],width:(bytes[offset+5]<<8)|bytes[offset+6]};offset+=length;}
    }
    return null;
  }
  function validatePhoto(record,bytes){
    assert(object(record)&&typeof record.id==='string'&&record.id.length>0&&record.id.length<=128&&['avatar','property'].includes(record.kind),'Invalid saved photo');
    if(record.kind==='property')propertyKey(record.propertyId);
    const max=record.kind==='avatar'?512:1600,limit=record.kind==='avatar'?350*1024:1536*1024;
    assert(['image/jpeg','image/png'].includes(record.type)&&Number.isInteger(record.size)&&record.size>0&&record.size<=limit&&Number.isInteger(record.width)&&record.width>0&&record.width<=max&&Number.isInteger(record.height)&&record.height>0&&record.height<=max,'Invalid photo dimensions or file size');
    if(bytes){const info=inspectImage(bytes);assert(info&&info.type===record.type&&info.width===record.width&&info.height===record.height&&bytes.length===record.size,'Photo contents do not match the saved image');}
    return record;
  }
  async function getPhoto(id){if(!id)return null;const record=await transaction('readonly',store=>store.get(id));if(!record)return null;assert(record.blob&&typeof record.blob.arrayBuffer==='function','Saved photo could not be read');validatePhoto(record,new Uint8Array(await record.blob.arrayBuffer()));return record;}
  async function decode(file){
    if(typeof env.createImageBitmap==='function'){try{const image=await env.createImageBitmap(file,{imageOrientation:'from-image'});return {image,width:image.width,height:image.height,close:()=>image.close?.()};}catch(_){/* Some browsers decode iPhone photos through Image instead. */}}
    assert(env.Image&&env.URL?.createObjectURL,'This browser cannot read this photo. Choose a JPEG, PNG or WebP photo.');
    const url=env.URL.createObjectURL(file);
    try{const image=await new Promise((resolve,reject)=>{const image=new env.Image();image.onload=()=>resolve(image);image.onerror=()=>reject(Error('This photo could not be read. Choose JPEG, PNG or WebP.'));image.src=url;});return {image,width:image.naturalWidth,height:image.naturalHeight,close:()=>env.URL.revokeObjectURL(url)};}
    catch(error){env.URL.revokeObjectURL(url);throw error;}
  }
  async function compress(file,kind){
    assert(file&&typeof file.arrayBuffer==='function'&&typeof file.slice==='function'&&file.size>0&&file.size<=25*1024*1024,'Choose a photo up to 25 MB');
    assert(['image/jpeg','image/png','image/webp','image/heic','image/heif'].includes(file.type),'Choose a JPEG, PNG or WebP photo. SVG and other file types are not supported.');
    const head=new Uint8Array(await file.slice(0,64).arrayBuffer());
    const heif=String.fromCharCode(...head.subarray(4,8))==='ftyp'&&['heic','heix','hevc','hevx','mif1','msf1'].some(brand=>String.fromCharCode(...head).includes(brand));
    const matching=file.type==='image/jpeg'?head[0]===255&&head[1]===216&&head[2]===255:file.type==='image/png'?[137,80,78,71,13,10,26,10].every((v,i)=>head[i]===v):file.type==='image/webp'?String.fromCharCode(...head.subarray(0,4))==='RIFF'&&String.fromCharCode(...head.subarray(8,12))==='WEBP':heif;
    assert(matching,'The selected file is not a supported raster photo');
    const decoded=await decode(file);
    try{
      assert(decoded.width>0&&decoded.height>0&&decoded.width*decoded.height<=100000000,'Photo dimensions are too large');
      const max=kind==='avatar'?512:1600,limit=kind==='avatar'?350*1024:1536*1024;
      let ratio=Math.min(1,max/decoded.width,max/decoded.height),width=Math.max(1,Math.round(decoded.width*ratio)),height=Math.max(1,Math.round(decoded.height*ratio)),quality=.86;
      const canvas=env.document.createElement('canvas'),ctx=canvas.getContext('2d');assert(ctx,'Photo processing is unavailable');
      for(let attempt=0;attempt<7;attempt++){
        canvas.width=width;canvas.height=height;ctx.fillStyle='#ffffff';ctx.fillRect(0,0,width,height);ctx.drawImage(decoded.image,0,0,width,height);
        const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('Photo could not be compressed')),'image/jpeg',quality));
        if(blob.size<=limit){const bytes=new Uint8Array(await blob.arrayBuffer());const info=inspectImage(bytes);assert(info&&info.type==='image/jpeg'&&info.width===width&&info.height===height,'Photo compression produced an invalid image');return {blob,type:'image/jpeg',size:blob.size,width,height};}
        quality=Math.max(.5,quality-.12);width=Math.max(1,Math.round(width*.8));height=Math.max(1,Math.round(height*.8));
      }
      throw Error('This photo is still too large after compression. Choose a smaller image.');
    }finally{decoded.close();}
  }
  async function savePhoto(file,{kind,propertyId}={}){
    assert(['avatar','property'].includes(kind),'Choose a profile or property photo');
    const owner=kind==='property'?propertyKey(propertyId):'';
    const image=await compress(file,kind);await ensureSpace(image.size);
    const id=env.crypto?.randomUUID?env.crypto.randomUUID():'photo-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
    const record={id,kind,propertyId:owner,...image,createdAt:new Date().toISOString()};validatePhoto(record);
    await transaction('readwrite',store=>store.add(record));return record;
  }
  async function removePhoto(id){assert(typeof id==='string'&&id.length>0,'Invalid photo reference');const metadata=load();if(metadata.avatarPhotoId===id||Object.values(metadata.propertyPhotos).includes(id))return false;await transaction('readwrite',store=>store.delete(id));return true;}
  async function clearPhotos(){await transaction('readwrite',store=>store.clear());}
  return Object.freeze({storageKey,defaults,load,save,getRaw,propertyKey,getPhoto,savePhoto,removePhoto,clearPhotos,validate,validatePhoto,inspectImage});
});

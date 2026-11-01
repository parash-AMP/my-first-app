/* Complete AMP backups. No network requests; documents stay on this device. */
(function(root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.AMPBackup = factory(root);
})(typeof window === 'undefined' ? globalThis : window, function(env) {
  'use strict';
  const RECOVERY_KEY = 'amp-before-restore-v1';
  let pendingDB, restoring = false;
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
    requireValue(object(result) && ['amp-backup-v1','amp-backup-v2'].includes(result.format), 'Unsupported AMP backup format');
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
    return result;
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

  function openDB() {
    if (!env.indexedDB) return Promise.reject(new Error('Document storage unavailable; a complete backup cannot be created'));
    if (!pendingDB) {
      pendingDB = new Promise((resolve, reject) => {
        const request = env.indexedDB.open('amp-documents', 1);
        request.onupgradeneeded = () => {
          const store = request.result.createObjectStore('documents', {keyPath:'id'});
          store.createIndex('byCase', 'caseId', {unique:false});
        };
        request.onerror = () => reject(request.error || new Error('Document storage unavailable'));
        request.onblocked = () => reject(new Error('Close other AMP tabs and try again'));
        request.onsuccess = () => resolve(request.result);
      }).catch(error => { pendingDB = null; throw error; });
    }
    return pendingDB;
  }

  async function readDocuments() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('documents', 'readonly');
      const request = tx.objectStore('documents').getAll();
      let documents;
      request.onsuccess = () => { documents = request.result; };
      tx.oncomplete = () => resolve(documents);
      tx.onabort = () => reject(tx.error || new Error('Could not read all documents'));
      tx.onerror = () => {}; // IndexedDB aborts the transaction; onabort reports the failure.
    });
  }

  async function replaceDocuments(documents) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('documents', 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error || new Error('Document restore failed'));
      tx.onerror = () => {};
      try {
        const store = tx.objectStore('documents');
        store.clear();
        for (const document of documents) store.put(document);
      } catch (error) {
        try { tx.abort(); } catch (_) {}
        reject(error);
      }
    });
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

  async function exportPayload({app, property, tax}) {
    // Capture the ordinary records before awaiting IndexedDB.
    const snapshot = clone({app, property, tax});
    const documents = await readDocuments();
    const files = await Promise.all(documents.map(encodeDocument));
    return validate({format:'amp-backup-v2', exportedAt:new Date().toISOString(), ...snapshot, documents:files});
  }

  function readRecovery() {
    const saved = env.localStorage.getItem(RECOVERY_KEY);
    if (!saved) return null;
    const recovery = JSON.parse(saved);
    requireValue(recovery.format === 'amp-recovery-v1', 'Invalid recovery snapshot');
    return validate(recovery.payload);
  }

  function rollbackStorage(rawStorage) {
    const errors = [];
    for (const {key, value} of Object.values(rawStorage)) {
      try { if (value === null) env.localStorage.removeItem(key); else env.localStorage.setItem(key, value); }
      catch (error) { errors.push(error); }
    }
    return errors;
  }

  async function restore(input, {storageKeys}) {
    requireValue(!restoring, 'A restore is already running');
    const payload = validate(input);
    requireValue(object(storageKeys) && ['app','property','tax'].every(name => validKey(storageKeys[name])) &&
      new Set(Object.values(storageKeys)).size === 3 && !Object.values(storageKeys).includes(RECOVERY_KEY), 'Invalid storage keys');
    restoring = true;
    try {
      const rawStorage = Object.fromEntries(['app','property','tax'].map(name => [name, {key:storageKeys[name], value:env.localStorage.getItem(storageKeys[name])}]));
      const parseCurrent = (name, fallback) => rawStorage[name].value === null ? fallback : JSON.parse(rawStorage[name].value);
      const current = await exportPayload({
        app:parseCurrent('app', {version:1, habits:[], checks:{}, goals:[], cases:[]}),
        property:parseCurrent('property', {properties:[], transactions:[]}),
        tax:parseCurrent('tax', {version:1, years:{}})
      });
      const recovery = JSON.stringify({format:'amp-recovery-v1', createdAt:new Date().toISOString(), rawStorage, payload:current});
      // If the complete recovery copy will not fit, do not modify current records.
      try {
        env.localStorage.setItem(RECOVERY_KEY, recovery);
        requireValue(env.localStorage.getItem(RECOVERY_KEY) === recovery, 'Recovery copy could not be verified');
      } catch (_) { throw new Error('Not enough storage for a recovery copy. Export your current backup and free device storage before restoring. No records were replaced.'); }
      for (const {key, value} of Object.values(rawStorage)) {
        requireValue(env.localStorage.getItem(key) === value, 'AMP data changed during preparation. Close other AMP tabs and retry.');
      }
      const documents = payload.documents.map(decodeDocument);
      try {
        for (const name of ['app','property','tax']) env.localStorage.setItem(storageKeys[name], JSON.stringify(payload[name]));
        // clear + all puts are one transaction; a failed put rolls the whole document change back.
        await replaceDocuments(documents);
      } catch (error) {
        const failures = rollbackStorage(rawStorage);
        if (failures.length) throw new Error('Restore failed and browser storage could not be rolled back. Download the saved recovery copy before continuing.');
        throw new Error('Restore failed; your previous records were restored. A recovery copy is also available.');
      }
      return payload;
    } finally { restoring = false; }
  }

  return Object.freeze({exportPayload, validate, restore, readRecovery, recoveryKey:RECOVERY_KEY});
});

/* Add document-derived hints without replacing records saved on this device. */
(function(root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.AMPEnrichment = factory(root);
})(typeof window === 'undefined' ? globalThis : window, function(env) {
  'use strict';
  const RECOVERY_KEY = 'amp-before-enrichment-v1';
  const baselines = new WeakMap();
  const clone = value => JSON.parse(JSON.stringify(value));
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const empty = value => value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
  const numeric = ['employment','paye','paidOnAccount','annualRent','annualFinance','lossBroughtForward','financeBroughtForward','pensionNet','giftAidNet','travelActual','travelEstimate'];
  const modes = ['rentMode','financeMode'];
  const evidenceKey = item => JSON.stringify([item.sourceUrl,item.title,item.date,item.valueText]);
  function assert(condition, message) { if (!condition) throw new Error(message); }
  function reviewEvidence(item) {
    return {...clone(item), status:'review', note:[item.note, 'Existing inputs kept; review this source before applying any change.'].filter(Boolean).join(' ')};
  }

  function mergeMissing(current, validatedBackup) {
    assert(object(current?.property) && Array.isArray(current.property.properties) && object(current?.tax) && object(current.tax.years), 'Current device records could not be read');
    assert(Array.isArray(validatedBackup?.property?.properties) && object(validatedBackup?.tax?.years), 'Invalid enrichment backup');
    const property = clone(current.property), tax = clone(current.tax);
    const report = {propertiesMatched:0,propertiesSkipped:0,propertyFieldsFilled:0,taxYearsAdded:0,taxFieldsFilled:0,sourceReferencesAdded:0,reviewFlagsSet:0,propertyChanged:false,taxChanged:false};
    for (const donor of validatedBackup.property.properties) {
      const target = property.properties.find(record => record.id === donor.id);
      if (!target) { report.propertiesSkipped++; continue; }
      report.propertiesMatched++;
      for (const key of ['address','lender']) {
        if (empty(target[key]) && !empty(donor[key])) { target[key] = clone(donor[key]); report.propertyFieldsFilled++; }
      }
      for (const key of ['rate','fixedEnd']) {
        if ((object(target.model) || empty(target.model)) && empty(target.model?.[key]) && !empty(donor.model?.[key])) {
          if (!object(target.model)) target.model = {};
          target.model[key] = clone(donor.model[key]); report.propertyFieldsFilled++;
          if (key === 'rate' && target.model.rateNeedsConfirmation !== true) {
            target.model.rateNeedsConfirmation = true; report.reviewFlagsSet++;
          }
        }
      }
      if ((empty(target.documentEvidence) || (Array.isArray(target.documentEvidence) && target.documentEvidence.length === 0)) && !empty(donor.documentEvidence)) {
        const incoming = donor.documentEvidence;
        if (!Array.isArray(incoming) || incoming.length) { target.documentEvidence = clone(incoming); report.propertyFieldsFilled++; }
      }
    }
    for (const [key, donor] of Object.entries(validatedBackup.tax.years)) {
      assert(/^\d{4}$/.test(key) && object(donor), 'Invalid enrichment tax year');
      if (!Object.prototype.hasOwnProperty.call(tax.years,key)) {
        const added = clone(donor);
        // Classifications made on another device are never trusted for this device's records.
        added.transactions = {};
        added.complete = false; added.standard = false;
        if (Array.isArray(added.sourceEvidence)) {
          const seen = new Set();
          added.sourceEvidence = added.sourceEvidence.filter(item => {
            assert(object(item), 'Invalid source reference');
            const fingerprint = evidenceKey(item); if (seen.has(fingerprint)) return false; seen.add(fingerprint); return true;
          }).map(reviewEvidence);
          report.sourceReferencesAdded += added.sourceEvidence.length;
        }
        tax.years[key] = added; report.taxYearsAdded++; continue;
      }
      const target = tax.years[key];
      assert(object(target), 'Existing tax year could not be read');
      let annualCandidateCopied = false;
      for (const field of [...numeric,...modes]) {
        if (empty(target[field]) && !empty(donor[field])) {
          target[field] = clone(donor[field]); report.taxFieldsFilled++;
          if (['employment','paye','annualRent','annualFinance'].includes(field)) annualCandidateCopied = true;
        }
      }
      if (annualCandidateCopied && donor.sourceReviewRequired === true && target.sourceReviewRequired !== true) {
        target.sourceReviewRequired = true; report.reviewFlagsSet++;
      }
      if (donor.studentLoanReviewRequired === true && target.studentLoanReviewRequired !== true) {
        target.studentLoanReviewRequired = true; report.reviewFlagsSet++;
      }
      if (Array.isArray(donor.sourceEvidence) && donor.sourceEvidence.length) {
        assert(target.sourceEvidence === undefined || target.sourceEvidence === null || Array.isArray(target.sourceEvidence), 'Existing source references could not be read');
        if (!Array.isArray(target.sourceEvidence)) target.sourceEvidence = [];
        const seen = new Set(target.sourceEvidence.map(evidenceKey));
        for (const item of donor.sourceEvidence) {
          assert(object(item), 'Invalid source reference');
          const fingerprint = evidenceKey(item); if (seen.has(fingerprint)) continue;
          target.sourceEvidence.push(reviewEvidence(item)); seen.add(fingerprint); report.sourceReferencesAdded++;
        }
      }
    }
    report.propertyChanged = JSON.stringify(property) !== JSON.stringify(current.property);
    report.taxChanged = JSON.stringify(tax) !== JSON.stringify(current.tax);
    const result = {property,tax,report};
    baselines.set(result,{property:JSON.stringify(current.property),tax:JSON.stringify(current.tax)});
    return result;
  }

  function persistMissing(result, {storageKeys}) {
    const baseline = baselines.get(result);
    assert(baseline && object(storageKeys) && typeof storageKeys.property === 'string' && typeof storageKeys.tax === 'string' &&
      storageKeys.property !== storageKeys.tax && storageKeys.property !== RECOVERY_KEY && storageKeys.tax !== RECOVERY_KEY, 'Invalid enrichment save');
    const changed = ['property','tax'].filter(key => JSON.stringify(result[key]) !== baseline[key]);
    if (!changed.length) return {changed:false,writtenKeys:[],report:result.report};
    const raw = Object.fromEntries(['property','tax'].map(name => [name,env.localStorage.getItem(storageKeys[name])]));
    function checkBaseline() {
      for (const name of ['property','tax']) {
        const currentRaw = env.localStorage.getItem(storageKeys[name]);
        let comparable;
        if (currentRaw === null) comparable = JSON.stringify(name === 'property' ? {properties:[],transactions:[]} : {version:1,years:{}});
        else { try { comparable = JSON.stringify(JSON.parse(currentRaw)); } catch (_) { throw new Error('Current device data cannot be read. No enrichment was saved.'); } }
        assert(comparable === baseline[name] && currentRaw === raw[name], 'Device data changed since the import was prepared. Reopen the import to preserve newer edits.');
      }
    }
    checkBaseline();
    if (env.localStorage.getItem(RECOVERY_KEY) === null) {
      const recovery = JSON.stringify({format:'amp-enrichment-recovery-v1',createdAt:new Date().toISOString(),storageKeys:{...storageKeys},property:raw.property,tax:raw.tax});
      try {
        env.localStorage.setItem(RECOVERY_KEY,recovery);
        assert(env.localStorage.getItem(RECOVERY_KEY) === recovery, 'Recovery verification failed');
      } catch (_) { throw new Error('Could not save the original-device recovery copy. No enrichment was saved.'); }
    }
    checkBaseline();
    try {
      for (const name of changed) {
        const value = JSON.stringify(result[name]);
        env.localStorage.setItem(storageKeys[name],value);
        assert(env.localStorage.getItem(storageKeys[name]) === value, 'Saved enrichment could not be verified');
      }
    } catch (_) {
      let rollbackFailed = false;
      for (const name of ['property','tax']) {
        try { if (raw[name] === null) env.localStorage.removeItem(storageKeys[name]); else env.localStorage.setItem(storageKeys[name],raw[name]); }
        catch (_) { rollbackFailed = true; }
      }
      throw new Error(rollbackFailed ? 'Save failed and storage could not be fully recovered. Keep this browser data and recover from the original-device copy.' : 'Save failed. Your previous device records were retained.');
    }
    return {changed:true,writtenKeys:changed.map(name => storageKeys[name]),report:result.report};
  }
  return Object.freeze({mergeMissing,persistMissing,recoveryKey:RECOVERY_KEY});
});

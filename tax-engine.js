/* AMP England tax estimates: employment + ordinary UK residential rentals.
 * Verified 1 November 2026. Future years are deliberately unsupported.
 * Sources:
 * https://www.gov.uk/government/publications/rates-and-allowances-income-tax/income-tax-rates-and-allowances-current-and-past
 * https://www.gov.uk/guidance/rates-and-thresholds-for-employers-2020-to-2021
 * https://www.gov.uk/guidance/rates-and-thresholds-for-employers-2021-to-2022
 * https://www.gov.uk/guidance/rates-and-thresholds-for-employers-2022-to-2023
 * https://www.gov.uk/guidance/adjusted-net-income
 * https://developer.service.hmrc.gov.uk/guides/tax-logic-service-guide/documentation/tax-calculation.html
 * https://www.gov.uk/guidance/changes-to-tax-relief-for-residential-landlords-how-its-worked-out-including-case-studies
 * https://www.gov.uk/hmrc-internal-manuals/property-income-manual/pim4210
 * https://www.gov.uk/hmrc-internal-manuals/self-assessment-legal-framework/salf303
 * Uses amounts to pennies, not HMRC tax-return box rounding. This is a planning
 * estimate, not a full Self Assessment computation. See the app's scope checks.
 */
(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.AMPTax=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const tables=Object.freeze({
    '2020':Object.freeze({personalAllowance:12500,basicLimit:37500,higherLimit:150000}),
    '2021':Object.freeze({personalAllowance:12570,basicLimit:37700,higherLimit:150000}),
    '2022':Object.freeze({personalAllowance:12570,basicLimit:37700,higherLimit:150000}),
    '2023':Object.freeze({personalAllowance:12570,basicLimit:37700,higherLimit:125140}),
    '2024':Object.freeze({personalAllowance:12570,basicLimit:37700,higherLimit:125140}),
    '2025':Object.freeze({personalAllowance:12570,basicLimit:37700,higherLimit:125140}),
    '2026':Object.freeze({personalAllowance:12570,basicLimit:37700,higherLimit:125140})
  });
  const years=Object.freeze(Object.keys(tables));
  function rules(year){
    if(typeof year!=='string'||!Object.prototype.hasOwnProperty.call(tables,year))throw new Error('This tax year has no verified rules. Choose 2020/21 to 2026/27.');
    return tables[year];
  }
  function amount(value,name,defaultValue=0){
    if(value===undefined||value===null||value==='')return defaultValue;
    // Match decimal forms accepted by HTML number inputs, including .5 and
    // scientific notation. Number() alone would also allow hex/blank strings.
    if((typeof value!=='number'&&typeof value!=='string')||(typeof value==='string'&&!/^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())))throw new Error('Enter a valid non-negative amount for '+name+'.');
    const result=Number(value);
    if(!Number.isFinite(result)||result<0||result>1e9)throw new Error('Enter a valid non-negative amount for '+name+'.');
    return result;
  }
  const money=n=>Math.round((n+Number.EPSILON)*100)/100;
  function taxOnIncome(income,extension,rule){
    const adjustedNetIncome=Math.max(0,income-extension);
    // HMRC applies the allowance taper in whole pounds (£1 per full £2).
    const personalAllowance=Math.max(0,rule.personalAllowance-Math.floor(Math.max(0,adjustedNetIncome-100000)/2));
    const taxableIncome=Math.max(0,income-personalAllowance);
    const basicLimit=rule.basicLimit+extension,higherLimit=rule.higherLimit+extension;
    const basicAmount=Math.min(taxableIncome,basicLimit);
    const higherAmount=Math.min(Math.max(0,taxableIncome-basicLimit),higherLimit-basicLimit);
    const additionalAmount=Math.max(0,taxableIncome-higherLimit);
    const tax=basicAmount*.2+higherAmount*.4+additionalAmount*.45;
    return {adjustedNetIncome,personalAllowance,taxableIncome,tax,bands:[
      {rate:20,amount:money(basicAmount),tax:money(basicAmount*.2)},
      {rate:40,amount:money(higherAmount),tax:money(higherAmount*.4)},
      {rate:45,amount:money(additionalAmount),tax:money(additionalAmount*.45)}
    ]};
  }
  function calculate(input){
    if(!input||typeof input!=='object')throw new Error('Enter the tax calculation details.');
    const rule=rules(input.year);
    const employment=amount(input.employment,'employment income');
    const rentalIncome=amount(input.rentalIncome,'rent received');
    const expenses=amount(input.expenses,'allowable expenses');
    const financeCosts=amount(input.financeCosts,'mortgage interest and eligible finance costs');
    const lossBroughtForward=amount(input.lossBroughtForward,'property losses brought forward');
    const financeBroughtForward=amount(input.financeBroughtForward,'finance costs brought forward');
    const pensionNet=amount(input.pensionNet,'relief-at-source pension payments');
    const giftAidNet=amount(input.giftAidNet,'Gift Aid donations');
    const paidOnAccount=amount(input.paidOnAccount,'payments already made');
    // These reliefs are only valid for eligible contributions. Net-pay or
    // salary-sacrifice pensions have already reduced P60 taxable pay.
    const grossPension=pensionNet*1.25,grossGiftAid=giftAidNet*1.25;
    const extension=grossPension+grossGiftAid;
    const propertyProfit=rentalIncome-expenses;
    const lossUsed=Math.min(lossBroughtForward,Math.max(0,propertyProfit));
    const taxablePropertyProfit=Math.max(0,propertyProfit-lossUsed);
    const lossCarryForward=lossBroughtForward-lossUsed+Math.max(0,-propertyProfit);
    const income=employment+taxablePropertyProfit;
    const total=taxOnIncome(income,extension,rule);
    const employmentOnly=taxOnIncome(employment,extension,rule);
    // Finance relief uses adjusted TOTAL income (after PA), distinct from ANI.
    // RAS contributions and Gift Aid change ANI/bands, not this net-income base.
    const adjustedTotalIncome=Math.max(0,income-total.personalAllowance);
    const financeAvailable=financeCosts+financeBroughtForward;
    const financeUsed=Math.max(0,Math.min(financeAvailable,taxablePropertyProfit,adjustedTotalIncome));
    const financeRelief=Math.min(total.tax,financeUsed*.2);
    const incomeTax=money(Math.max(0,total.tax-financeRelief));
    const employmentOnlyTax=money(employmentOnly.tax);
    const payeKnown=input.paye!==undefined&&input.paye!==null&&input.paye!=='';
    const paye=payeKnown?amount(input.paye,'PAYE income tax'):null;
    const relevantAmount=payeKnown?money(Math.max(0,incomeTax-paye)):null;
    // Exactly £1,000 and exactly 20% satisfy the tests. Prior payments on
    // account reduce the balance, never the base for next year's instalments.
    const poaRequired=payeKnown&&relevantAmount>=1000&&incomeTax>0&&relevantAmount>=incomeTax*.2;
    const poaEach=payeKnown?(poaRequired?money(relevantAmount/2):0):null;
    const balance=payeKnown?money(incomeTax-paye-paidOnAccount):null;
    const january=payeKnown?money(balance+poaEach):null;
    return {
      year:input.year,personalAllowance:total.personalAllowance,
      adjustedNetIncome:money(total.adjustedNetIncome),adjustedTotalIncome:money(adjustedTotalIncome),
      taxableIncome:money(total.taxableIncome),grossPension:money(grossPension),grossGiftAid:money(grossGiftAid),
      propertyProfit:money(propertyProfit),taxablePropertyProfit:money(taxablePropertyProfit),
      lossUsed:money(lossUsed),lossCarryForward:money(lossCarryForward),
      financeRelief:money(financeRelief),financeUsed:money(financeUsed),financeCarryForward:money(financeAvailable-financeUsed),
      incomeTax,employmentOnlyTax,rentalTax:money(incomeTax-employmentOnlyTax),
      balance,poaEach,january,july:poaEach,payeKnown,paye,relevantAmount,poaRequired,
      bands:total.bands,januaryDate:(Number(input.year)+2)+'-01-31',julyDate:(Number(input.year)+2)+'-07-31'
    };
  }
  return Object.freeze({years,rules,calculate});
});

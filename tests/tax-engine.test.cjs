const test=require('node:test');
const assert=require('node:assert/strict');
const tax=require('../tax-engine.js');
const calc=(extra={})=>tax.calculate({year:'2026',employment:50000,rentalIncome:0,expenses:0,financeCosts:0,paye:7486,...extra});

test('£50,000 employment baseline and January deadline',()=>{
  const r=calc(); assert.equal(r.incomeTax,7486);assert.equal(r.balance,0);assert.equal(r.poaEach,0);assert.equal(r.januaryDate,'2028-01-31');
});
test('rental income crosses remaining £270 basic band; finance credit applied separately',()=>{
  const r=calc({rentalIncome:18000,expenses:3000,financeCosts:8000});
  assert.equal(r.propertyProfit,15000);assert.equal(r.incomeTax,11832);assert.equal(r.rentalTax,4346);
  assert.equal(r.financeRelief,1600);assert.equal(r.poaEach,2173);assert.equal(r.january,6519);assert.equal(r.july,2173);
});
test('property loss cannot reduce employment tax and carries forward',()=>{
  const r=calc({rentalIncome:5000,expenses:8000,lossBroughtForward:1000,financeCosts:2000});
  assert.equal(r.incomeTax,7486);assert.equal(r.taxablePropertyProfit,0);assert.equal(r.lossCarryForward,4000);assert.equal(r.financeCarryForward,2000);
});
test('brought-forward losses used before finance reducer limit',()=>{
  const r=calc({rentalIncome:10000,lossBroughtForward:8000,financeCosts:4000,financeBroughtForward:500});
  assert.equal(r.lossUsed,8000);assert.equal(r.taxablePropertyProfit,2000);assert.equal(r.financeRelief,400);assert.equal(r.financeCarryForward,2500);
});
test('finance relief limited to income above personal allowance',()=>{
  const r=calc({employment:0,paye:0,rentalIncome:15000,financeCosts:10000});
  assert.equal(r.adjustedTotalIncome,2430);assert.equal(r.financeRelief,486);assert.equal(r.incomeTax,0);assert.equal(r.financeCarryForward,7570);
});
test('personal allowance taper and additional-rate boundary',()=>{
  assert.equal(calc({employment:110000}).personalAllowance,7570);
  assert.equal(calc({employment:125140}).personalAllowance,0);
  const r=calc({employment:125141});assert.equal(r.bands[2].amount,1);assert.equal(r.incomeTax,42516.45);
});
test('eligible relief-at-source pension extends bands and reduces ANI once',()=>{
  const r=calc({employment:60000,pensionNet:8000});
  assert.equal(r.grossPension,10000);assert.equal(r.adjustedNetIncome,50000);assert.equal(r.incomeTax,9486);
  const high=calc({employment:150000,pensionNet:24000});
  assert.equal(high.adjustedNetIncome,120000);assert.equal(high.personalAllowance,2570);assert.equal(high.bands[2].amount,0);
});
test('Gift Aid extends bands but not adjusted total income for finance relief',()=>{
  const r=calc({employment:60000,giftAidNet:8000});assert.equal(r.incomeTax,9486);assert.equal(r.adjustedNetIncome,50000);assert.equal(r.adjustedTotalIncome,47430);
});
test('missing PAYE hides payment estimates; explicit zero is known',()=>{
  const r=calc({paye:''});assert.equal(r.payeKnown,false);assert.equal(r.january,null);assert.equal(r.poaEach,null);
  assert.equal(calc({paye:0}).payeKnown,true);
});
test('POA exact £1,000 threshold and 80% deduction boundary',()=>{
  assert.equal(calc({employment:17570,paye:0}).poaEach,500);
  assert.equal(calc({employment:17569.95,paye:0}).poaEach,0);
  assert.equal(calc({employment:37570,paye:4000}).poaEach,500);
  assert.equal(calc({employment:37570,paye:4000.01}).poaEach,0);
});
test('payments already made do not alter the following-year POA base',()=>{
  const a=calc({rentalIncome:15000}),b=calc({rentalIncome:15000,paidOnAccount:6000});
  assert.equal(b.poaEach,a.poaEach);assert.equal(b.balance,a.balance-6000);assert.ok(b.balance<0);
});
test('historical tables use each year’s allowance and additional band endpoint',()=>{
  assert.equal(calc({year:'2020'}).incomeTax,7500);
  assert.equal(calc({year:'2022',employment:140000}).bands[2].amount,0);
  assert.equal(calc({year:'2023',employment:140000}).bands[2].amount,14860);
  assert.deepEqual(tax.years,['2020','2021','2022','2023','2024','2025','2026']);
});
test('unsupported future years and invalid numeric inputs fail explicitly',()=>{
  for(const value of [-1,'abc',Infinity,NaN,{},'  ',true,'0x10','1e999','-0.5','0b100'])assert.throws(()=>calc({expenses:value}));
  assert.throws(()=>calc({year:'2027'}));assert.throws(()=>calc({year:2026}));
});
test('HTML decimal and exponent notation work without accepting non-decimal forms',()=>{
  assert.equal(calc({employment:'5e4'}).incomeTax,7486);
  assert.equal(calc({rentalIncome:'.5'}).rentalTax,.1);
  assert.equal(calc({rentalIncome:'1.5e+3'}).rentalTax,546);
  assert.equal(calc({rentalIncome:'5e-1'}).rentalTax,.1);
});

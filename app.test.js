// Browser-level tests: the real index.html + app.js in jsdom. Run with `npm test`.
const test = require('node:test');
const assert = require('node:assert');
const { boot, inv } = require('./test-helpers.js');
const { localISODate, addDays, addMonths } = require('./lib.js');

test('app starts when the browser blocks storage', () => {
  const { $, d } = boot({ blockStorage: true });
  assert.strictEqual(d.querySelectorAll('#itemsBody tr').length, 1);
  assert.ok($('#invNumber').value);
});

test('Paid on an unsaved draft leaves a saved invoice with the same number alone', () => {
  const { $, d, type, saved } = boot({ seed: { 'invoice-list': { 'INV-0003': inv('INV-0003'), 'INV-0004': inv('INV-0004') } } });
  [...d.querySelectorAll('.ledger-row')].find(r => r.textContent.includes('INV-0003')).click();
  $('#newInvoiceBtn').click();
  type('#invNumber', 'INV-0004');
  type('#paid', true);
  assert.strictEqual(saved()['INV-0004'].paid, false);
});

test('Paid on an opened saved invoice updates its saved copy', () => {
  const { d, type, saved } = boot({ seed: { 'invoice-list': { 'INV-0003': inv('INV-0003') } } });
  d.querySelector('.ledger-row').click();
  type('#paid', true);
  assert.strictEqual(saved()['INV-0003'].paid, true);
});

test('New from an old invoice skips numbers already saved', () => {
  const { $, d } = boot({ seed: { 'invoice-list': { 'INV-0003': inv('INV-0003'), 'INV-0004': inv('INV-0004') } } });
  [...d.querySelectorAll('.ledger-row')].find(r => r.textContent.includes('INV-0003')).click();
  $('#newInvoiceBtn').click();
  assert.strictEqual($('#invNumber').value, 'INV-0005');
});

test('totals update from line items and VAT', () => {
  const { $, d, type } = boot();
  const row = d.querySelector('#itemsBody tr');
  type(row.querySelector('.item-qty'), '2');
  type(row.querySelector('.item-price'), '100');
  type('#vatToggle', true);
  assert.match($('#grandTotal').textContent, /230/);
  assert.strictEqual($('.doc-title').textContent, 'TAX INVOICE');
});

test('discount lowers the grand total (before VAT), saves and restores', () => {
  const { $, d, type, saved } = boot();
  const row = d.querySelector('#itemsBody tr');
  type(row.querySelector('.item-qty'), '2');
  type(row.querySelector('.item-price'), '100');
  type('#vatToggle', true);
  type('#discountValue', '10'); // 10% off 200 = 180, +15% VAT = 207
  assert.match($('#grandTotal').textContent, /207/);
  assert.match($('#discountAmount').textContent, /-R\s*20/);
  assert.strictEqual($('#discountPrintLabel').textContent, 'Discount (10%)');
  assert.ok(!$('#discountRow').classList.contains('discount-zero'));
  type('#discountType', 'amount');
  type('#discountValue', '50'); // 150 + 22.50
  assert.match($('#grandTotal').textContent, /172/);
  assert.strictEqual($('#discountPrintLabel').textContent, 'Discount');
  $('#saveInvoiceBtn').click();
  const num = $('#invNumber').value;
  assert.strictEqual(saved()[num].discountType, 'amount');
  assert.strictEqual(saved()[num].discountValue, '50');
  $('#newInvoiceBtn').click();
  assert.strictEqual($('#discountValue').value, '');
  assert.ok($('#discountRow').classList.contains('discount-zero'));
  d.querySelector('.ledger-row').click();
  assert.strictEqual($('#discountValue').value, '50');
  assert.match($('#grandTotal').textContent, /172/);
});

test('ledger total includes the discount', () => {
  const { d } = boot({ seed: { 'invoice-list': { 'INV-0001': inv('INV-0001', { discountType: 'percent', discountValue: '50' }) } } });
  assert.match(d.querySelector('.ledger-amount').textContent, /50/);
});

test('old saved invoice without discount or unit opens cleanly', () => {
  const old = inv('INV-0007');
  const { $, d, w } = boot({ seed: { 'invoice-list': { 'INV-0007': old } } });
  d.querySelector('.ledger-row').click();
  assert.strictEqual($('#discountValue').value, '');
  assert.strictEqual($('#discountType').value, 'percent');
  assert.strictEqual($('.item-unit').value, '');
  assert.match($('#grandTotal').textContent, /100/);
  assert.ok($('#discountRow').classList.contains('discount-zero'));
  assert.strictEqual(w.alerts.length, 0);
});

test('unit is saved and restored; qty accepts fractions', () => {
  const { $, d, type, saved } = boot();
  const row = d.querySelector('#itemsBody tr');
  assert.strictEqual(row.querySelector('.item-qty').step, 'any');
  type(row.querySelector('.item-qty'), '1.5');
  type(row.querySelector('.item-unit'), 'hrs');
  type(row.querySelector('.item-price'), '100');
  assert.match($('#grandTotal').textContent, /150/);
  $('#saveInvoiceBtn').click();
  assert.strictEqual(Object.values(saved())[0].items[0].unit, 'hrs');
  $('#newInvoiceBtn').click();
  assert.strictEqual($('.item-unit').value, '');
  d.querySelector('.ledger-row').click();
  assert.strictEqual($('.item-unit').value, 'hrs');
});

test('move down then up reorders rows, saves the order and keeps focus on the button', () => {
  const { $, d, type, saved } = boot();
  $('#addItem').click();
  $('#addItem').click();
  const descs = () => [...d.querySelectorAll('.item-desc')].map(t => t.value);
  [...d.querySelectorAll('.item-desc')].forEach((t, i) => type(t, 'ABC'[i]));
  const draft = () => JSON.parse(d.defaultView.localStorage.getItem('invoice-draft')).items.map(i => i.desc);
  const rows = () => [...d.querySelectorAll('#itemsBody tr')];
  rows()[0].querySelector('.move-down').click();
  assert.deepStrictEqual(descs(), ['B', 'A', 'C']);
  assert.deepStrictEqual(draft(), ['B', 'A', 'C']);
  assert.strictEqual(d.activeElement, rows()[1].querySelector('.move-down'));
  rows()[1].querySelector('.move-down').click();
  assert.deepStrictEqual(descs(), ['B', 'C', 'A']);
  assert.strictEqual(rows()[2].querySelector('.move-down').getAttribute('aria-disabled'), 'true');
  rows()[2].querySelector('.move-down').click(); // no-op at the end
  assert.deepStrictEqual(descs(), ['B', 'C', 'A']);
  rows()[2].querySelector('.move-up').click();
  assert.deepStrictEqual(draft(), ['B', 'A', 'C']);
  $('#saveInvoiceBtn').click();
  assert.deepStrictEqual(Object.values(saved())[0].items.map(i => i.desc), ['B', 'A', 'C']);
});

test('Prices include VAT: extracts VAT, relabels the totals and is kept by New invoice', () => {
  const { $, d, type, saved } = boot();
  const row = d.querySelector('#itemsBody tr');
  type(row.querySelector('.item-price'), '115');
  assert.ok($('#vatInclusiveRow').hidden); // only offered when VAT is on
  type('#vatToggle', true);
  assert.ok(!$('#vatInclusiveRow').hidden);
  assert.match($('#grandTotal').textContent, /132[,.]25/);
  assert.strictEqual($('#subtotalLabel').textContent, 'Subtotal (excl. VAT)');
  assert.ok($('#netRow').hidden);
  type('#vatInclusive', true);
  assert.match($('#grandTotal').textContent, /115[,.]00/);
  assert.match($('#vatAmount').textContent, /15[,.]00/);
  assert.match($('#netAmount').textContent, /100[,.]00/);
  assert.ok(!$('#netRow').hidden);
  assert.strictEqual($('#subtotalLabel').textContent, 'Subtotal (incl. VAT)');
  assert.strictEqual($('#totalLabel').textContent, 'Total incl. VAT');
  assert.strictEqual($('#vatPrintLabel').textContent, 'VAT (15%)');
  assert.strictEqual($('.doc-title').textContent, 'TAX INVOICE');
  $('#saveInvoiceBtn').click();
  assert.strictEqual(Object.values(saved())[0].vatInclusive, true);
  $('#newInvoiceBtn').click();
  assert.ok($('#vatInclusive').checked);
  assert.strictEqual(d.querySelectorAll('#itemsBody tr').length, 1);
  type('#vatToggle', false); // inclusive only counts while VAT is on
  type(d.querySelector('.item-price'), '115');
  assert.match($('#grandTotal').textContent, /115[,.]00/);
  assert.strictEqual($('#totalLabel').textContent, 'Total due');
  assert.ok($('#netRow').hidden);
});

test('per-line VAT category changes VAT, marks the line for print, saves and restores', () => {
  const { $, d, type, saved } = boot();
  $('#addItem').click();
  const rows = () => [...d.querySelectorAll('#itemsBody tr')];
  rows().forEach(tr => type(tr.querySelector('.item-price'), '100'));
  type('#vatToggle', true);
  assert.match($('#vatAmount').textContent, /30[,.]00/);
  assert.ok(rows().every(tr => tr.querySelector('.item-vatcat').value === 'standard'));
  type(rows()[1].querySelector('.item-vatcat'), 'zero');
  assert.match($('#vatAmount').textContent, /15[,.]00/);
  assert.match($('#grandTotal').textContent, /215[,.]00/);
  assert.strictEqual(rows()[1].querySelector('.vat-mark').textContent, 'Zero-rated');
  assert.strictEqual(rows()[0].querySelector('.vat-mark').textContent, '');
  // mixed: standard and zero-rated rows shown, exempt (nil) not
  assert.ok(!$('#catStandardRow').hidden && !$('#catZeroRow').hidden && $('#catExemptRow').hidden);
  assert.strictEqual($('#catStandardLabel').textContent, 'Standard-rated (15%)');
  assert.ok(!$('#netRow').hidden);
  $('#saveInvoiceBtn').click();
  assert.deepStrictEqual(Object.values(saved())[0].items.map(i => i.vatCat), ['standard', 'zero']);
  $('#newInvoiceBtn').click();
  assert.strictEqual(d.querySelector('.item-vatcat').value, 'standard');
  assert.ok($('#catZeroRow').hidden);
  d.querySelector('.ledger-row').click();
  assert.deepStrictEqual(rows().map(tr => tr.querySelector('.item-vatcat').value), ['standard', 'zero']);
  assert.match($('#grandTotal').textContent, /215[,.]00/);
  type(rows()[1].querySelector('.item-vatcat'), 'exempt');
  assert.strictEqual(rows()[1].querySelector('.vat-mark').textContent, 'VAT exempt');
  type(rows()[0].querySelector('.item-vatcat'), 'exempt'); // exempt only: no VAT, no breakdown
  assert.match($('#vatAmount').textContent, /0[,.]00/);
  assert.match($('#grandTotal').textContent, /200[,.]00/);
  assert.ok($('#catExemptRow').hidden);
  type('#vatToggle', false); // categories and print marks only apply with VAT on
  assert.strictEqual(d.body.dataset.vat, 'off');
  assert.strictEqual(rows()[1].querySelector('.vat-mark').textContent, '');
  assert.ok($('#vatRow').classList.contains('vat-off'));
});

test('old saved VAT invoice opens with prices excl. VAT, every line standard, same total', () => {
  const old = inv('INV-0008', { vatToggle: true, items: [{ desc: 'Work', qty: '2', price: '100' }, { desc: 'More', qty: '1', price: '50' }] });
  const { $, d } = boot({ seed: { 'invoice-list': { 'INV-0008': old }, 'invoice-draft': { ...old, vatInclusive: true } } });
  assert.match(d.querySelector('.ledger-amount').textContent, /287[,.]50/);
  d.querySelector('.ledger-row').click();
  assert.ok(!$('#vatInclusive').checked);
  assert.ok([...d.querySelectorAll('.item-vatcat')].every(s => s.value === 'standard'));
  assert.match($('#grandTotal').textContent, /287[,.]50/);
  assert.ok($('#catStandardRow').hidden && $('#catZeroRow').hidden && $('#catExemptRow').hidden);
});

test('ledger total matches the sheet for an inclusive, mixed, discounted invoice', () => {
  const { $, d, type } = boot();
  $('#addItem').click();
  $('#addItem').click();
  const rows = [...d.querySelectorAll('#itemsBody tr')];
  [['3', '33.33', 'standard'], ['1', '99.99', 'zero'], ['2', '1.99', 'exempt']].forEach(([qty, price, cat], i) => {
    type(rows[i].querySelector('.item-qty'), qty);
    type(rows[i].querySelector('.item-price'), price);
    type(rows[i].querySelector('.item-vatcat'), cat);
  });
  type('#vatToggle', true);
  type('#vatInclusive', true);
  type('#discountValue', '7');
  $('#saveInvoiceBtn').click();
  const onScreen = $('#grandTotal').textContent;
  assert.strictEqual(d.querySelector('.ledger-amount').textContent, onScreen);
  // 99.99 + 99.99 + 3.98 = 203.96 incl., less 7% (14.28) = 189.68
  assert.match(onScreen, /189[,.]68/);
  assert.ok(!$('#catStandardRow').hidden && !$('#catZeroRow').hidden && !$('#catExemptRow').hidden);
});

// Fills the first line with R1000, saves it and adds payments through the real form.
function payFixture(extra = {}) {
  const t = boot(extra);
  t.type(t.d.querySelector('.item-price'), '1000');
  t.type('#toName', 'Client');
  t.$('#saveInvoiceBtn').click();
  return t;
}
const addPay = ({ $, type }, amount, note = '') => { type('#payAmount', amount); type('#payNote', note); $('#addPaymentBtn').click(); };

test('payments: Paid and Balance due rows, ledger balance, save and restore', () => {
  const t = payFixture();
  const { $, d, saved } = t;
  assert.ok($('#paidRow').hidden && $('#balanceRow').hidden);
  addPay(t, '200', 'Deposit');
  addPay(t, '300', 'EFT');
  assert.ok(!$('#paidRow').hidden && !$('#balanceRow').hidden);
  assert.match($('#paidAmount').textContent, /-R\s*500[,.]00/);
  assert.match($('#balanceAmount').textContent, /500[,.]00/);
  assert.strictEqual(d.querySelectorAll('#paymentList li').length, 2);
  assert.match(d.querySelector('#paymentList li').textContent, /Deposit/);
  // saved copy updated at once (the invoice is open), ledger shows balance of total and Part paid
  const num = $('#invNumber').value;
  assert.strictEqual(saved()[num].payments.length, 2);
  assert.match(d.querySelector('.ledger-amount').textContent, /500[,.]00.*of.*1.?000[,.]00/);
  assert.strictEqual(d.querySelector('.ledger-status').textContent, 'Part paid');
  assert.strictEqual(d.querySelector('.ledger-row').dataset.status, 'part paid');
  assert.ok($('#stamp').hidden); // no PART PAID stamp
  // restore
  $('#newInvoiceBtn').click();
  assert.strictEqual(d.querySelectorAll('#paymentList li').length, 0);
  d.querySelector('.ledger-row').click();
  assert.strictEqual(d.querySelectorAll('#paymentList li').length, 2);
  assert.match($('#balanceAmount').textContent, /500[,.]00/);
});

test('payments: blank or invalid amount is rejected; remove button updates totals and saved copy', () => {
  const t = payFixture();
  const { $, d, saved, w } = t;
  addPay(t, '');
  addPay(t, '-5');
  assert.strictEqual(d.querySelectorAll('#paymentList li').length, 0);
  assert.ok($('#paymentMsg').textContent);
  addPay(t, '250');
  addPay(t, '100');
  assert.match($('#balanceAmount').textContent, /650[,.]00/);
  const btn = d.querySelector('#paymentList li .del-row');
  assert.match(btn.getAttribute('aria-label'), /Remove payment of/);
  btn.click();
  assert.match($('#balanceAmount').textContent, /900[,.]00/);
  assert.strictEqual(saved()[$('#invNumber').value].payments.length, 1);
  d.querySelector('#paymentList li .del-row').click();
  assert.ok($('#paidRow').hidden);
  assert.strictEqual(w.alerts.length, 0);
});

test('payments covering the total make the invoice Paid with a stamp; overpayment shows a zero balance', () => {
  const t = payFixture();
  const { $, d } = t;
  addPay(t, '600');
  addPay(t, '400');
  assert.strictEqual($('#stamp').textContent, 'Paid');
  assert.match($('#balanceAmount').textContent, /0[,.]00/);
  assert.strictEqual(d.querySelector('.ledger-status').textContent, 'Paid');
  assert.match(d.querySelector('.ledger-amount').textContent, /^R\s*1.?000[,.]00$/);
  addPay(t, '50'); // overpay
  assert.match($('#balanceAmount').textContent, /^R\s*0[,.]00$/);
  assert.strictEqual($('#stamp').textContent, 'Paid');
});

test('overdue invoice with a part payment stays Overdue and the ledger still shows the balance', () => {
  const t = payFixture();
  t.type('#terms', 'custom');
  t.type('#dueDate', '2020-01-01');
  t.$('#saveInvoiceBtn').click();
  addPay(t, '100');
  assert.strictEqual(t.$('#stamp').textContent, 'Overdue');
  assert.strictEqual(t.d.querySelector('.ledger-status').textContent, 'Overdue');
  assert.match(t.d.querySelector('.ledger-amount').textContent, /900[,.]00.*of/);
});

test('New invoice, switching type and Convert do not carry payments', () => {
  const t = payFixture();
  const { $, d } = t;
  addPay(t, '100');
  $('#newInvoiceBtn').click();
  assert.strictEqual(d.querySelectorAll('#paymentList li').length, 0);
  assert.ok($('#paidRow').hidden);
  d.querySelector('.ledger-row').click();
  t.type('#docType', 'quote');
  assert.strictEqual(d.querySelectorAll('#paymentList li').length, 0);
  assert.ok($('#paidRow').hidden);
  assert.strictEqual(JSON.parse(t.w.localStorage.getItem('invoice-draft')).payments.length, 0);
});

test('Convert from a saved quote marks that quote accepted; the new invoice has no payments or quote status', () => {
  const quote = inv('QUO-0001', { docType: 'quote', dueDate: '2020-01-01', payments: [{ amount: '5' }] });
  const { $, d, saved } = boot({ seed: { 'invoice-list': { 'QUO-0001': quote } } });
  d.querySelector('.ledger-row').click();
  assert.strictEqual(d.querySelector('.ledger-status').textContent, 'Expired');
  $('#convertBtn').click();
  assert.strictEqual(saved()['QUO-0001'].quoteStatus, 'accepted');
  assert.strictEqual(saved()['QUO-0001'].docType, 'quote');
  assert.strictEqual($('#docType').value, 'invoice');
  assert.strictEqual($('#quoteStatus').value, '');
  assert.strictEqual(d.querySelectorAll('#paymentList li').length, 0);
  assert.strictEqual(Object.keys(saved()).length, 1);
  assert.ok([...d.querySelectorAll('.ledger-row')].some(r => r.querySelector('.ledger-status').textContent === 'Accepted'));
});

test('Convert from an unsaved quote does not touch a saved quote with the same number', () => {
  const { $, d, type, saved } = boot({ seed: { 'invoice-list': { 'QUO-0001': inv('QUO-0001', { docType: 'quote' }) } } });
  type('#docType', 'quote');
  type('#invNumber', 'QUO-0001');
  $('#convertBtn').click();
  assert.strictEqual(saved()['QUO-0001'].quoteStatus, undefined);
});

test('quote status on an opened saved quote updates its saved copy, the stamp and the ledger', () => {
  const quote = inv('QUO-0002', { docType: 'quote', dueDate: '2020-01-01' });
  const { $, d, type, saved } = boot({ seed: { 'invoice-list': { 'QUO-0002': quote } } });
  d.querySelector('.ledger-row').click();
  assert.strictEqual($('#stamp').textContent, 'Expired');
  type('#quoteStatus', 'accepted');
  assert.strictEqual(saved()['QUO-0002'].quoteStatus, 'accepted');
  assert.strictEqual($('#stamp').textContent, 'Accepted'); // beats Expired
  assert.strictEqual(d.querySelector('.ledger-status').textContent, 'Accepted');
  type('#quoteStatus', 'declined');
  assert.strictEqual(saved()['QUO-0002'].quoteStatus, 'declined');
  assert.strictEqual($('#stamp').textContent, 'Declined');
  d.querySelector('.ledger-row').click(); // restores from the saved copy
  assert.strictEqual($('#quoteStatus').value, 'declined');
  $('#newInvoiceBtn').click();
  assert.strictEqual($('#quoteStatus').value, '');
});

test('quote status on an unsaved quote leaves saved quotes alone', () => {
  const { $, type, saved } = boot({ seed: { 'invoice-list': { 'QUO-0002': inv('QUO-0002', { docType: 'quote' }) } } });
  type('#docType', 'quote');
  type('#invNumber', 'QUO-0002');
  type('#quoteStatus', 'declined');
  assert.strictEqual(saved()['QUO-0002'].quoteStatus, undefined);
});

test('old saved invoice and quote without payments / quoteStatus open cleanly', () => {
  const { $, d, w } = boot({ seed: { 'invoice-list': { 'INV-0001': inv('INV-0001'), 'QUO-0001': inv('QUO-0001', { docType: 'quote' }) } } });
  // dirty the form first: nothing from it may leak into the old saves
  d.querySelectorAll('.ledger-row').forEach(row => {
    row.click();
    assert.strictEqual(d.querySelectorAll('#paymentList li').length, 0);
    assert.ok($('#paidRow').hidden);
    assert.strictEqual($('#quoteStatus').value, '');
  });
  assert.strictEqual(w.alerts.length, 0);
});

test('payment data from an imported file is shown as text, not markup', () => {
  const evil = inv('INV-0009', { payments: [{ date: '2026-01-02', amount: '5', note: '<img src=x onerror=alert(1)>' }, null, 'junk'] });
  const { d } = boot({ seed: { 'invoice-list': { 'INV-0009': evil } } });
  d.querySelector('.ledger-row').click();
  assert.strictEqual(d.querySelectorAll('#paymentList img').length, 0);
  assert.strictEqual(d.querySelectorAll('#paymentList li').length, 1);
});

// --- Credit notes ---
// A saved VAT invoice, R100 + R50 standard-rated + 15% = R172.50, opened from the ledger.
function creditFixture(extra = {}, seed = {}) {
  const original = inv('INV-0003', { vatToggle: true, vatRate: '15', fromName: 'Me Studio', fromDetails: 'Cape Town', toName: 'Client',
    toDetails: '1 Main Rd', toEmail: 'c@example.com', currency: 'ZAR', dueDate: '2099-01-01', terms: '7',
    items: [{ desc: 'Design', qty: '1', unit: 'job', price: '100', vatCat: 'standard' }, { desc: 'Print', qty: '1', price: '50', vatCat: 'standard' }], ...extra });
  const t = boot({ seed: { 'invoice-list': { 'INV-0003': original, ...seed } } });
  const row = num => [...t.d.querySelectorAll('.ledger-row')].find(r => r.querySelector('.ledger-num').textContent === num);
  row('INV-0003').click();
  return { ...t, row };
}
const today = () => require('./lib.js').localISODate(new Date());

test('credit note from a saved invoice copies it, numbers CN-0001, shows the reference and hides the due date', () => {
  const { $, d, type, saved, w } = creditFixture({ vatInclusive: true, currency: 'USD',
    items: [{ desc: 'Design', qty: '2', unit: 'hrs', price: '100', vatCat: 'standard' }, { desc: 'Books', qty: '1', price: '50', vatCat: 'zero' }] });
  assert.ok(!$('#creditNoteBtn').hidden);
  $('#creditNoteBtn').click();
  assert.strictEqual($('#docType').value, 'credit');
  assert.strictEqual(d.body.dataset.doc, 'credit');
  assert.strictEqual($('#invNumber').value, 'CN-0001');
  assert.strictEqual($('#invDate').value, today());
  assert.strictEqual($('#creditRef').textContent, 'Credit note for invoice INV-0003');
  assert.ok($('#dueRow').hidden);
  assert.strictEqual($('#dueDate').value, '');
  assert.strictEqual($('.doc-title').textContent, 'CREDIT NOTE'); // VAT on: still not "tax credit note"
  assert.strictEqual($('label[for=invNumber]').textContent, 'Credit note #');
  assert.strictEqual($('#newInvoiceBtn').textContent, 'New credit note');
  assert.strictEqual($('#creditReason').value, '');
  assert.strictEqual(d.activeElement, $('#creditReason'));
  // copied: parties, currency, VAT settings, lines with their categories
  assert.strictEqual($('#fromName').value, 'Me Studio');
  assert.strictEqual($('#toName').value, 'Client');
  assert.strictEqual($('#toDetails').value, '1 Main Rd');
  assert.strictEqual($('#currency').value, 'USD');
  assert.ok($('#vatToggle').checked && $('#vatInclusive').checked);
  assert.strictEqual($('#vatRate').value, '15');
  assert.deepStrictEqual([...d.querySelectorAll('.item-desc')].map(t => t.value), ['Design', 'Books']);
  assert.deepStrictEqual([...d.querySelectorAll('.item-vatcat')].map(s => s.value), ['standard', 'zero']);
  assert.strictEqual($('.item-unit').value, 'hrs');
  assert.match($('#grandTotal').textContent, /250\.00/); // positive, same total as the invoice
  assert.strictEqual($('#totalLabel').textContent, 'Total credit incl. VAT');
  assert.ok($('#paidRow').hidden && $('#creditedRow').hidden && $('#balanceRow').hidden);
  assert.ok($('#stamp').hidden);
  // unsaved: nothing new in the list, Credit note / Delete gone
  assert.deepStrictEqual(Object.keys(saved()), ['INV-0003']);
  assert.ok($('#creditNoteBtn').hidden && $('#deleteInvoiceBtn').hidden);
  type('#vatToggle', false);
  assert.strictEqual($('.doc-title').textContent, 'CREDIT NOTE');
  assert.strictEqual($('#totalLabel').textContent, 'Total credit');
  $('#printBtn').click();
  assert.strictEqual(d.title, 'Credit note CN-0001 - Client');
  assert.strictEqual(w.alerts.length, 0);
});

test('credit note needs a reason; saved with its reference and reason', () => {
  const { $, type, saved, w } = creditFixture();
  $('#creditNoteBtn').click();
  $('#saveInvoiceBtn').click();
  assert.strictEqual(w.alerts.length, 1);
  assert.match(w.alerts[0], /reason/i);
  assert.ok(!saved()['CN-0001']);
  type('#creditReason', '   ');
  $('#saveInvoiceBtn').click();
  assert.ok(!saved()['CN-0001']);
  type('#creditReason', 'Print job cancelled');
  $('#saveInvoiceBtn').click();
  const cn = saved()['CN-0001'];
  assert.strictEqual(cn.docType, 'credit');
  assert.strictEqual(cn.creditFor, 'INV-0003');
  assert.strictEqual(cn.creditReason, 'Print job cancelled');
  assert.strictEqual(cn.dueDate, '');
  assert.strictEqual(w.alerts.length, 2);
  assert.strictEqual(saved()['INV-0003'].docType, 'invoice'); // the original is untouched
});

test('credit note over what is left on the invoice is blocked', () => {
  const { $, d, type, saved, w, row } = creditFixture();
  $('#creditNoteBtn').click();
  type('#creditReason', 'Overcharged');
  type(d.querySelector('.item-price'), '101'); // 151 + VAT = 173.65 > 172.50
  $('#saveInvoiceBtn').click();
  assert.strictEqual(w.alerts.length, 1);
  assert.match(w.alerts[0], /more than is left to credit on invoice INV-0003/);
  assert.ok(!saved()['CN-0001']);
  d.querySelectorAll('.del-row')[1].click(); // credit just the R100 line: 115
  type(d.querySelector('.item-price'), '100');
  $('#saveInvoiceBtn').click();
  assert.ok(saved()['CN-0001']);
  // a second credit note may only take the remaining 57.50
  row('INV-0003').click();
  $('#creditNoteBtn').click();
  assert.strictEqual($('#invNumber').value, 'CN-0002');
  type('#creditReason', 'Again');
  $('#saveInvoiceBtn').click();
  assert.strictEqual(w.alerts.length, 2);
  assert.ok(!saved()['CN-0002']);
  d.querySelectorAll('.del-row')[0].click(); // the R50 line only: 57.50, exactly what's left
  $('#saveInvoiceBtn').click();
  assert.ok(saved()['CN-0002']);
  assert.strictEqual(w.alerts.length, 2);
  // re-saving the opened CN-0001 doesn't count its own old copy
  row('CN-0001').click();
  type('#creditReason', 'Overcharged on design');
  $('#saveInvoiceBtn').click();
  assert.strictEqual(saved()['CN-0001'].creditReason, 'Overcharged on design');
  assert.strictEqual(w.alerts.length, 2);
});

test('saving a credit note lowers the invoice balance in the ledger and on its sheet; full credit is Credited', () => {
  const { $, d, type, w, row } = creditFixture();
  $('#creditNoteBtn').click();
  type('#creditReason', 'Print cancelled');
  d.querySelectorAll('.del-row')[0].click(); // credit the R50 line: 57.50
  $('#saveInvoiceBtn').click();
  assert.match(row('CN-0001').querySelector('.ledger-amount').textContent, /^-R\s*57[,.]50$/);
  assert.strictEqual(row('CN-0001').querySelector('.ledger-status').textContent, 'Credit for INV-0003');
  assert.strictEqual(row('CN-0001').dataset.status, 'credit');
  assert.match(row('INV-0003').querySelector('.ledger-amount').textContent, /115[,.]00.*of.*172[,.]50/);
  // the original's sheet: Credited row under Paid, balance accounts for it, no stamp
  row('INV-0003').click();
  assert.ok(!$('#creditedRow').hidden && !$('#balanceRow').hidden && $('#paidRow').hidden);
  assert.match($('#creditedAmount').textContent, /-R\s*57[,.]50/);
  assert.match($('#balanceAmount').textContent, /115[,.]00/);
  assert.ok($('#stamp').hidden);
  // credit + payment covering the rest: Paid
  addPay({ $, type }, '100');
  assert.strictEqual(row('INV-0003').querySelector('.ledger-status').textContent, 'Part paid');
  addPay({ $, type }, '15');
  assert.strictEqual($('#stamp').textContent, 'Paid');
  assert.strictEqual(row('INV-0003').querySelector('.ledger-status').textContent, 'Paid');
  // full credit on its own: Credited
  d.querySelectorAll('#paymentList .del-row')[0].click();
  d.querySelectorAll('#paymentList .del-row')[0].click();
  $('#creditNoteBtn').click();
  type('#creditReason', 'Design cancelled too');
  d.querySelectorAll('.del-row')[1].click(); // the R100 line: 115
  $('#saveInvoiceBtn').click();
  assert.strictEqual(row('INV-0003').querySelector('.ledger-status').textContent, 'Credited');
  assert.strictEqual(row('INV-0003').dataset.status, 'credited');
  assert.match(row('INV-0003').querySelector('.ledger-amount').textContent, /^R\s*172[,.]50$/);
  row('INV-0003').click();
  assert.strictEqual($('#stamp').textContent, 'Credited');
  assert.match($('#balanceAmount').textContent, /^R\s*0[,.]00$/);
  assert.strictEqual(w.alerts.length, 0);
});

test('credit notes for another invoice do not touch this one', () => {
  const other = inv('INV-0001');
  const cn = inv('CN-0001', { docType: 'credit', creditFor: 'INV-0001', creditReason: 'x', items: [{ qty: '1', price: '100' }] });
  const { $, row } = creditFixture({}, { 'INV-0001': other, 'CN-0001': cn });
  assert.ok($('#creditedRow').hidden);
  assert.match(row('INV-0003').querySelector('.ledger-amount').textContent, /^R\s*172[,.]50$/);
  assert.strictEqual(row('INV-0001').querySelector('.ledger-status').textContent, 'Credited');
});

test('Credit note button only for a saved invoice, not drafts, quotes or credit notes', () => {
  const quote = inv('QUO-0001', { docType: 'quote' });
  const cn = inv('CN-0001', { docType: 'credit', creditFor: 'INV-0003', creditReason: 'x', items: [{ qty: '1', price: '10' }] });
  const { $, type, row } = creditFixture({}, { 'QUO-0001': quote, 'CN-0001': cn });
  assert.ok(!$('#creditNoteBtn').hidden);
  $('#newInvoiceBtn').click();
  assert.ok($('#creditNoteBtn').hidden); // unsaved draft
  row('QUO-0001').click();
  assert.ok($('#creditNoteBtn').hidden);
  row('CN-0001').click();
  assert.ok($('#creditNoteBtn').hidden);
  assert.strictEqual($('#creditRef').textContent, 'Credit note for invoice INV-0003');
  row('INV-0003').click();
  type('#docType', 'quote');
  assert.ok($('#creditNoteBtn').hidden);
});

test('fresh app: no Credit note button; choosing Credit note type on a saved invoice credits it', () => {
  const fresh = boot();
  assert.ok(fresh.$('#creditNoteBtn').hidden);
  const { $, type } = creditFixture();
  type('#docType', 'credit');
  assert.strictEqual($('#invNumber').value, 'CN-0001');
  assert.strictEqual($('#creditRef').textContent, 'Credit note for invoice INV-0003');
  assert.strictEqual($('#toName').value, 'Client');
});

test('a credit note not linked to an invoice cannot be saved', () => {
  const { $, type, saved, w } = boot();
  type('#docType', 'credit');
  assert.strictEqual($('#invNumber').value, 'CN-0001');
  type('#creditReason', 'Returned');
  type($('.item-price'), '10');
  $('#saveInvoiceBtn').click();
  assert.match(w.alerts[0], /must be for a saved invoice/);
  assert.deepStrictEqual(saved(), {});
});

test('deleting an invoice with credit notes warns and keeps them', () => {
  const cn = inv('CN-0001', { docType: 'credit', creditFor: 'INV-0003', creditReason: 'x', items: [{ qty: '1', price: '10' }] });
  const { $, w, saved } = creditFixture({}, { 'CN-0001': cn });
  let asked = '';
  w.confirm = msg => { asked = msg; return true; };
  $('#deleteInvoiceBtn').click();
  assert.match(asked, /credit note \(CN-0001\) will stay saved, pointing at a deleted invoice/);
  assert.deepStrictEqual(Object.keys(saved()), ['CN-0001']);
});

test('old saved invoice without credit fields opens cleanly', () => {
  const { $, d, w } = boot({ seed: { 'invoice-list': { 'INV-0001': inv('INV-0001') } } });
  d.querySelector('.ledger-row').click();
  assert.strictEqual($('#docType').value, 'invoice');
  assert.strictEqual($('#creditReason').value, '');
  assert.ok($('#creditedRow').hidden && $('#balanceRow').hidden);
  assert.ok(!$('#creditNoteBtn').hidden && !$('#dueRow').hidden);
  assert.strictEqual($('.doc-title').textContent, 'INVOICE');
  assert.strictEqual(d.querySelector('.ledger-status').textContent, '');
  assert.strictEqual(w.alerts.length, 0);
});

// --- Ledger tools ---
const TODAY = localISODate(new Date());
const ago = n => addDays(TODAY, -n);
const rowNums = d => [...d.querySelectorAll('.ledger-row .ledger-num')].map(e => e.textContent);

// One of each kind: unpaid, overdue, part paid, paid, quote, credit note.
function mixedLedger() {
  return {
    'INV-0001': inv('INV-0001', { toName: 'Acme Ltd', dueDate: addDays(TODAY, 5), items: [{ desc: 'Logo design', qty: '1', price: '100' }] }),
    'INV-0002': inv('INV-0002', { toName: 'Bravo', dueDate: ago(3), items: [{ desc: 'Hosting', qty: '1', price: '250' }] }),
    'INV-0003': inv('INV-0003', { toName: 'Charlie', dueDate: addDays(TODAY, 5), payments: [{ date: TODAY, amount: '40' }] }),
    'INV-0004': inv('INV-0004', { toName: 'Delta', paid: true }),
    'QUO-0001': inv('QUO-0001', { docType: 'quote', toName: 'Echo' }),
    'CN-0001': inv('CN-0001', { docType: 'credit', toName: 'Acme Ltd', creditFor: 'INV-0001', creditReason: 'x', items: [{ qty: '1', price: '10' }] }),
  };
}
const ledgerBoot = (list = mixedLedger(), opts = {}) => boot({ ...opts, seed: { 'invoice-list': list, ...(opts.seed || {}) } });

test('ledger search matches number, client and line description, ignoring case', () => {
  const { $, d, type } = ledgerBoot();
  type('#ledgerSearch', 'bRaVo');
  assert.deepStrictEqual(rowNums(d), ['INV-0002']);
  type('#ledgerSearch', 'logo DESIGN');
  assert.deepStrictEqual(rowNums(d), ['INV-0001']);
  type('#ledgerSearch', 'quo-0001');
  assert.deepStrictEqual(rowNums(d), ['QUO-0001']);
  type('#ledgerSearch', '');
  assert.strictEqual(rowNums(d).length, 6);
  assert.ok($('#ledgerNoMatch').hidden);
});

test('each status filter shows the right documents', () => {
  const { $, d, type } = ledgerBoot();
  const expect = { unpaid: ['INV-0003', 'INV-0002', 'INV-0001'], overdue: ['INV-0002'], part: ['INV-0003'], paid: ['INV-0004'],
    quote: ['QUO-0001'], credit: ['CN-0001'], all: ['QUO-0001', 'INV-0004', 'INV-0003', 'INV-0002', 'INV-0001', 'CN-0001'] };
  for (const [filter, nums] of Object.entries(expect)) {
    type('#ledgerFilter', filter);
    assert.deepStrictEqual(rowNums(d), nums, filter);
  }
  type('#ledgerFilter', 'overdue');
  type('#ledgerSearch', 'acme');
  assert.deepStrictEqual(rowNums(d), []); // filter and search combine
});

test('ledger controls are labelled and the count is a polite live region', () => {
  const { $, type } = ledgerBoot();
  assert.ok($('#ledgerSearch').getAttribute('aria-label'));
  assert.ok($('#ledgerFilter').getAttribute('aria-label'));
  assert.strictEqual($('#ledgerShown').getAttribute('role'), 'status');
  assert.strictEqual($('#ledgerShown').getAttribute('aria-live'), 'polite');
  assert.strictEqual($('#ledgerShown').textContent, '6 of 6 shown');
  type('#ledgerFilter', 'unpaid');
  assert.strictEqual($('#ledgerShown').textContent, '3 of 6 shown');
  type('#ledgerSearch', 'acme');
  assert.strictEqual($('#ledgerShown').textContent, '1 of 6 shown');
});

test('no matches shows its own message, distinct from the empty ledger', () => {
  const { $, type } = ledgerBoot();
  type('#ledgerSearch', 'zzz');
  assert.ok(!$('#ledgerNoMatch').hidden);
  assert.ok($('#ledgerEmpty').hidden);
  assert.strictEqual($('#ledgerShown').textContent, '0 of 6 shown');
  const empty = boot();
  assert.ok(!empty.$('#ledgerEmpty').hidden);
  assert.ok(empty.$('#ledgerNoMatch').hidden && empty.$('#ledgerTools').hidden);
});

test('the chosen filter is remembered across a reload, the search text is not', () => {
  const first = ledgerBoot();
  first.type('#ledgerFilter', 'overdue');
  first.type('#ledgerSearch', 'bravo');
  const seed = {};
  for (let i = 0; i < first.w.localStorage.length; i++) {
    const k = first.w.localStorage.key(i);
    seed[k] = first.w.localStorage.getItem(k);
  }
  const second = boot({ seed });
  assert.strictEqual(second.$('#ledgerFilter').value, 'overdue');
  assert.strictEqual(second.$('#ledgerSearch').value, '');
  assert.deepStrictEqual(rowNums(second.d), ['INV-0002']);
  const junk = boot({ seed: { 'invoice-list': mixedLedger(), 'invoice-ledger-filter': 'bogus' } });
  assert.strictEqual(junk.$('#ledgerFilter').value, 'all');
});

test('totals show outstanding and overdue, credits reduce balances, quotes and credit notes are left out', () => {
  const { $, d } = ledgerBoot();
  // Unpaid: INV-0001 100 less 10 credited = 90, INV-0002 250 (overdue), INV-0003 100 less 40 paid = 60.
  const lines = [...d.querySelectorAll('#ledgerTotals .totals-line')].map(l => l.textContent.replace(/\s+/g, ' '));
  assert.strictEqual(lines.length, 2);
  assert.match(lines[0], /^Outstanding \(3\)/);
  assert.match(lines[0], /400[.,]00$/);
  assert.match(lines[1], /^Overdue \(1\)/);
  assert.match(lines[1], /250[.,]00$/);
  assert.ok(!$('#ledgerTotals').hidden);
  assert.ok(boot().$('#ledgerTotals').hidden);
});

test('totals are grouped by currency, naming each only when there is more than one', () => {
  const list = { 'INV-0001': inv('INV-0001'), 'INV-0002': inv('INV-0002', { currency: 'USD' }) };
  const text = [...ledgerBoot(list).d.querySelectorAll('#ledgerTotals .totals-label')].map(e => e.textContent);
  assert.deepStrictEqual(text, ['USD · Outstanding (1)', 'USD · Overdue', 'ZAR · Outstanding (1)', 'ZAR · Overdue']);
});

function openRow(d, num) { [...d.querySelectorAll('.ledger-row')].find(r => r.querySelector('.ledger-num').textContent === num).click(); }

test('Duplicate copies the document, clears payments, paid and status, and announces it', () => {
  const src = inv('INV-0003', {
    toName: 'Acme', toDetails: '1 Main Rd', toEmail: 'a@x.co', notes: 'Bank: X', currency: 'USD', terms: '14',
    invDate: ago(40), dueDate: ago(26), paid: true, vatToggle: true, vatRate: '15', discountType: 'amount', discountValue: '5',
    payments: [{ date: ago(2), amount: '50', note: 'EFT' }], repeat: 'monthly', lastRepeated: ago(10),
    items: [{ desc: 'Build', qty: '2', unit: 'hrs', price: '60', vatCat: 'zero' }],
  });
  const { $, d, w, saved } = boot({ seed: { 'invoice-list': { 'INV-0003': src, 'INV-0008': inv('INV-0008') } } });
  assert.ok($('#duplicateBtn').hidden);
  openRow(d, 'INV-0003');
  assert.ok(!$('#duplicateBtn').hidden);
  $('#duplicateBtn').click();
  assert.strictEqual($('#invNumber').value, 'INV-0009');
  assert.strictEqual($('#invDate').value, TODAY);
  assert.strictEqual($('#dueDate').value, addDays(TODAY, 14));
  assert.strictEqual($('#toName').value, 'Acme');
  assert.strictEqual($('#toEmail').value, 'a@x.co');
  assert.strictEqual($('#notes').value, 'Bank: X');
  assert.strictEqual($('#currency').value, 'USD');
  assert.strictEqual($('#discountValue').value, '5');
  assert.ok($('#vatToggle').checked);
  assert.strictEqual($('.item-desc').value, 'Build');
  assert.strictEqual($('.item-qty').value, '2');
  assert.strictEqual($('.item-vatcat').value, 'zero');
  assert.ok(!$('#paid').checked);
  assert.strictEqual($('#paymentList').children.length, 0);
  assert.strictEqual($('#repeat').value, '');
  assert.ok($('#repeatWrap').hidden && $('#duplicateBtn').hidden && $('#deleteInvoiceBtn').hidden);
  assert.strictEqual($('#saveStatus').textContent, 'Duplicated INV-0003 as INV-0009. Press Save to keep it.');
  assert.strictEqual(d.activeElement, $('#saveInvoiceBtn'));
  assert.strictEqual(saved()['INV-0009'], undefined); // unsaved until Save
  $('#saveInvoiceBtn').click();
  const copy = saved()['INV-0009'];
  assert.deepStrictEqual([copy.paid, copy.payments, copy.quoteStatus, copy.repeat, copy.lastRepeated], [false, [], '', '', '']);
  assert.strictEqual(saved()['INV-0003'].paid, true); // original untouched
  assert.strictEqual(w.alerts.length, 0);
});

test('Duplicate of a quote stays a quote with a fresh status and a 30-day validity', () => {
  const quote = inv('QUO-0001', { docType: 'quote', quoteStatus: 'accepted' });
  const { $, d } = boot({ seed: { 'invoice-list': { 'QUO-0001': quote } } });
  openRow(d, 'QUO-0001');
  $('#duplicateBtn').click();
  assert.strictEqual($('#docType').value, 'quote');
  assert.strictEqual($('#invNumber').value, 'QUO-0002');
  assert.strictEqual($('#quoteStatus').value, '');
  assert.strictEqual($('#dueDate').value, addDays(TODAY, 30));
});

test('Duplicate is hidden for credit notes', () => {
  const { $, d } = ledgerBoot();
  openRow(d, 'CN-0001');
  assert.ok($('#duplicateBtn').hidden);
  assert.ok($('#repeatWrap').hidden);
  openRow(d, 'INV-0001');
  assert.ok(!$('#duplicateBtn').hidden);
});

test('Repeats select is saved on the invoice and shows for saved invoices only', () => {
  const { $, d, type, saved } = boot({ seed: { 'invoice-list': { 'INV-0001': inv('INV-0001', { invDate: TODAY }) } } });
  assert.ok($('#repeatWrap').hidden);
  openRow(d, 'INV-0001');
  assert.ok(!$('#repeatWrap').hidden);
  assert.strictEqual($('#repeat').value, '');
  type('#repeat', 'monthly');
  assert.strictEqual(saved()['INV-0001'].repeat, 'monthly');
  type('#repeat', '');
  assert.strictEqual(saved()['INV-0001'].repeat, '');
});

test('a due repeating invoice shows a notice; Create makes the dated invoice and the notice goes', () => {
  const start = addMonths(TODAY, -2); // next period was a month ago
  const list = {
    'INV-0005': inv('INV-0005', { toName: 'Retainer Co', invDate: start, dueDate: addDays(start, 7), terms: '7', repeat: 'monthly', paid: true, payments: [{ amount: '100' }] }),
    'INV-0006': inv('INV-0006', { invDate: addMonths(TODAY, -1) }), // not repeating
    'INV-0007': inv('INV-0007', { invDate: TODAY, repeat: 'monthly' }), // next one is in a month
  };
  const { $, d, w, saved } = boot({ seed: { 'invoice-list': list } });
  assert.ok(!$('#repeatDue').hidden);
  const notes = [...d.querySelectorAll('#repeatList li')];
  assert.strictEqual(notes.length, 1);
  assert.match(notes[0].textContent, /INV-0005 · Retainer Co/);
  assert.strictEqual(saved()['INV-0005'].lastRepeated, undefined); // nothing happens on load
  assert.strictEqual(Object.keys(saved()).length, 3);
  notes[0].querySelector('button').click();
  const scheduled = addMonths(start, 1);
  assert.strictEqual($('#invNumber').value, 'INV-0008');
  assert.strictEqual($('#invDate').value, scheduled);
  assert.strictEqual($('#dueDate').value, addDays(scheduled, 7));
  assert.strictEqual($('#toName').value, 'Retainer Co');
  assert.ok(!$('#paid').checked);
  assert.strictEqual($('#paymentList').children.length, 0);
  assert.strictEqual($('#repeat').value, '');
  assert.match($('#saveStatus').textContent, /^Created INV-0008 from INV-0005, dated .*Press Save to keep it\.$/);
  assert.strictEqual(saved()['INV-0005'].lastRepeated, scheduled);
  assert.strictEqual(saved()['INV-0005'].paid, true); // source otherwise untouched
  assert.strictEqual(d.activeElement, $('#saveInvoiceBtn'));
  // The period after that (this month) is due too, so one notice comes back — for the next period only.
  const again = [...d.querySelectorAll('#repeatList li')];
  assert.strictEqual(again.length, 1);
  again[0].querySelector('button').click();
  assert.strictEqual($('#invNumber').value, 'INV-0009'); // the unsaved INV-0008 isn't reused
  assert.strictEqual(saved()['INV-0005'].lastRepeated, addMonths(start, 2));
  assert.ok($('#repeatDue').hidden);
  assert.strictEqual(w.alerts.length, 0);
});

test('saving the open repeating invoice keeps its lastRepeated', () => {
  const list = { 'INV-0001': inv('INV-0001', { invDate: addMonths(TODAY, -1), repeat: 'monthly', lastRepeated: TODAY }) };
  const { $, d, saved } = boot({ seed: { 'invoice-list': list } });
  assert.ok($('#repeatDue').hidden);
  openRow(d, 'INV-0001');
  $('#saveInvoiceBtn').click();
  assert.strictEqual(saved()['INV-0001'].lastRepeated, TODAY);
  assert.strictEqual(saved()['INV-0001'].repeat, 'monthly');
});

test('old saves without repeat fields open cleanly', () => {
  const { $, d, w } = boot({ seed: { 'invoice-list': { 'INV-0001': inv('INV-0001') } } });
  assert.ok($('#repeatDue').hidden);
  openRow(d, 'INV-0001');
  assert.strictEqual($('#repeat').value, '');
  $('#saveInvoiceBtn').click();
  assert.strictEqual(w.alerts.length, 0);
});

test('Export for Zoho Books: downloads only the invoices the ledger lists', async () => {
  const { w, d, $, type } = boot({ seed: { 'invoice-list': {
    'INV-0001': inv('INV-0001', { paid: true }), 'INV-0002': inv('INV-0002'),
    'QUO-0001': inv('QUO-0001', { docType: 'quote' }),
  } } });
  let blob; const clicks = [];
  w.URL.createObjectURL = b => { blob = b; return 'blob:x'; };
  w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = function () { clicks.push(this.download); };
  assert.ok($('#zohoHelp').hidden);
  type('#ledgerFilter', 'unpaid');
  $('#zohoBtn').click();
  assert.deepStrictEqual(clicks, [`zoho-invoices-${localISODate(new Date())}.csv`]);
  const text = await new Promise(res => { const r = new w.FileReader(); r.onload = () => res(r.result); r.readAsText(blob); });
  assert.ok(text.includes('INV-0002') && !text.includes('INV-0001') && !text.includes('QUO-0001'));
  assert.ok(!$('#zohoHelp').hidden);
  $('#zohoHelpClose').click();
  assert.ok($('#zohoHelp').hidden);
});

test('Export for Zoho Books: alerts and downloads nothing when no invoices are listed', () => {
  const { w, $, type } = boot({ seed: { 'invoice-list': { 'QUO-0001': inv('QUO-0001', { docType: 'quote' }) } } });
  let made = 0;
  w.URL.createObjectURL = () => { made++; return 'blob:x'; };
  type('#ledgerFilter', 'quote');
  $('#zohoBtn').click();
  assert.strictEqual(made, 0);
  assert.strictEqual(w.alerts.length, 1);
  assert.ok($('#zohoHelp').hidden);
});

// Credit note, Duplicate and Create replace the sheet: ask only when unsaved changes would be lost; Cancel changes nothing.
function openSavedClean(extra = {}) {
  const ago = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
  const t = boot({ seed: { 'invoice-list': { 'INV-0001': inv('INV-0001', { invDate: ago(40), ...extra }) } } });
  t.d.querySelector('.ledger-row').click();
  t.$('#saveInvoiceBtn').click(); // saved copy now matches the sheet exactly
  t.asked = [];
  t.w.confirm = msg => { t.asked.push(msg); return t.answer; };
  return t;
}

test('Duplicate of an unchanged saved invoice does not ask', () => {
  const t = openSavedClean();
  t.$('#duplicateBtn').click();
  assert.strictEqual(t.asked.length, 0);
  assert.strictEqual(t.$('#invNumber').value, 'INV-0002');
});

test('Duplicate with unsaved edits asks; Cancel keeps the sheet', () => {
  const t = openSavedClean();
  t.type('#toName', 'Edited client');
  t.answer = false;
  t.$('#duplicateBtn').click();
  assert.strictEqual(t.asked.length, 1);
  assert.strictEqual(t.$('#invNumber').value, 'INV-0001');
  assert.strictEqual(t.$('#toName').value, 'Edited client');
});

test('Credit note with unsaved edits: Cancel keeps the invoice and the Type select', () => {
  const t = openSavedClean();
  t.type('#notes', 'unsaved note');
  t.answer = false;
  t.$('#creditNoteBtn').click();
  assert.strictEqual(t.asked.length, 1);
  assert.strictEqual(t.$('#docType').value, 'invoice');
  t.type('#docType', 'credit'); // same path via the Type select
  assert.strictEqual(t.$('#docType').value, 'invoice');
  assert.strictEqual(t.$('#notes').value, 'unsaved note');
});

test('Create repeat with unsaved edits: Cancel does not mark the period done', () => {
  const t = openSavedClean({ repeat: 'monthly' });
  t.type('#notes', 'unsaved note');
  t.answer = false;
  const create = [...t.d.querySelectorAll('button')].find(b => b.textContent === 'Create');
  assert.ok(create, 'repeat notice shown');
  create.click();
  assert.strictEqual(t.asked.length, 1);
  assert.ok(!t.saved()['INV-0001'].lastRepeated);
  assert.strictEqual(t.$('#invNumber').value, 'INV-0001');
});

// --- Payment details (EFT) and online payment link ---
const EFT = { bankName: 'FNB', bankHolder: 'Jo Soap', bankAccount: '62123456789', bankBranch: '250655', bankType: 'cheque' };
const eftText = $ => [...$('#eftRows').children].map(e => e.textContent);

test('EFT block prints only filled fields and the current number as reference', () => {
  const { $, type } = boot();
  assert.ok($('#eftPrint').hidden);
  type('#bankName', 'FNB');
  type('#bankAccount', '123');
  type('#invNumber', 'INV-0042');
  assert.ok(!$('#eftPrint').hidden);
  assert.deepStrictEqual(eftText($), ['Bank', 'FNB', 'Account number', '123', 'Reference', 'INV-0042']);
  type('#invNumber', 'INV-0043');
  assert.strictEqual(eftText($).pop(), 'INV-0043');
  type('#bankType', 'savings');
  assert.ok(eftText($).includes('Savings'));
  assert.match($('#notes').placeholder, /^(?!.*bank)/i);
});

test('EFT block is hidden for quotes and credit notes and when no bank field is filled', () => {
  const { $, type } = boot();
  Object.entries(EFT).forEach(([k, v]) => type('#' + k, v));
  assert.ok(!$('#eftPrint').hidden);
  type('#docType', 'quote');
  assert.ok($('#eftPrint').hidden);
  type('#docType', 'credit');
  assert.ok($('#eftPrint').hidden);
  type('#docType', 'invoice');
  assert.ok(!$('#eftPrint').hidden);
  Object.keys(EFT).forEach(k => type('#' + k, ''));
  assert.ok($('#eftPrint').hidden);
});

test('EFT settings survive New invoice, are saved with the document and old saves keep the current ones', () => {
  const { $, d, type, saved } = boot({ seed: { 'invoice-list': { 'INV-0001': inv('INV-0001') } } });
  Object.entries(EFT).forEach(([k, v]) => type('#' + k, v));
  type('#invNumber', 'INV-0002');
  $('#saveInvoiceBtn').click();
  Object.entries(EFT).forEach(([k, v]) => assert.strictEqual(saved()['INV-0002'][k], v));
  $('#newInvoiceBtn').click();
  Object.entries(EFT).forEach(([k, v]) => assert.strictEqual($('#' + k).value, v));
  // an old save without the fields keeps the settings on screen (like fromName), so they aren't wiped
  [...d.querySelectorAll('.ledger-row')].find(r => r.textContent.includes('INV-0001')).click();
  assert.strictEqual($('#bankName').value, 'FNB');
  assert.ok(!$('#eftPrint').hidden);
  // a saved invoice keeps what it was sent with even if the settings change afterwards
  [...d.querySelectorAll('.ledger-row')].find(r => r.textContent.includes('INV-0002')).click();
  assert.strictEqual($('#bankName').value, 'FNB');
  type('#bankName', 'Nedbank');
  assert.strictEqual(saved()['INV-0002'].bankName, 'FNB');
});

test('Duplicate and Credit note keep the saved settings; older saves get the screen settings', () => {
  const { $, d, type } = boot({ seed: { 'invoice-list': {
    'INV-0001': inv('INV-0001', { bankName: 'ABSA', payLink: 'https://x.co/{number}' }), 'INV-0002': inv('INV-0002') } } });
  type('#bankName', 'Screen Bank');
  const open = n => [...d.querySelectorAll('.ledger-row')].find(r => r.textContent.includes(n)).click();
  open('INV-0001');
  $('#duplicateBtn').click();
  assert.strictEqual($('#bankName').value, 'ABSA');
  assert.strictEqual($('#payLink').value, 'https://x.co/{number}');
  open('INV-0002');
  type('#bankName', 'Screen Bank');
  $('#duplicateBtn').click();
  assert.strictEqual($('#bankName').value, 'Screen Bank');
});

const PAY_FIXTURE = { payLink: 'https://pay.example.com/p?amt={amount}&ref={number}&cur={currency}' };
const payTotal = () => inv('INV-0001', { items: [{ desc: 'Work', qty: '1', price: '1000' }], ...PAY_FIXTURE });

test('payment link appears with the balance after a part payment and disappears when paid', () => {
  const { $, d, type } = boot({ seed: { 'invoice-list': { 'INV-0001': payTotal() } } });
  d.querySelector('.ledger-row').click();
  assert.ok(!$('#payOnline').hidden);
  assert.strictEqual($('#payOnlineLink').getAttribute('href'), 'https://pay.example.com/p?amt=1000.00&ref=INV-0001&cur=ZAR');
  assert.strictEqual($('#payOnlineLink').getAttribute('rel'), 'noopener');
  assert.strictEqual($('#payOnlineLink').getAttribute('target'), '_blank');
  type('#payAmount', '400');
  $('#addPaymentBtn').click();
  assert.match($('#payOnlineLink').getAttribute('href'), /amt=600\.00&/);
  type('#payAmount', '600');
  $('#addPaymentBtn').click();
  assert.ok($('#payOnline').hidden);
  assert.strictEqual($('#payOnlineLink').getAttribute('href'), null);
});

test('payment link is hidden once ticked paid, and for quotes and credit notes', () => {
  const { $, d, type } = boot({ seed: { 'invoice-list': { 'INV-0001': payTotal() } } });
  d.querySelector('.ledger-row').click();
  type('#paid', true);
  assert.ok($('#payOnline').hidden);
  type('#paid', false);
  assert.ok(!$('#payOnline').hidden);
  type('#docType', 'quote');
  assert.ok($('#payOnline').hidden);
  type('#docType', 'credit');
  assert.ok($('#payOnline').hidden);
});

test('a javascript: / http: template (e.g. from an imported record) produces no link', () => {
  ['javascript:alert(1)', 'http://pay.example.com/{number}', 'data:text/html,hi', 'https://paypal.me/<name>/{amount}'].forEach(payLink => {
    const { $, d } = boot({ seed: { 'invoice-list': { 'INV-0001': inv('INV-0001', { payLink }) } } });
    d.querySelector('.ledger-row').click();
    assert.ok($('#payOnline').hidden, payLink);
    assert.strictEqual($('#payOnlineLink').getAttribute('href'), null);
    assert.strictEqual($('#payQr').children.length, 0);
    assert.match($('#payLinkMsg').textContent, /isn’t a usable link/);
  });
});

test('QR code is rendered inline when a link exists, and removed with it', () => {
  const { $, d, type } = boot({ seed: { 'invoice-list': { 'INV-0001': payTotal() } } });
  assert.strictEqual($('#payQr').children.length, 0);
  d.querySelector('.ledger-row').click();
  const svg = $('#payQr svg');
  assert.ok(svg);
  assert.ok(svg.querySelector('path').getAttribute('d').length > 100);
  assert.ok(!$('#payQr').hidden);
  type('#paid', true);
  assert.strictEqual($('#payQr').children.length, 0);
});

test('link text still shows when the QR library is missing', () => {
  const { $, d, w } = boot({ seed: { 'invoice-list': { 'INV-0001': payTotal() } } });
  w.qrcode = undefined;
  w.document.getElementById('payLink').value = 'https://other.example.com/{number}';
  d.querySelector('.ledger-row').click(); // reloads the saved template; force a fresh render below
  w.document.getElementById('payLink').value = 'https://other.example.com/{number}';
  w.document.getElementById('payLink').dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.ok(!$('#payOnline').hidden);
  assert.match($('#payOnlineLink').textContent, /other\.example\.com\/INV-0001/);
  assert.strictEqual($('#payQr').children.length, 0);
});

test('PayPal preset fills the template; editing it resets the select', () => {
  const { $, type } = boot();
  type('#payPreset', 'paypal');
  assert.strictEqual($('#payLink').value, 'https://paypal.me/<name>/{amount}{currency}');
  assert.match($('#payLinkMsg').textContent, /isn’t a usable link/);
  type('#payLink', 'https://paypal.me/jo/{amount}{currency}');
  assert.strictEqual($('#payPreset').value, '');
  assert.deepStrictEqual([...$('#payPreset').options].map(o => o.value), ['', 'paypal']);
});

test('Email body includes the payment link only when there is one', () => {
  const { $, w, type } = boot();
  let url = '';
  w.openMail = u => { url = decodeURIComponent(u); };
  type('#payLink', 'https://pay.example.com/{number}?a={amount}');
  type('#invNumber', 'INV-0007');
  type('#itemsBody .item-price', '250');
  $('#emailBtn').click();
  assert.match(url, /\nPay online: https:\/\/pay\.example\.com\/INV-0007\?a=250\.00\n/);
  type('#payLink', '');
  $('#emailBtn').click();
  assert.doesNotMatch(url, /Pay online/);
  type('#payLink', 'javascript:alert(1)');
  $('#emailBtn').click();
  assert.doesNotMatch(url, /Pay online|javascript/);
});

test('opening an old save without payment details keeps the current bank details for the next invoice', () => {
  const { $, d, type } = boot({ seed: { 'invoice-list': { 'INV-0001': inv('INV-0001') } } });
  type('#bankName', 'FNB');
  type('#bankAccount', '62123456789');
  d.querySelector('.ledger-row').click();
  $('#newInvoiceBtn').click();
  assert.strictEqual($('#bankName').value, 'FNB');
  assert.strictEqual($('#bankAccount').value, '62123456789');
});

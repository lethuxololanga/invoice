const test = require('node:test');
const assert = require('node:assert');
const { localISODate, addDays, safeParse, round2, invoiceTotals, nextInvoiceNumber, nextNumberAfter, invoiceStatus } = require('./lib.js');

test('invoiceStatus: paid wins, overdue only after the due date', () => {
  assert.strictEqual(invoiceStatus({ paid: true, dueDate: '2026-01-01' }, '2026-10-21'), 'Paid');
  assert.strictEqual(invoiceStatus({ paid: false, dueDate: '2026-10-20' }, '2026-10-21'), 'Overdue');
  assert.strictEqual(invoiceStatus({ paid: false, dueDate: '2026-10-21' }, '2026-10-21'), '');
  assert.strictEqual(invoiceStatus({ dueDate: '' }, '2026-10-21'), '');
});

test('invoiceStatus: quotes expire instead of going overdue, and are never paid', () => {
  assert.strictEqual(invoiceStatus({ docType: 'quote', dueDate: '2026-10-20' }, '2026-10-21'), 'Expired');
  assert.strictEqual(invoiceStatus({ docType: 'quote', dueDate: '2026-10-21', paid: true }, '2026-10-21'), '');
});

test('nextNumberAfter continues from the highest number', () => {
  assert.strictEqual(nextNumberAfter(['INV-0002', 'INV-0010', 'INV-0009'], 'INV-0001'), 'INV-0011');
  assert.strictEqual(nextNumberAfter([], 'QUO-0001'), 'QUO-0001');
});

test('round2 rounds half away from zero despite float error', () => {
  assert.strictEqual(round2(1.005), 1.01);
  assert.strictEqual(round2(-1.005), -1.01);
  assert.strictEqual(round2(0.1 * 3), 0.3);
  assert.strictEqual(round2(1234567.125), 1234567.13);
});

test('invoiceTotals sums rounded lines and rounds VAT', () => {
  const items = [{ qty: '1', price: '0.333' }, { qty: '1', price: '0.333' }, { qty: '1', price: '0.333' }];
  // lines show 0.33 each, so subtotal must be 0.99 (not 1.00 from summing raw floats)
  assert.deepStrictEqual(invoiceTotals(items, 15), { lineTotals: [0.33, 0.33, 0.33], subtotal: 0.99, vat: 0.15, total: 1.14 });
  assert.deepStrictEqual(invoiceTotals([{ qty: '', price: 'x' }], 0), { lineTotals: [0], subtotal: 0, vat: 0, total: 0 });
  assert.strictEqual(invoiceTotals([{ qty: 2, price: 100 }, { qty: 1, price: -50 }], 15).total, 172.5);
});

test('nextInvoiceNumber bumps the last number and keeps padding', () => {
  assert.strictEqual(nextInvoiceNumber('INV-0001'), 'INV-0002');
  assert.strictEqual(nextInvoiceNumber('INV-0099'), 'INV-0100');
  assert.strictEqual(nextInvoiceNumber('2026-INV-9'), '2026-INV-10');
  assert.strictEqual(nextInvoiceNumber('ABC'), 'ABC-2');
  assert.strictEqual(nextInvoiceNumber(''), 'INV-0001');
});

test('localISODate uses local calendar day, not UTC', () => {
  // 00:30 local time: toISOString() would roll back a day east of UTC
  assert.strictEqual(localISODate(new Date(2026, 9, 21, 0, 30)), '2026-10-21');
  assert.strictEqual(localISODate(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});

test('addDays adds to an ISO date and crosses month/year', () => {
  assert.strictEqual(addDays('2026-10-21', 7), '2026-10-28');
  assert.strictEqual(addDays('2026-12-28', 7), '2027-01-04');
  assert.strictEqual(addDays('2026-10-21', 0), '2026-10-21');
});

test('safeParse returns fallback on bad JSON or null', () => {
  assert.deepStrictEqual(safeParse('{"a":1}', {}), { a: 1 });
  assert.deepStrictEqual(safeParse('{oops', {}), {});
  assert.strictEqual(safeParse(null, null), null);
  assert.deepStrictEqual(safeParse('null', {}), {});
});

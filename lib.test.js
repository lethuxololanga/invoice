const test = require('node:test');
const assert = require('node:assert');
const { localISODate, addDays, safeParse, round2, vatCategory, invoiceTotals, nextInvoiceNumber, nextNumberAfter, nextFreeNumber, paymentsTotal, balanceDue, savedTotal, creditsTotal, creditRemaining, invoiceStatus, ledgerEntry, ledgerTotals, ledgerMatches, addMonths, nextRepeatDate, dueRepeats, csvEscape, toCSV, zohoItemText, zohoInvoiceRows, ZOHO_INVOICE_HEADERS, eftRows, paymentLink } = require('./lib.js');

// The fields invoiceTotals returned before VAT categories existed (it now also returns `categories`).
const legacy = ({ lineTotals, subtotal, discount, net, vat, total }) => ({ lineTotals, subtotal, discount, net, vat, total });

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

test('paymentsTotal sums valid positive amounts to the cent and ignores junk', () => {
  assert.strictEqual(paymentsTotal([{ amount: '0.1' }, { amount: 0.2 }, { amount: '' }, { amount: 'abc' }, { amount: '-5' }, null, {}]), 0.3);
  assert.strictEqual(paymentsTotal(undefined), 0);
  assert.strictEqual(paymentsTotal('nope'), 0);
});

test('balanceDue rounds to cents and never goes below zero', () => {
  assert.strictEqual(balanceDue(1000, [{ amount: '500' }]), 500);
  assert.strictEqual(balanceDue(100.1, [{ amount: '0.2' }]), 99.9);
  assert.strictEqual(balanceDue(1000, [{ amount: '1000' }]), 0);
  assert.strictEqual(balanceDue(1000, [{ amount: '1200' }]), 0); // overpayment
  assert.strictEqual(balanceDue(1000), 1000);
});

test('invoiceStatus with payments: paid in full, part paid, overdue wins over part paid', () => {
  const due = '2026-10-21', today = '2026-10-21', late = '2026-10-20';
  const pay = (...amounts) => amounts.map(amount => ({ amount }));
  assert.strictEqual(invoiceStatus({ dueDate: due, payments: pay('500') }, today, 1000), 'Part paid');
  assert.strictEqual(invoiceStatus({ dueDate: due, payments: pay('400', '600') }, today, 1000), 'Paid'); // equal to total
  assert.strictEqual(invoiceStatus({ dueDate: due, payments: pay('1200') }, today, 1000), 'Paid'); // overpayment
  assert.strictEqual(invoiceStatus({ dueDate: late, payments: pay('500') }, today, 1000), 'Overdue');
  assert.strictEqual(invoiceStatus({ dueDate: late, payments: pay('1000') }, today, 1000), 'Paid');
  assert.strictEqual(invoiceStatus({ dueDate: late, paid: true, payments: pay('1') }, today, 1000), 'Paid'); // tick wins
  assert.strictEqual(invoiceStatus({ dueDate: due, paid: true, payments: [] }, today, 1000), 'Paid');
  assert.strictEqual(invoiceStatus({ dueDate: due, payments: pay('', 'x') }, today, 1000), ''); // junk payments
  assert.strictEqual(invoiceStatus({ dueDate: due, payments: pay('99.999') }, today, 100), 'Paid'); // to the cent
  assert.strictEqual(invoiceStatus({ dueDate: due, payments: pay('99.99') }, today, 100), 'Part paid');
  assert.strictEqual(invoiceStatus({ dueDate: due, payments: pay('50') }, today), 'Part paid'); // no total given
  assert.strictEqual(invoiceStatus({ dueDate: due, payments: [] }, today, 0), ''); // nothing received on a zero total
});

test('invoiceStatus for quotes: accepted / declined beat expired; payments are ignored', () => {
  const quote = extra => ({ docType: 'quote', dueDate: '2026-10-20', ...extra });
  assert.strictEqual(invoiceStatus(quote({ quoteStatus: 'accepted' }), '2026-10-21'), 'Accepted');
  assert.strictEqual(invoiceStatus(quote({ quoteStatus: 'declined' }), '2026-10-21'), 'Declined');
  assert.strictEqual(invoiceStatus(quote({ quoteStatus: '' }), '2026-10-21'), 'Expired');
  assert.strictEqual(invoiceStatus(quote({ quoteStatus: 'accepted', dueDate: '2026-12-01' }), '2026-10-21'), 'Accepted');
  assert.strictEqual(invoiceStatus(quote({ dueDate: '2026-12-01', payments: [{ amount: '5' }] }), '2026-10-21', 1), '');
});

test('invoiceStatus: records saved before payments / quoteStatus existed behave as before', () => {
  assert.strictEqual(invoiceStatus({ paid: false, dueDate: '2026-10-20' }, '2026-10-21', 100), 'Overdue');
  assert.strictEqual(invoiceStatus({ paid: false, dueDate: '2026-12-01' }, '2026-10-21', 100), '');
  assert.strictEqual(invoiceStatus({ docType: 'quote', dueDate: '2026-12-01' }, '2026-10-21', 100), '');
  assert.strictEqual(invoiceStatus({ paid: true }, '2026-10-21', 100), 'Paid');
});

test('nextNumberAfter continues from the highest number', () => {
  assert.strictEqual(nextNumberAfter(['INV-0002', 'INV-0010', 'INV-0009'], 'INV-0001'), 'INV-0011');
  assert.strictEqual(nextNumberAfter([], 'QUO-0001'), 'QUO-0001');
});

test('nextFreeNumber never reuses a saved number', () => {
  const list = {
    'INV-0003': {}, 'INV-0004': { docType: 'invoice' }, 'QUO-0001': { docType: 'quote' },
  };
  // New from old INV-0003: skips past the saved INV-0004
  assert.strictEqual(nextFreeNumber(list, 'invoice', 'INV-0003'), 'INV-0005');
  // Unsaved draft ahead of the saved ones keeps its own sequence
  assert.strictEqual(nextFreeNumber(list, 'invoice', 'INV-0010'), 'INV-0011');
  // Quotes count only quotes
  assert.strictEqual(nextFreeNumber(list, 'quote'), 'QUO-0002');
  assert.strictEqual(nextFreeNumber({}, 'quote'), 'QUO-0001');
  // Fallback number already taken by a document of the other type
  assert.strictEqual(nextFreeNumber({ 'INV-0001': { docType: 'quote' } }, 'invoice'), 'INV-0002');
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
  assert.deepStrictEqual(legacy(invoiceTotals(items, 15)), { lineTotals: [0.33, 0.33, 0.33], subtotal: 0.99, discount: 0, net: 0.99, vat: 0.15, total: 1.14 });
  assert.deepStrictEqual(legacy(invoiceTotals([{ qty: '', price: 'x' }], 0)), { lineTotals: [0], subtotal: 0, discount: 0, net: 0, vat: 0, total: 0 });
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

const lines = [{ qty: '2', price: '100' }, { qty: '1', price: '50' }]; // subtotal 250

test('invoiceTotals without a discount keeps the old results and adds zero discount', () => {
  assert.deepStrictEqual(legacy(invoiceTotals(lines, 15)),
    { lineTotals: [200, 50], subtotal: 250, discount: 0, net: 250, vat: 37.5, total: 287.5 });
});

test('invoiceTotals: percent discount', () => {
  const t = invoiceTotals(lines, 0, { type: 'percent', value: '10' });
  assert.strictEqual(t.discount, 25);
  assert.strictEqual(t.net, 225);
  assert.strictEqual(t.total, 225);
});

test('invoiceTotals: fixed amount discount, rounded to cents', () => {
  assert.strictEqual(invoiceTotals(lines, 0, { type: 'amount', value: 40 }).discount, 40);
  assert.strictEqual(invoiceTotals(lines, 0, { type: 'amount', value: '12.345' }).discount, 12.35);
});

test('invoiceTotals: discount is clamped to the subtotal and never negative', () => {
  const over = invoiceTotals(lines, 15, { type: 'amount', value: 999 });
  assert.deepStrictEqual([over.discount, over.net, over.vat, over.total], [250, 0, 0, 0]);
  assert.strictEqual(invoiceTotals(lines, 0, { type: 'percent', value: 150 }).discount, 250);
  assert.strictEqual(invoiceTotals(lines, 0, { type: 'amount', value: -20 }).discount, 0);
});

test('invoiceTotals: zero, blank or junk discount does nothing', () => {
  for (const value of [0, '', undefined, 'abc']) {
    const t = invoiceTotals(lines, 0, { type: 'percent', value });
    assert.strictEqual(t.discount, 0);
    assert.strictEqual(t.total, 250);
  }
  assert.strictEqual(invoiceTotals(lines, 0, { type: undefined, value: '' }).total, 250);
});

test('invoiceTotals: VAT is charged on the discounted amount', () => {
  const t = invoiceTotals(lines, 15, { type: 'percent', value: 20 }); // net 200, vat 30
  assert.deepStrictEqual([t.net, t.vat, t.total], [200, 30, 230]);
});

test('invoiceTotals: no discount on a negative subtotal', () => {
  const t = invoiceTotals([{ qty: '1', price: '-50' }], 0, { type: 'percent', value: 10 });
  assert.deepStrictEqual([t.subtotal, t.discount, t.total], [-50, 0, -50]);
});

// --- VAT-inclusive pricing, VAT categories, discount apportioning ---
const pick = (t, cat) => [t.categories[cat].net, t.categories[cat].vat, t.categories[cat].total];

test('inclusive: VAT is extracted, not added', () => {
  const t = invoiceTotals([{ qty: '1', price: '115' }], 15, undefined, { inclusive: true });
  assert.deepStrictEqual([t.subtotal, t.net, t.vat, t.total], [115, 100, 15, 115]);
  // R100 incl. at 15%: VAT 13.04 (100 × 15/115 = 13.043…), excl. 86.96
  const u = invoiceTotals([{ qty: '2', price: '50' }], 15, null, { inclusive: true });
  assert.deepStrictEqual([u.net, u.vat, u.total], [86.96, 13.04, 100]);
});

test('inclusive with a discount: total is the discounted lines, VAT extracted from it', () => {
  const t = invoiceTotals(lines, 15, { type: 'percent', value: 10 }, { inclusive: true }); // 250 − 25 = 225 incl.
  assert.deepStrictEqual([t.subtotal, t.discount, t.total, t.vat, t.net], [250, 25, 225, 29.35, 195.65]);
  const a = invoiceTotals([{ qty: 1, price: 115 }], 15, { type: 'amount', value: 23 }, { inclusive: true });
  assert.deepStrictEqual([a.total, a.vat, a.net], [92, 12, 80]);
});

test('inclusive is ignored at a 0% rate and when nothing is standard-rated', () => {
  const t = invoiceTotals(lines, 0, null, { inclusive: true });
  assert.deepStrictEqual(legacy(t), legacy(invoiceTotals(lines, 0)));
  const z = invoiceTotals([{ qty: 1, price: 100, vatCat: 'zero' }], 15, null, { inclusive: true });
  assert.deepStrictEqual([z.net, z.vat, z.total], [100, 0, 100]);
});

test('mixed categories: only standard-rated lines pay VAT', () => {
  const items = [
    { qty: '1', price: '1000' },
    { qty: '2', price: '150', vatCat: 'zero' },
    { qty: '1', price: '200', vatCat: 'exempt' },
  ];
  const t = invoiceTotals(items, 15);
  assert.deepStrictEqual([t.subtotal, t.net, t.vat, t.total], [1500, 1500, 150, 1650]);
  assert.deepStrictEqual(pick(t, 'standard'), [1000, 150, 1150]);
  assert.deepStrictEqual(pick(t, 'zero'), [300, 0, 300]);
  assert.deepStrictEqual(pick(t, 'exempt'), [200, 0, 200]);
  const inc = invoiceTotals(items, 15, null, { inclusive: true });
  assert.deepStrictEqual([inc.total, inc.vat, inc.net], [1500, 130.43, 1369.57]);
  assert.deepStrictEqual(pick(inc, 'standard'), [869.57, 130.43, 1000]);
});

test('mixed categories with a discount: apportioned pro rata, VAT on the discounted standard part', () => {
  const items = [{ qty: 1, price: 600 }, { qty: 1, price: 300, vatCat: 'zero' }, { qty: 1, price: 100, vatCat: 'exempt' }];
  const t = invoiceTotals(items, 15, { type: 'percent', value: 10 }); // 100 off: 60 / 30 / 10
  assert.deepStrictEqual(['standard', 'zero', 'exempt'].map(c => t.categories[c].discount), [60, 30, 10]);
  assert.deepStrictEqual(pick(t, 'standard'), [540, 81, 621]);
  assert.deepStrictEqual([t.net, t.vat, t.total], [900, 81, 981]);
  const inc = invoiceTotals(items, 15, { type: 'percent', value: 10 }, { inclusive: true });
  assert.deepStrictEqual(pick(inc, 'standard'), [469.57, 70.43, 540]);
  assert.deepStrictEqual([inc.net, inc.vat, inc.total], [829.57, 70.43, 900]);
});

test('discount apportioning puts the rounding remainder on the largest category', () => {
  // R1 off three equal R10 parts: 0.33 each leaves 0.01 over, which goes to the largest (first on a tie)
  const eq = [{ qty: 1, price: 10 }, { qty: 1, price: 10, vatCat: 'zero' }, { qty: 1, price: 10, vatCat: 'exempt' }];
  const t = invoiceTotals(eq, 15, { type: 'amount', value: 1 });
  assert.deepStrictEqual(['standard', 'zero', 'exempt'].map(c => t.categories[c].discount), [0.34, 0.33, 0.33]);
  // 10c off R1 / R1 / R2: 2.5c rounds up to 3c twice, 5c — 11c in all, so the largest (exempt) gives 1c back
  const un = [{ qty: 1, price: 1 }, { qty: 1, price: 1, vatCat: 'zero' }, { qty: 1, price: 2, vatCat: 'exempt' }];
  const u = invoiceTotals(un, 15, { type: 'amount', value: 0.1 });
  assert.deepStrictEqual(['standard', 'zero', 'exempt'].map(c => u.categories[c].discount), [0.03, 0.03, 0.04]);
  assert.deepStrictEqual(pick(u, 'standard'), [0.97, 0.15, 1.12]);
  assert.strictEqual(u.total, 4.05);
});

test('exempt-only and zero-rated-only invoices have no VAT', () => {
  for (const vatCat of ['exempt', 'zero']) {
    for (const inclusive of [false, true]) {
      const t = invoiceTotals([{ qty: 3, price: 99.99, vatCat }], 15, { type: 'percent', value: 5 }, { inclusive });
      assert.deepStrictEqual([t.vat, t.net, t.total], [0, 284.97, 284.97]);
    }
  }
});

test('vatCategory defaults missing or unknown values to standard', () => {
  assert.strictEqual(vatCategory({}), 'standard');
  assert.strictEqual(vatCategory({ vatCat: 'bogus' }), 'standard');
  assert.strictEqual(vatCategory({ vatCat: 'zero' }), 'zero');
  assert.strictEqual(vatCategory({ vatCat: 'exempt' }), 'exempt');
});

test('backward compatible: old signatures give the same numbers as before', () => {
  // The pre-category formula, inlined
  const before = (items, rate, discount) => {
    const lt = items.map(it => round2((parseFloat(it.qty) || 0) * (parseFloat(it.price) || 0)));
    const sub = round2(lt.reduce((a, b) => a + b, 0));
    const value = Math.max(0, parseFloat(discount && discount.value) || 0);
    const raw = discount && discount.type === 'amount' ? value : sub * value / 100;
    const off = Math.max(0, Math.min(round2(raw), sub));
    const net = round2(sub - off);
    const vat = round2(net * (rate || 0) / 100);
    return { lineTotals: lt, subtotal: sub, discount: off, net, vat, total: round2(net + vat) };
  };
  const sets = [lines, [{ qty: '1.5', price: '33.33' }, { qty: 1, price: -5 }], [{ qty: '', price: 'x' }], [{ qty: 7, price: 0.07 }]];
  for (const items of sets) {
    for (const rate of [0, 15, undefined]) {
      assert.deepStrictEqual(legacy(invoiceTotals(items, rate)), before(items, rate));
      for (const d of [{ type: 'percent', value: 12.5 }, { type: 'amount', value: '3.33' }, undefined]) {
        assert.deepStrictEqual(legacy(invoiceTotals(items, rate, d)), before(items, rate, d));
        assert.deepStrictEqual(legacy(invoiceTotals(items, rate, d, {})), before(items, rate, d));
      }
    }
  }
});

test('every breakdown reconciles to the cent across awkward amounts', () => {
  const prices = [0.01, 0.07, 1.99, 33.33, 99.99];
  const cats = ['standard', 'zero', 'exempt'];
  const discounts = [undefined, { type: 'percent', value: 7 }, { type: 'percent', value: 33.3 }, { type: 'amount', value: 0.05 }];
  const cents = n => Math.round(n * 100);
  let checked = 0;
  for (const p of prices) {
    for (let qty = 1; qty <= 3; qty++) {
      const items = [
        { qty, price: p },
        { qty, price: round2(p * 3), vatCat: 'zero' },
        { qty: 1, price: p, vatCat: 'exempt' },
        { qty: qty + 1, price: p },
      ];
      for (const rate of [15, 14, 0]) {
        for (const inclusive of [false, true]) {
          for (const d of discounts) {
            const t = invoiceTotals(items, rate, d, { inclusive });
            const msg = JSON.stringify({ p, qty, rate, inclusive, d });
            assert.strictEqual(cents(t.net) + cents(t.vat), cents(t.total), msg);
            assert.strictEqual(cents(t.subtotal) - cents(t.discount), cents(inclusive ? t.total : t.net), msg);
            assert.strictEqual(cats.reduce((s, c) => s + cents(t.categories[c].discount), 0), cents(t.discount), msg);
            assert.strictEqual(cats.reduce((s, c) => s + cents(t.categories[c].net), 0), cents(t.net), msg);
            assert.strictEqual(cats.reduce((s, c) => s + cents(t.categories[c].vat), 0), cents(t.vat), msg);
            assert.strictEqual(cats.reduce((s, c) => s + cents(t.categories[c].total), 0), cents(t.total), msg);
            for (const c of cats) {
              const k = t.categories[c];
              assert.strictEqual(cents(k.net) + cents(k.vat), cents(k.total), msg);
              assert.strictEqual(cents(k.amount) / 100, k.amount, msg); // whole cents
              if (c !== 'standard') assert.strictEqual(k.vat, 0, msg);
            }
            // every value is whole cents
            for (const v of [t.subtotal, t.discount, t.net, t.vat, t.total]) assert.strictEqual(cents(v) / 100, v, msg);
            checked++;
          }
        }
      }
    }
  }
  assert.strictEqual(checked, 5 * 3 * 3 * 2 * 4);
});

// --- Credit notes ---
const doc = (extra = {}) => ({ docType: 'invoice', vatToggle: true, vatRate: '15', items: [{ qty: '1', price: '100' }], ...extra }); // R115 incl. VAT
const cn = (creditFor, price, extra = {}) => doc({ docType: 'credit', creditFor, items: [{ qty: '1', price }], ...extra });

test('nextFreeNumber: credit notes have their own CN sequence', () => {
  assert.strictEqual(nextFreeNumber({}, 'credit'), 'CN-0001');
  const list = { 'INV-0005': doc(), 'QUO-0002': doc({ docType: 'quote' }), 'CN-0003': cn('INV-0005', '10') };
  assert.strictEqual(nextFreeNumber(list, 'credit'), 'CN-0004');
  assert.strictEqual(nextFreeNumber(list, 'invoice'), 'INV-0006');
  assert.strictEqual(nextFreeNumber(list, 'quote'), 'QUO-0003');
  assert.strictEqual(nextFreeNumber(list, 'credit', 'CN-0009'), 'CN-0010');
});

test('savedTotal matches the sheet maths (VAT, inclusive, discount)', () => {
  assert.strictEqual(savedTotal(doc()), 115);
  assert.strictEqual(savedTotal(doc({ vatToggle: false })), 100);
  assert.strictEqual(savedTotal(doc({ vatInclusive: true })), 100);
  assert.strictEqual(savedTotal(doc({ discountType: 'percent', discountValue: '10' })), 103.5);
  assert.strictEqual(savedTotal({}), 0);
});

test('creditsTotal sums only saved credit notes for that invoice', () => {
  const list = {
    'INV-0001': doc(), 'INV-0002': doc(),
    'CN-0001': cn('INV-0001', '20'), // 23 incl. VAT
    'CN-0002': cn('INV-0001', '10'), // 11.50
    'CN-0003': cn('INV-0002', '50'), // other invoice
    'INV-0003': doc({ creditFor: 'INV-0001' }), // not a credit note
    'QUO-0001': doc({ docType: 'quote', creditFor: 'INV-0001' }),
  };
  assert.strictEqual(creditsTotal(list, 'INV-0001'), 34.5);
  assert.strictEqual(creditsTotal(list, 'INV-0002'), 57.5);
  assert.strictEqual(creditsTotal(list, 'INV-0003'), 0);
  assert.strictEqual(creditsTotal(list, 'INV-0001', 'CN-0002'), 23); // the one being re-saved is left out
  assert.strictEqual(creditsTotal(list, ''), 0);
  assert.strictEqual(creditsTotal(undefined, 'INV-0001'), 0);
});

test('creditRemaining: original total less credits already issued; over-credit check', () => {
  const list = { 'INV-0001': doc(), 'CN-0001': cn('INV-0001', '60') }; // 115 − 69
  assert.strictEqual(creditRemaining(list, 'INV-0001'), 46);
  const overCredit = (note, num) => savedTotal(note) > creditRemaining(list, note.creditFor, num);
  assert.strictEqual(overCredit(cn('INV-0001', '40'), 'CN-0002'), false); // 46 exactly
  assert.strictEqual(overCredit(cn('INV-0001', '40.01'), 'CN-0002'), true);
  assert.strictEqual(overCredit(cn('INV-0001', '100'), 'CN-0001'), false); // re-saving CN-0001 replaces it
  assert.strictEqual(overCredit(cn('INV-0001', '100.01'), 'CN-0001'), true);
  assert.strictEqual(creditRemaining({ ...list, 'CN-0002': cn('INV-0001', '50') }, 'INV-0001'), 0); // never negative
  assert.strictEqual(creditRemaining(list, 'INV-0404'), 0);
});

test('balanceDue takes credits off as well as payments', () => {
  assert.strictEqual(balanceDue(115, [], 23), 92);
  assert.strictEqual(balanceDue(115, [{ amount: '50' }], 23), 42);
  assert.strictEqual(balanceDue(115, [{ amount: '100' }], 23), 0);
  assert.strictEqual(balanceDue(115, [{ amount: '50' }]), 65); // old two-argument call
});

test('invoiceStatus with credits: partial, full, credit + payment, overdue', () => {
  const today = '2026-11-15';
  const open = { dueDate: '2026-12-01', payments: [] };
  assert.strictEqual(invoiceStatus(open, today, 115, 23), ''); // part credit alone: no status, just a lower balance
  assert.strictEqual(invoiceStatus({ ...open, dueDate: '2026-11-01' }, today, 115, 23), 'Overdue');
  assert.strictEqual(invoiceStatus(open, today, 115, 115), 'Credited');
  assert.strictEqual(invoiceStatus(open, today, 115, 120), 'Credited');
  assert.strictEqual(invoiceStatus({ ...open, dueDate: '2026-11-01' }, today, 115, 115), 'Credited');
  assert.strictEqual(invoiceStatus({ ...open, payments: [{ amount: '92' }] }, today, 115, 23), 'Paid');
  assert.strictEqual(invoiceStatus({ ...open, payments: [{ amount: '50' }] }, today, 115, 23), 'Part paid');
  assert.strictEqual(invoiceStatus({ ...open, payments: [{ amount: '115' }] }, today, 115, 115), 'Credited'); // fully credited wins
  assert.strictEqual(invoiceStatus({ ...open, paid: true }, today, 115, 23), 'Paid');
  assert.strictEqual(invoiceStatus(open, today, undefined, 115), ''); // credits need the total
  assert.strictEqual(invoiceStatus(open, today, 115), ''); // no credits argument: as before
  // float: 0.1 + 0.2 of credit + payment covers 0.30
  assert.strictEqual(invoiceStatus({ ...open, payments: [{ amount: '0.1' }] }, today, 0.3, 0.2), 'Paid');
});

test('invoiceStatus: credit notes have no status of their own', () => {
  assert.strictEqual(invoiceStatus({ docType: 'credit', dueDate: '2020-01-01', paid: true }, '2026-11-15', 115), '');
});

// --- Ledger tools ---
const mk = (extra = {}) => ({ docType: 'invoice', currency: 'ZAR', dueDate: '2026-12-01', items: [{ desc: 'Work', qty: '1', price: '100' }], ...extra });

test('ledgerTotals: outstanding and overdue per currency, only currencies present', () => {
  const list = {
    'INV-1': mk(), // 100 not yet due
    'INV-2': mk({ dueDate: '2026-11-01', items: [{ qty: '1', price: '250' }] }), // overdue
    'INV-3': mk({ currency: 'USD', dueDate: '2026-11-01' }),
    'INV-4': mk({ paid: true }),
  };
  assert.deepStrictEqual(ledgerTotals(list, '2026-11-15'), {
    ZAR: { outstanding: 350, overdue: 250, count: 2, overdueCount: 1 },
    USD: { outstanding: 100, overdue: 100, count: 1, overdueCount: 1 },
  });
  assert.deepStrictEqual(ledgerTotals({ 'INV-4': mk({ paid: true }) }, '2026-11-15'), {});
  assert.deepStrictEqual(ledgerTotals({}, '2026-11-15'), {});
});

test('ledgerTotals: payments and credit notes reduce balances; credited invoices drop out', () => {
  const list = {
    'INV-1': mk({ dueDate: '2026-11-01', items: [{ qty: '1', price: '1000' }], payments: [{ amount: '300' }] }),
    'INV-2': mk({ items: [{ qty: '1', price: '500' }] }),
    'CN-1': mk({ docType: 'credit', creditFor: 'INV-1', items: [{ qty: '1', price: '200' }] }),
    'CN-2': mk({ docType: 'credit', creditFor: 'INV-2', items: [{ qty: '1', price: '500' }] }),
  };
  assert.deepStrictEqual(ledgerTotals(list, '2026-11-15'), { ZAR: { outstanding: 500, overdue: 500, count: 1, overdueCount: 1 } });
});

test('ledgerTotals: quotes and credit notes are never counted; old records default to ZAR', () => {
  const noCurrency = { items: [{ qty: '1', price: '40' }], dueDate: '2026-12-01' };
  const list = { 'QUO-1': mk({ docType: 'quote' }), 'CN-1': mk({ docType: 'credit' }), 'INV-1': noCurrency };
  assert.deepStrictEqual(ledgerTotals(list, '2026-11-15'), { ZAR: { outstanding: 40, overdue: 0, count: 1, overdueCount: 0 } });
});

test('ledgerMatches: search by number, client or line description, any case; status filters', () => {
  const list = {
    'INV-0001': mk({ toName: 'Acme Ltd', items: [{ desc: 'Logo design', qty: '1', price: '10' }] }),
    'INV-0002': mk({ dueDate: '2026-11-01' }),
    'INV-0003': mk({ payments: [{ amount: '10' }] }),
    'INV-0004': mk({ paid: true }),
    'QUO-0001': mk({ docType: 'quote' }),
    'CN-0001': mk({ docType: 'credit', creditFor: 'INV-9999' }),
  };
  const ids = (q, f) => Object.keys(list).filter(n => ledgerMatches(list, n, '2026-11-15', q, f));
  assert.deepStrictEqual(ids('acme', 'all'), ['INV-0001']);
  assert.deepStrictEqual(ids('LOGO', 'all'), ['INV-0001']);
  assert.deepStrictEqual(ids('quo-0001', 'all'), ['QUO-0001']);
  assert.deepStrictEqual(ids('nothing', 'all'), []);
  assert.deepStrictEqual(ids('', 'unpaid'), ['INV-0001', 'INV-0002', 'INV-0003']);
  assert.deepStrictEqual(ids('', 'overdue'), ['INV-0002']);
  assert.deepStrictEqual(ids('', 'part'), ['INV-0003']);
  assert.deepStrictEqual(ids('', 'paid'), ['INV-0004']);
  assert.deepStrictEqual(ids('', 'quote'), ['QUO-0001']);
  assert.deepStrictEqual(ids('', 'credit'), ['CN-0001']);
  assert.strictEqual(ledgerEntry(list, 'INV-0003', '2026-11-15').balance, 90);
});

test('addMonths: clamps each step from the original day', () => {
  assert.strictEqual(addMonths('2026-01-31', 1), '2026-02-28');
  assert.strictEqual(addMonths('2026-01-31', 2), '2026-03-31');
  assert.strictEqual(addMonths('2026-01-31', 3), '2026-04-30');
  assert.strictEqual(addMonths('2028-01-31', 1), '2028-02-29'); // leap year
  assert.strictEqual(addMonths('2028-02-29', 12), '2029-02-28');
  assert.strictEqual(addMonths('2026-12-15', 1), '2027-01-15'); // Dec to Jan
  assert.strictEqual(addMonths('2026-12-31', 14), '2028-02-29');
  assert.strictEqual(addMonths('2026-03-10', 0), '2026-03-10');
});

test('nextRepeatDate: first period, then after lastRepeated; blank when not repeating', () => {
  const base = { docType: 'invoice', repeat: 'monthly', invDate: '2026-01-31' };
  assert.strictEqual(nextRepeatDate(base), '2026-02-28');
  assert.strictEqual(nextRepeatDate({ ...base, lastRepeated: '2026-02-28' }), '2026-03-31');
  assert.strictEqual(nextRepeatDate({ ...base, lastRepeated: '2026-03-31' }), '2026-04-30');
  assert.strictEqual(nextRepeatDate({ ...base, repeat: '' }), '');
  assert.strictEqual(nextRepeatDate({ ...base, docType: 'quote' }), '');
  assert.strictEqual(nextRepeatDate({ ...base, invDate: '' }), '');
  assert.strictEqual(nextRepeatDate({ invDate: '2026-01-31' }), '');
});

test('dueRepeats: only repeats whose date has come, oldest first', () => {
  const list = {
    'INV-2': { docType: 'invoice', repeat: 'monthly', invDate: '2026-10-10' },
    'INV-1': { docType: 'invoice', repeat: 'monthly', invDate: '2026-09-20' },
    'INV-3': { docType: 'invoice', repeat: 'monthly', invDate: '2026-11-14' },
    'INV-4': { docType: 'invoice', invDate: '2026-01-01' },
    'INV-5': { docType: 'invoice', repeat: 'monthly', invDate: '2026-09-20', lastRepeated: '2026-10-20' },
  };
  assert.deepStrictEqual(dueRepeats(list, '2026-11-15'), [
    { num: 'INV-1', date: '2026-10-20' }, { num: 'INV-2', date: '2026-11-10' },
  ]);
  assert.deepStrictEqual(dueRepeats(list, '2026-11-20').map(r => r.num), ['INV-1', 'INV-2', 'INV-5']);
});

test('csvEscape: quotes fields with comma, quote, CR or LF and doubles inner quotes', () => {
  assert.strictEqual(csvEscape('plain'), 'plain');
  assert.strictEqual(csvEscape('a,b'), '"a,b"');
  assert.strictEqual(csvEscape('say "hi"'), '"say ""hi"""');
  assert.strictEqual(csvEscape('l1\nl2'), '"l1\nl2"');
  assert.strictEqual(csvEscape('l1\r\nl2'), '"l1\r\nl2"');
  assert.strictEqual(csvEscape(null), '');
  assert.strictEqual(csvEscape(undefined), '');
});

test('toCSV: BOM, CRLF line endings, trailing CRLF', () => {
  const out = toCSV([['a', 'b'], ['1,5', 2]]);
  assert.strictEqual(out, '﻿a,b\r\n"1,5",2\r\n');
});

test('csvEscape: formula-injection guard on text, not on numbers', () => {
  for (const s of ['=1+1', '+1', '-1', '@SUM(A1)', '\tx']) assert.strictEqual(csvEscape(s), "'" + s);
  assert.strictEqual(csvEscape('\rx'), '"\'\rx"');
  assert.strictEqual(csvEscape(-50), '-50');
  assert.strictEqual(csvEscape('2026-01-02'), '2026-01-02');
  assert.strictEqual(csvEscape('=a,b'), '"\'=a,b"');
});

test('zohoItemText: first line is the name, rest plus (qty unit) is the description', () => {
  assert.deepStrictEqual(zohoItemText({ desc: 'Homepage layout', qty: '1.5', unit: 'hrs' }), { name: 'Homepage layout', desc: '(1.5 hrs)' });
  assert.deepStrictEqual(zohoItemText({ desc: '  Logo \n Three concepts\nTwo rounds', qty: '1' }), { name: 'Logo', desc: 'Three concepts\nTwo rounds' });
  assert.deepStrictEqual(zohoItemText({ desc: 'Logo\nConcepts', qty: '2', unit: 'pcs' }), { name: 'Logo', desc: 'Concepts (2 pcs)' });
  assert.strictEqual(zohoItemText({ desc: '' }).name, 'Item');
});

test('zohoItemText: name capped at 100 chars, overflow moves to the description', () => {
  const long = 'x'.repeat(130);
  const t = zohoItemText({ desc: long + '\nmore', qty: '1' });
  assert.strictEqual(t.name, 'x'.repeat(100));
  assert.strictEqual(t.desc, 'x'.repeat(30) + '\nmore');
});

const zInv = (extra = {}) => ({ docType: 'invoice', invNumber: 'INV-1', invDate: '2026-11-01', dueDate: '2026-11-30', toName: 'Acme, Ltd', currency: 'ZAR',
  notes: 'Thanks', terms: '30 days', vatToggle: false, vatRate: '15', items: [{ desc: 'A', qty: '2', price: '50' }], ...extra });
const col = (rows, name) => rows.slice(1).map(r => r[ZOHO_INVOICE_HEADERS.indexOf(name)]);

test('zohoInvoiceRows: one row per line, invoice columns repeated, Draft and services', () => {
  const list = { 'INV-1': zInv({ items: [{ desc: 'Homepage layout', qty: '1.5', unit: 'hrs', price: '400' }, { desc: 'Hosting', qty: '1', price: '99.5' }] }) };
  const rows = zohoInvoiceRows(list, ['INV-1']);
  assert.deepStrictEqual(rows[0], ZOHO_INVOICE_HEADERS);
  assert.strictEqual(rows.length, 3);
  assert.deepStrictEqual(col(rows, 'Invoice Number'), ['INV-1', 'INV-1']);
  assert.deepStrictEqual(col(rows, 'Customer Name'), ['Acme, Ltd', 'Acme, Ltd']);
  assert.deepStrictEqual(col(rows, 'Invoice Status'), ['Draft', 'Draft']);
  assert.deepStrictEqual(col(rows, 'Product Type'), ['services', 'services']);
  assert.deepStrictEqual(col(rows, 'Invoice Date'), ['2026-11-01', '2026-11-01']);
  assert.deepStrictEqual(col(rows, 'Item Desc'), ['(1.5 hrs)', '']);
  assert.deepStrictEqual(col(rows, 'Quantity'), [1.5, 1]);
  assert.deepStrictEqual(col(rows, 'Item Price'), [400, 99.5]);
  assert.deepStrictEqual(col(rows, 'Notes'), ['Thanks', 'Thanks']);
});

test('zohoInvoiceRows: quotes and credit notes excluded; negative price stays a number', () => {
  const list = { 'INV-1': zInv({ items: [{ desc: 'Refund', qty: '1', price: '-50' }] }), 'QUO-1': zInv({ docType: 'quote' }), 'CN-1': zInv({ docType: 'credit' }) };
  const rows = zohoInvoiceRows(list, ['INV-1', 'QUO-1', 'CN-1']);
  assert.strictEqual(rows.length, 2);
  assert.ok(toCSV(rows).includes(',-50,'));
});

test('zohoInvoiceRows: percent vs amount discount, none empty', () => {
  const pct = zohoInvoiceRows({ a: zInv({ discountType: 'percent', discountValue: '10' }) }, ['a']);
  assert.deepStrictEqual([col(pct, 'Discount Type')[0], col(pct, 'Entity Discount Percent')[0], col(pct, 'Entity Discount Amount')[0], col(pct, 'Is Discount Before Tax')[0]], ['entity_level', 10, '', 'true']);
  const amt = zohoInvoiceRows({ a: zInv({ discountType: 'amount', discountValue: '30' }) }, ['a']);
  assert.deepStrictEqual([col(amt, 'Entity Discount Percent')[0], col(amt, 'Entity Discount Amount')[0]], ['', 30]);
  const capped = zohoInvoiceRows({ a: zInv({ discountType: 'amount', discountValue: '5000' }) }, ['a']);
  assert.strictEqual(col(capped, 'Entity Discount Amount')[0], 100);
  const none = zohoInvoiceRows({ a: zInv() }, ['a']);
  assert.deepStrictEqual([col(none, 'Discount Type')[0], col(none, 'Entity Discount Percent')[0], col(none, 'Is Discount Before Tax')[0]], ['', '', '']);
});

test('zohoInvoiceRows: VAT off has no tax columns; on has standard, zero and exempt lines', () => {
  const off = zohoInvoiceRows({ a: zInv() }, ['a']);
  assert.deepStrictEqual([col(off, 'Item Tax1')[0], col(off, 'Item Tax1 %')[0], col(off, 'Is Inclusive Tax')[0]], ['', '', '']);
  const items = [{ desc: 'S', qty: '1', price: '1' }, { desc: 'Z', qty: '1', price: '1', vatCat: 'zero' }, { desc: 'E', qty: '1', price: '1', vatCat: 'exempt' }];
  const on = zohoInvoiceRows({ a: zInv({ vatToggle: true, items }) }, ['a']);
  assert.deepStrictEqual(col(on, 'Item Tax1'), ['VAT', 'VAT', '']);
  assert.deepStrictEqual(col(on, 'Item Tax1 %'), [15, 0, '']);
  assert.deepStrictEqual(col(on, 'Item Tax1 Type'), ['ItemAmount', 'ItemAmount', '']);
  assert.deepStrictEqual(col(on, 'Is Inclusive Tax'), ['false', 'false', 'false']);
  const inc = zohoInvoiceRows({ a: zInv({ vatToggle: true, vatInclusive: true }) }, ['a']);
  assert.strictEqual(col(inc, 'Is Inclusive Tax')[0], 'true');
});

// --- EFT block and payment link ---
test('eftRows: only filled fields, trimmed, then the reference', () => {
  assert.deepStrictEqual(eftRows({ bankName: ' FNB ', bankAccount: '62123456789', bankType: 'savings' }, ' INV-0007 '),
    [['Bank', 'FNB'], ['Account number', '62123456789'], ['Account type', 'Savings'], ['Reference', 'INV-0007']]);
  assert.deepStrictEqual(eftRows({ bankHolder: 'A Co', bankBranch: '250655', bankType: 'cheque' }, 'X').map(r => r[0]),
    ['Account holder', 'Branch code', 'Account type', 'Reference']);
});

test('eftRows: nothing when no bank field is filled; unknown type and missing reference ignored', () => {
  assert.deepStrictEqual(eftRows({}, 'INV-1'), []);
  assert.deepStrictEqual(eftRows(undefined, 'INV-1'), []);
  assert.deepStrictEqual(eftRows({ bankName: '  ', bankType: 'gold' }, 'INV-1'), []);
  assert.deepStrictEqual(eftRows({ bankName: 'FNB' }, ''), [['Bank', 'FNB']]);
  assert.deepStrictEqual(eftRows({ bankName: 5 }, 'INV-1'), []);
});

const link = (t, o = {}) => paymentLink(t, { amount: 1234.5, number: 'INV-0007', currency: 'ZAR', ...o });

test('paymentLink: substitutes amount (2 dp, dot), number and currency', () => {
  assert.strictEqual(link('https://pay.example.com/{number}?a={amount}&c={currency}'), 'https://pay.example.com/INV-0007?a=1234.50&c=ZAR');
  assert.strictEqual(link('https://paypal.me/jo/{amount}{currency}'), 'https://paypal.me/jo/1234.50ZAR');
  assert.strictEqual(link('https://x.co/?a={amount}&b={amount}'), 'https://x.co/?a=1234.50&b=1234.50');
  assert.strictEqual(link('https://x.co/?a={amount}', { amount: '99' }), 'https://x.co/?a=99.00');
  assert.strictEqual(link('https://x.co/?a={amount}', { amount: 0.1 + 0.2 }), 'https://x.co/?a=0.30');
});

test('paymentLink: values are URL-encoded', () => {
  assert.strictEqual(link('https://x.co/?n={number}', { number: 'INV 0007/a&b=c#d' }), 'https://x.co/?n=INV%200007%2Fa%26b%3Dc%23d');
  assert.strictEqual(link('https://x.co/?c={currency}', { currency: 'Z&R' }), 'https://x.co/?c=Z%26R');
  assert.strictEqual(link('https://x.co/{number}', { number: 'é' }), 'https://x.co/%C3%A9');
});

test('paymentLink: templates without placeholders are fine; unknown placeholders stay literal', () => {
  assert.strictEqual(link('https://pay.example.com/invoice-link'), 'https://pay.example.com/invoice-link');
  assert.strictEqual(link('https://x.co/{other}'), 'https://x.co/%7Bother%7D');
  assert.strictEqual(link('https://x.co/?a={amount}', { amount: NaN }), 'https://x.co/?a=');
  assert.strictEqual(link('https://x.co/?a={number}', { number: undefined }), 'https://x.co/?a=');
});

test('paymentLink: only https', () => {
  ['javascript:alert(1)', 'JavaScript:alert(1)//{number}', 'data:text/html,<b>x</b>', 'http://x.co/{number}', 'ftp://x.co/a',
    'mailto:a@b.co', 'file:///etc/passwd', 'vbscript:x', '//x.co/a', 'x.co/pay', 'https:', 'https://', '{number}'].forEach(t =>
    assert.strictEqual(link(t), '', t));
  assert.strictEqual(link('HTTPS://X.co/a'), 'https://x.co/a');
});

test('paymentLink: whitespace, angle brackets, credentials and non-strings are rejected', () => {
  assert.strictEqual(link('  https://x.co/a  '), 'https://x.co/a');
  assert.strictEqual(link('https://x.co/a b'), '');
  assert.strictEqual(link('https://x.co/a\tb'), '');
  assert.strictEqual(link('https://x.co/a\nb'), '');
  assert.strictEqual(link('https://paypal.me/<name>/{amount}{currency}'), '');
  assert.strictEqual(link('https://user:pw@x.co/a'), '');
  assert.strictEqual(link(''), '');
  assert.strictEqual(link('   '), '');
  assert.strictEqual(link(null), '');
  assert.strictEqual(link(42), '');
  assert.strictEqual(paymentLink('https://x.co/{amount}'), 'https://x.co/');
});

test('paymentLink: a hostile value cannot change the scheme or host', () => {
  assert.strictEqual(link('https://x.co/?r={number}', { number: 'javascript:alert(1)' }), 'https://x.co/?r=javascript%3Aalert(1)');
  assert.strictEqual(link('https://x.co/{number}', { number: '../..//evil.com' }), 'https://x.co/..%2F..%2F%2Fevil.com');
});

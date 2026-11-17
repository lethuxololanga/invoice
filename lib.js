// Pure helpers — loaded as a plain script in the browser, require()'d by lib.test.js.

// YYYY-MM-DD in local time (toISOString() is UTC and gives yesterday's date just after midnight in SA).
function localISODate(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(isoDate, days) {
  const d = new Date(isoDate + 'T00:00:00');
  d.setDate(d.getDate() + Number(days));
  return localISODate(d);
}

function safeParse(raw, fallback) {
  try { return JSON.parse(raw) ?? fallback; } catch { return fallback; }
}

// Half-away-from-zero to cents. ponytail: +1e-6 cent nudge fixes float cases like 1.005*100 = 100.4999…;
// only wrong for values within a millionth of a cent below .5, which qty × price never produces.
function round2(n) {
  return Math.sign(n) * Math.round(Math.abs(n) * 100 + 1e-6) / 100;
}

// Discount comes off the subtotal before VAT. It can't be negative or exceed the subtotal
// (a negative-price line can make the subtotal itself <= 0, which leaves nothing to discount).
function discountAmount(subtotal, discount) {
  const value = Math.max(0, parseFloat(discount && discount.value) || 0);
  const raw = discount && discount.type === 'amount' ? value : subtotal * value / 100;
  return Math.max(0, Math.min(round2(raw), subtotal));
}

const VAT_CATEGORIES = ['standard', 'zero', 'exempt'];

// Lines saved before VAT categories existed (or with an unknown value) are standard-rated.
function vatCategory(item) {
  return VAT_CATEGORIES.includes(item && item.vatCat) ? item.vatCat : 'standard';
}

// Splits `total` across `amounts` pro rata, each share rounded to cents. The rounding remainder goes on
// the largest amount so the shares always add up to `total` exactly.
function apportion(total, amounts, sum) {
  if (!total || !sum) return amounts.map(() => 0);
  const shares = amounts.map(a => round2(total * a / sum));
  const largest = amounts.indexOf(Math.max(...amounts));
  shares[largest] = round2(shares[largest] + total - round2(shares.reduce((a, b) => a + b, 0)));
  return shares;
}

// Each line is rounded before summing so the printed line totals add up exactly to the subtotal.
// `discount` is optional: { type: 'percent' | 'amount', value }. VAT is charged on `net`, the discounted subtotal.
// Items may carry `vatCat` ('standard' | 'zero' | 'exempt'); only standard lines pay `vatRate`. The discount is
// apportioned across the categories and VAT worked out per category on its discounted amount.
// `options.inclusive`: prices already include VAT, so `subtotal` and the lines are VAT-inclusive and the
// discounted subtotal is the total. Per category VAT = round2(gross × rate / (100 + rate)) and excl = gross − VAT,
// so excl + VAT = gross to the cent in every category and on the invoice.
// `categories[cat]` = { amount (as entered, before discount), discount, net (excl. VAT), vat, total }.
function invoiceTotals(items, vatRate, discount, options = {}) {
  const rate = vatRate || 0;
  const inclusive = !!options.inclusive;
  const lineTotals = items.map(it => round2((parseFloat(it.qty) || 0) * (parseFloat(it.price) || 0)));
  const subtotal = round2(lineTotals.reduce((a, b) => a + b, 0));
  const discountOff = discountAmount(subtotal, discount);
  const amounts = VAT_CATEGORIES.map(cat =>
    round2(lineTotals.reduce((sum, t, i) => (vatCategory(items[i]) === cat ? sum + t : sum), 0)));
  const shares = apportion(discountOff, amounts, subtotal);
  const categories = {};
  VAT_CATEGORIES.forEach((cat, i) => {
    const after = round2(amounts[i] - shares[i]);
    const r = cat === 'standard' ? rate : 0;
    const vat = round2(inclusive ? after * r / (100 + r) : after * r / 100);
    const net = inclusive ? round2(after - vat) : after;
    categories[cat] = { amount: amounts[i], discount: shares[i], net, vat, total: round2(net + vat) };
  });
  const vat = round2(VAT_CATEGORIES.reduce((sum, cat) => sum + categories[cat].vat, 0));
  const discounted = round2(subtotal - discountOff);
  const net = inclusive ? round2(discounted - vat) : discounted;
  return { lineTotals, subtotal, discount: discountOff, net, vat, total: inclusive ? discounted : round2(net + vat), categories };
}

// INV-0009 → INV-0010: bumps the last run of digits, keeping its zero padding.
function nextInvoiceNumber(num) {
  if (/\d/.test(num)) return num.replace(/\d+(?!.*\d)/, m => String(Number(m) + 1).padStart(m.length, '0'));
  return num ? num + '-2' : 'INV-0001';
}

// Number after the highest of `numbers`, or `fallback` when there are none.
// ponytail: plain string sort, so it assumes zero-padded numbers (INV-0009 < INV-0010).
function nextNumberAfter(numbers, fallback) {
  return numbers.length ? nextInvoiceNumber([...numbers].sort().pop()) : fallback;
}

const FIRST_NUMBERS = { invoice: 'INV-0001', quote: 'QUO-0001', credit: 'CN-0001' };

// Next free number in `type`'s sequence ('invoice', 'quote' or 'credit'): one past the highest saved one,
// or past `current` when that's higher (e.g. an unsaved draft), and never a number already saved.
function nextFreeNumber(list, type, current = '') {
  const sameType = Object.keys(list).filter(num => (list[num].docType || 'invoice') === type);
  if (current) sameType.push(current);
  let num = nextNumberAfter(sameType, FIRST_NUMBERS[type] || FIRST_NUMBERS.invoice);
  while (list[num]) num = nextInvoiceNumber(num);
  return num;
}

// Sum of recorded payments in cents-exact form. Blank, invalid and non-positive amounts are ignored.
function paymentsTotal(payments) {
  if (!Array.isArray(payments)) return 0;
  return round2(payments.reduce((sum, p) => {
    const amount = parseFloat(p && p.amount);
    return amount > 0 ? sum + amount : sum;
  }, 0));
}

// Amount still owed after payments and `credited` (credit notes issued against it). Never below 0:
// an overpayment shows as a zero balance, not a credit.
function balanceDue(total, payments, credited = 0) {
  return Math.max(0, round2((total || 0) - paymentsTotal(payments) - (credited || 0)));
}

// Grand total of a document as saved (the same sum the sheet shows).
function savedTotal(doc) {
  const vatOn = !!doc.vatToggle;
  return invoiceTotals(doc.items || [], vatOn ? parseFloat(doc.vatRate) || 0 : 0,
    { type: doc.discountType, value: doc.discountValue }, { inclusive: !!(vatOn && doc.vatInclusive) }).total;
}

// Sum of the saved credit notes in `list` issued against invoice `invoiceNumber`. `exclude` is a number
// to leave out — the credit note being saved, whose old copy it is about to replace.
function creditsTotal(list, invoiceNumber, exclude) {
  if (!list || !invoiceNumber) return 0;
  return round2(Object.keys(list).reduce((sum, num) => {
    const doc = list[num];
    const isCredit = num !== exclude && doc && doc.docType === 'credit' && doc.creditFor === invoiceNumber;
    return isCredit ? sum + Math.max(0, savedTotal(doc)) : sum;
  }, 0));
}

// How much can still be credited on a saved invoice: its total less the credit notes already issued
// against it (apart from `exclude`). A credit note may not go over this.
function creditRemaining(list, invoiceNumber, exclude) {
  const original = list && list[invoiceNumber];
  if (!original) return 0;
  return Math.max(0, round2(savedTotal(original) - creditsTotal(list, invoiceNumber, exclude)));
}

// today is YYYY-MM-DD; ISO dates compare correctly as strings. A quote's dueDate is its "valid until".
// `total` (the invoice's grand total) lets payments that cover it count as Paid; leave it out and only the paid flag does.
// Quotes: Accepted / Declined (inv.quoteStatus) win over Expired. Invoices: Paid, else Overdue (even with
// part payments, so one status string), else 'Part paid', else ''.
// `credited` is the sum of credit notes issued against the invoice (needs `total` too). Rules:
// - credits alone cover the total → 'Credited', even if payments were received (they're owed back, not owing);
// - otherwise ticked paid, or payments + credits cover it with at least one payment → 'Paid';
// - a part credit on its own doesn't get a status: it only lowers the balance (and can still be Overdue).
// Credit notes have no status of their own; the ledger labels them "Credit for …".
function invoiceStatus(inv, today, total, credited = 0) {
  const late = inv.dueDate && inv.dueDate < today;
  if (inv.docType === 'credit') return '';
  if (inv.docType === 'quote') {
    if (inv.quoteStatus === 'accepted') return 'Accepted';
    if (inv.quoteStatus === 'declined') return 'Declined';
    return late ? 'Expired' : '';
  }
  const received = paymentsTotal(inv.payments);
  const known = total !== undefined;
  if (known && credited > 0 && round2(credited) >= round2(total)) return 'Credited';
  if (inv.paid || (received > 0 && known && round2(received + (credited || 0)) >= round2(total))) return 'Paid';
  if (late) return 'Overdue';
  return received > 0 ? 'Part paid' : '';
}

// Everything the ledger needs to know about saved document `num`: its kind, total, credits received,
// status and balance. `unpaid` = an invoice that still has a balance and isn't Paid or Credited.
function ledgerEntry(list, num, today) {
  const doc = list[num];
  const kind = doc.docType === 'credit' || doc.docType === 'quote' ? doc.docType : 'invoice';
  const total = savedTotal(doc);
  const credited = kind === 'invoice' ? creditsTotal(list, num) : 0;
  const status = invoiceStatus(doc, today, total, credited);
  const balance = kind === 'invoice' ? balanceDue(total, doc.payments, credited) : 0;
  const unpaid = kind === 'invoice' && status !== 'Paid' && status !== 'Credited' && balance > 0;
  return { kind, total, credited, status, balance, unpaid };
}

// Money still owed, per currency: { [currency]: { outstanding, overdue, count, overdueCount } }.
// Only unpaid invoices count (quotes and credit notes don't, though credits already lower balances),
// and only currencies that have some appear.
function ledgerTotals(list, today) {
  const out = {};
  Object.keys(list || {}).forEach(num => {
    const e = ledgerEntry(list, num, today);
    if (!e.unpaid) return;
    const cur = list[num].currency || 'ZAR';
    const t = out[cur] ||= { outstanding: 0, overdue: 0, count: 0, overdueCount: 0 };
    t.outstanding = round2(t.outstanding + e.balance);
    t.count++;
    if (e.status === 'Overdue') { t.overdue = round2(t.overdue + e.balance); t.overdueCount++; }
  });
  return out;
}

// Does saved document `num` belong in the ledger for this search text and status filter?
// Search is case-insensitive over the number, the client name and the line descriptions.
function ledgerMatches(list, num, today, query, filter) {
  const doc = list[num];
  const e = ledgerEntry(list, num, today);
  const byFilter = {
    all: true, unpaid: e.unpaid, overdue: e.kind === 'invoice' && e.status === 'Overdue',
    part: e.kind === 'invoice' && e.status === 'Part paid', paid: e.kind === 'invoice' && e.status === 'Paid',
    quote: e.kind === 'quote', credit: e.kind === 'credit',
  };
  if (!(byFilter[filter] ?? true)) return false;
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  const hay = [num, doc.toName, ...(Array.isArray(doc.items) ? doc.items.map(it => it && it.desc) : [])];
  return hay.some(h => String(h || '').toLowerCase().includes(q));
}

// `months` calendar months after an ISO date. Every step counts from the ORIGINAL day, clamped to the
// month's length, so 31 Jan → 28 Feb → 31 Mar (not 28 Mar).
function addMonths(isoDate, months) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const index = y * 12 + (m - 1) + Number(months);
  const year = Math.floor(index / 12);
  const month = index % 12;
  const day = Math.min(d, new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// The next date a saved repeating invoice is due to be repeated: invoice date + one month per period, the
// first period after `lastRepeated` (the scheduled date last created). '' when it doesn't repeat.
function nextRepeatDate(doc) {
  if (!doc || doc.repeat !== 'monthly' || (doc.docType || 'invoice') !== 'invoice' || !/^\d{4}-\d{2}-\d{2}$/.test(doc.invDate || '')) return '';
  let n = 1;
  let next = addMonths(doc.invDate, n);
  while (doc.lastRepeated && next <= doc.lastRepeated && n < 1200) next = addMonths(doc.invDate, ++n);
  return next;
}

// Repeating invoices whose next date is today or earlier, oldest first: [{ num, date }].
function dueRepeats(list, today) {
  return Object.keys(list || {})
    .map(num => ({ num, date: nextRepeatDate(list[num]) }))
    .filter(r => r.date && r.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.num.localeCompare(b.num));
}

// One CSV cell, RFC 4180: quoted when it holds a comma, quote, CR or LF, inner quotes doubled.
// Numbers are written as they are; text that a spreadsheet would run as a formula (= + - @, tab or CR first)
// gets a leading ' so it opens as plain text.
function csvEscape(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// rows: array of arrays (header first). CRLF line endings, UTF-8 BOM so Excel reads accents and rand signs right.
function toCSV(rows) {
  return '﻿' + rows.map(r => r.map(csvEscape).join(',')).join('\r\n') + '\r\n';
}

// Zoho Books' invoice import column names, from its own sample file (books.zoho.com/common/import/sample_invoices.csv).
// 'Product Type' isn't in that sample; Zoho ignores a column you don't map.
const ZOHO_INVOICE_HEADERS = ['Invoice Date', 'Invoice Number', 'Invoice Status', 'Customer Name', 'Due Date',
  'Currency Code', 'Item Name', 'Item Desc', 'Product Type', 'Quantity', 'Item Price', 'Discount Type',
  'Entity Discount Percent', 'Entity Discount Amount', 'Is Discount Before Tax', 'Is Inclusive Tax',
  'Item Tax1', 'Item Tax1 Type', 'Item Tax1 %', 'Notes', 'Terms & Conditions'];

// A plain decimal for a number column: dot, no grouping, no exponent. '' when blank or not a number.
function csvNumber(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? +n.toFixed(6) : '';
}

// Zoho keeps only the name, description, quantity and rate of a line (it drops the unit), so the first line of
// the description is the item name (max 100 chars, the overflow moves to the description) and the rest of the
// description plus "(qty unit)" is the description.
function zohoItemText(item) {
  const lines = String(item.desc || '').split(/\r?\n/).map(l => l.trim());
  const first = lines.shift() || '';
  const name = first.slice(0, 100) || 'Item';
  const rest = [first.slice(100).trim(), ...lines].join('\n').trim();
  const unit = String(item.unit || '').trim();
  const suffix = unit ? `(${csvNumber(item.qty) === '' ? item.qty : csvNumber(item.qty)} ${unit})` : '';
  return { name, desc: [rest, suffix].filter(Boolean).join(rest ? ' ' : '') };
}

// Header + one row per line of each saved invoice in `numbers` (quotes and credit notes are skipped).
// Invoice-level columns repeat on every row. Status is always Draft: payments aren't part of this import.
// The discount is an entity-level one, before tax. Tax columns only when VAT is on: standard lines carry the
// rate, zero-rated lines 0, exempt lines no tax at all.
function zohoInvoiceRows(list, numbers, taxName = 'VAT') {
  const rows = [ZOHO_INVOICE_HEADERS];
  numbers.forEach(num => {
    const doc = list[num];
    if (!doc || (doc.docType || 'invoice') !== 'invoice') return;
    const vatOn = !!doc.vatToggle;
    const rate = csvNumber(doc.vatRate) || 0;
    const items = Array.isArray(doc.items) ? doc.items : [];
    const subtotal = invoiceTotals(items, 0).subtotal;
    const value = Math.max(0, parseFloat(doc.discountValue) || 0);
    const amount = doc.discountType === 'amount';
    const off = value > 0 ? (amount ? discountAmount(subtotal, { type: 'amount', value }) : Math.min(value, 100)) : '';
    items.forEach(item => {
      const { name, desc } = zohoItemText(item);
      const cat = vatCategory(item);
      const taxed = vatOn && cat !== 'exempt';
      rows.push([
        doc.invDate || '', doc.invNumber || num, 'Draft', doc.toName || '', doc.dueDate || '',
        doc.currency || 'ZAR', name, desc, 'services', csvNumber(item.qty), csvNumber(item.price),
        off === '' ? '' : 'entity_level',
        off !== '' && !amount ? off : '', off !== '' && amount ? off : '', off === '' ? '' : 'true',
        vatOn ? String(!!doc.vatInclusive) : '',
        taxed ? taxName : '', taxed ? 'ItemAmount' : '', taxed ? (cat === 'zero' ? 0 : rate) : '',
        doc.notes || '', doc.terms || '',
      ]);
    });
  });
  return rows;
}

// Bank details printed as "Pay by EFT". `details` holds bankName / bankHolder / bankAccount / bankBranch / bankType.
const EFT_ACCOUNT_TYPES = { cheque: 'Cheque / Current', savings: 'Savings', transmission: 'Transmission' };

// [label, value] rows for the EFT block: the bank fields that are filled, then the reference (the invoice number).
// [] when no bank field is filled, so a bare reference never prints on its own.
function eftRows(details, reference) {
  const d = details || {};
  const text = k => (typeof d[k] === 'string' ? d[k].trim() : '');
  const rows = [['Bank', text('bankName')], ['Account holder', text('bankHolder')], ['Account number', text('bankAccount')],
    ['Branch code', text('bankBranch')], ['Account type', EFT_ACCOUNT_TYPES[d.bankType] || '']].filter(r => r[1]);
  const ref = typeof reference === 'string' ? reference.trim() : '';
  if (rows.length && ref) rows.push(['Reference', ref]);
  return rows;
}

// Online payment link from a URL template with {amount}, {number} and {currency}; each value is URL-encoded.
// Returns the URL, or '' unless the result is a plain https URL: imported backups can hold anything, and a
// javascript: / data: / http: link must never reach an href. Whitespace, < and > (an unfilled "<name>") are rejected too.
function paymentLink(template, { amount, number, currency } = {}) {
  if (typeof template !== 'string') return '';
  const text = template.trim();
  if (!text || /[\s<>]/.test(text)) return '';
  const n = typeof amount === 'number' ? amount : parseFloat(amount);
  const values = {
    amount: Number.isFinite(n) ? n.toFixed(2) : '',
    number: String(number ?? '').trim(),
    currency: String(currency ?? '').trim(),
  };
  const filled = text.replace(/\{(amount|number|currency)\}/g, (_, k) => encodeURIComponent(values[k]));
  try {
    const url = new URL(filled);
    return url.protocol === 'https:' && url.hostname && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

if (typeof module === 'object') module.exports = { localISODate, addDays, safeParse, round2, vatCategory, invoiceTotals, nextInvoiceNumber, nextNumberAfter, nextFreeNumber, paymentsTotal, balanceDue, savedTotal, creditsTotal, creditRemaining, invoiceStatus, ledgerEntry, ledgerTotals, ledgerMatches, addMonths, nextRepeatDate, dueRepeats, csvEscape, toCSV, csvNumber, zohoItemText, zohoInvoiceRows, ZOHO_INVOICE_HEADERS, eftRows, EFT_ACCOUNT_TYPES, paymentLink };

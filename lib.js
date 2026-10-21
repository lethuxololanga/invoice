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

// Each line is rounded before summing so the printed line totals add up exactly to the subtotal.
function invoiceTotals(items, vatRate) {
  const lineTotals = items.map(it => round2((parseFloat(it.qty) || 0) * (parseFloat(it.price) || 0)));
  const subtotal = round2(lineTotals.reduce((a, b) => a + b, 0));
  const vat = round2(subtotal * (vatRate || 0) / 100);
  return { lineTotals, subtotal, vat, total: round2(subtotal + vat) };
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

// today is YYYY-MM-DD; ISO dates compare correctly as strings. A quote's dueDate is its "valid until".
function invoiceStatus(inv, today) {
  const late = inv.dueDate && inv.dueDate < today;
  if (inv.docType === 'quote') return late ? 'Expired' : '';
  if (inv.paid) return 'Paid';
  if (late) return 'Overdue';
  return '';
}

if (typeof module === 'object') module.exports = { localISODate, addDays, safeParse, round2, invoiceTotals, nextInvoiceNumber, nextNumberAfter, invoiceStatus };

const STORAGE_KEY = 'invoice-draft';

const itemsBody = document.getElementById('itemsBody');
const fields = ['fromName','fromDetails','toName','toDetails','toEmail','invNumber','invDate','dueDate','notes','vatToggle','vatRate','currency','terms','paid','docType','discountType','discountValue','vatInclusive','quoteStatus','creditReason','repeat','bankName','bankHolder','bankAccount','bankBranch','bankType','payLink'];

// Business settings: they go with every document (so a saved invoice prints what it was sent with) and carry over to new ones.
const SETTING_FIELDS = ['bankName','bankHolder','bankAccount','bankBranch','bankType','payLink'];

// A new document made from saved `src` keeps src's settings; ones it lacks (older saves, or left blank) come from the screen.
function inheritSettings(src) {
  const out = { ...src };
  SETTING_FIELDS.forEach(id => { if (!out[id]) out[id] = document.getElementById(id).value; });
  return out;
}

const DOC_NAMES = { invoice: 'invoice', quote: 'quote', credit: 'credit note' };
const docKind = () => (DOC_NAMES[document.getElementById('docType').value] ? document.getElementById('docType').value : 'invoice');
const isQuote = () => docKind() === 'quote';
const isCredit = () => docKind() === 'credit';
const docName = () => DOC_NAMES[docKind()];
const capitalise = s => s[0].toUpperCase() + s.slice(1);

// The saved invoice a credit note on screen is for ('' when none). Not a form field: it's set by Credit note.
let creditFor = '';

// For a saved repeating invoice: the scheduled date its latest repeat was created for. Not a form field: only Create sets it.
let lastRepeated = '';

// Format each currency the way its own country writes it (en-ZA uses a decimal comma, odd for e.g. USD clients).
const CURRENCY_LOCALES = {
  ZAR: 'en-ZA', USD: 'en-US', EUR: 'en-IE', GBP: 'en-GB', JPY: 'ja-JP', AUD: 'en-AU', CAD: 'en-CA', CHF: 'de-CH',
  CNY: 'zh-CN', INR: 'en-IN', NZD: 'en-NZ', SGD: 'en-SG', HKD: 'en-HK', AED: 'en-AE', BRL: 'pt-BR',
};

function money(n, currency = document.getElementById('currency').value) {
  return (n || 0).toLocaleString(CURRENCY_LOCALES[currency] || 'en-ZA', { style: 'currency', currency });
}

function autosize(ta) {
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
}

function addItem(data = { desc: '', qty: 1, unit: '', price: 0, vatCat: 'standard' }, focus = false) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td class="col-desc"><textarea class="item-desc" placeholder="Description" aria-label="Description" rows="1"></textarea><span class="vat-mark print-only"></span></td>
    <td class="col-qty"><input class="item-qty" type="number" min="0" step="any" aria-label="Quantity"></td>
    <td class="col-unit"><input class="item-unit" aria-label="Unit (hrs, days, items)" placeholder="hrs" maxlength="12"></td>
    <td class="col-price"><input class="item-price" type="number" step="0.01" aria-label="Unit price" title="Use a negative price for a discount"></td>
    <td class="col-total row-total">
      <span class="row-amount">R 0.00</span>
      <select class="item-vatcat no-print" aria-label="VAT category" title="VAT category">
        <option value="standard">Std</option>
        <option value="zero">Zero</option>
        <option value="exempt">Exempt</option>
      </select>
    </td>
    <td class="col-move no-print">
      <button type="button" class="move-row move-up" aria-label="Move line up" title="Move line up">&#9650;</button>
      <button type="button" class="move-row move-down" aria-label="Move line down" title="Move line down">&#9660;</button>
    </td>
    <td class="col-del no-print"><button type="button" class="del-row" aria-label="Remove line" title="Remove line">&times;</button></td>
  `;
  const desc = tr.querySelector('.item-desc');
  desc.value = data.desc;
  tr.querySelector('.item-qty').value = data.qty;
  tr.querySelector('.item-unit').value = data.unit || '';
  tr.querySelector('.item-price').value = data.price;
  tr.querySelector('.item-vatcat').value = vatCategory(data);
  itemsBody.appendChild(tr);
  autosize(desc);

  tr.querySelector('.del-row').addEventListener('click', () => { tr.remove(); recalc(); save(); });
  tr.querySelector('.move-up').addEventListener('click', () => moveRow(tr, -1, '.move-up'));
  tr.querySelector('.move-down').addEventListener('click', () => moveRow(tr, 1, '.move-down'));
  desc.addEventListener('input', () => autosize(desc));
  desc.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      addItem(undefined, true);
      save();
    }
  });
  if (focus) desc.focus();
}

// Swaps the row with its neighbour, then puts focus back on the same button so it can be pressed repeatedly.
function moveRow(tr, dir, btnSelector) {
  const other = dir < 0 ? tr.previousElementSibling : tr.nextElementSibling;
  if (!other) return;
  if (dir < 0) other.before(tr); else other.after(tr);
  recalc();
  save();
  tr.querySelector(btnSelector).focus();
}

// The first row can't go up and the last can't go down. aria-disabled, not disabled: a disabled
// button drops keyboard focus, which would strand someone who just moved a row to the end.
function updateMoveButtons() {
  const rows = [...itemsBody.querySelectorAll('tr')];
  rows.forEach((tr, i) => {
    tr.querySelector('.move-up').setAttribute('aria-disabled', i === 0);
    tr.querySelector('.move-down').setAttribute('aria-disabled', i === rows.length - 1);
  });
}

function discountSetting() {
  return { type: document.getElementById('discountType').value, value: document.getElementById('discountValue').value };
}

// Print shows "Discount (10%)" or plain "Discount"; the row is hidden on paper when there's no discount.
function showDiscount(t) {
  const { type, value } = discountSetting();
  const percent = type === 'percent' && t.discount > 0;
  document.getElementById('discountPrintLabel').textContent = percent ? `Discount (${parseFloat(value)}%)` : 'Discount';
  document.getElementById('discountRow').classList.toggle('discount-zero', t.discount === 0);
  document.getElementById('discountAmount').textContent = money(-t.discount);
}

const VAT_MARKS = { zero: 'Zero-rated', exempt: 'VAT exempt' };
const CATEGORY_ROWS = { standard: 'catStandard', zero: 'catZero', exempt: 'catExempt' };

// SARS: a tax invoice shows the VAT-exclusive value, the VAT and the VAT-inclusive total. A mix of
// standard, zero-rated and exempt lines also lists each kind's value; those rows add up to "Total excl. VAT".
function showVat(t, vatOn, vatRate, inclusive) {
  const shown = vatOn ? Object.keys(CATEGORY_ROWS).filter(cat => t.categories[cat].net !== 0) : [];
  Object.entries(CATEGORY_ROWS).forEach(([cat, id]) => {
    document.getElementById(id + 'Row').hidden = shown.length < 2 || !shown.includes(cat);
    document.getElementById(id).textContent = money(t.categories[cat].net);
  });
  document.getElementById('catStandardLabel').textContent = `Standard-rated (${vatRate}%)`;
  document.getElementById('netRow').hidden = !vatOn || !(inclusive || t.discount > 0 || shown.length > 1);
  document.getElementById('netAmount').textContent = money(t.net);
  document.getElementById('subtotalLabel').textContent =
    vatOn ? `Subtotal (${inclusive ? 'incl.' : 'excl.'} VAT)` : 'Subtotal';
  document.getElementById('vatPrintLabel').textContent = `VAT (${vatRate}%)`;
  document.getElementById('vatRow').classList.toggle('vat-off', !vatOn);
  document.getElementById('vatInclusiveRow').hidden = !vatOn;
  document.body.dataset.vat = vatOn ? 'on' : 'off';
}

function recalc() {
  const rows = [...itemsBody.querySelectorAll('tr')];
  const items = rows.map(tr => ({
    qty: tr.querySelector('.item-qty').value,
    price: tr.querySelector('.item-price').value,
    vatCat: tr.querySelector('.item-vatcat').value,
  }));
  const vatOn = document.getElementById('vatToggle').checked;
  const vatRate = vatOn ? parseFloat(document.getElementById('vatRate').value) || 0 : 0;
  const inclusive = vatOn && document.getElementById('vatInclusive').checked;
  const t = invoiceTotals(items, vatRate, discountSetting(), { inclusive });
  showDiscount(t);
  showVat(t, vatOn, vatRate, inclusive);
  updateMoveButtons();
  rows.forEach((tr, i) => {
    tr.querySelector('.row-amount').textContent = money(t.lineTotals[i]);
    tr.querySelector('.vat-mark').textContent = vatOn ? VAT_MARKS[items[i].vatCat] || '' : '';
  });
  document.getElementById('subtotal').textContent = money(t.subtotal);
  document.getElementById('vatAmount').textContent = money(t.vat);
  document.getElementById('grandTotal').textContent = money(t.total);
  const quote = isQuote();
  const credit = isCredit();
  const credited = openInvoiceCredits();
  const balance = showPayments(t.total, quote || credit, credited);
  showPaymentDetails(quote || credit ? 0 : balance);
  document.body.dataset.doc = docKind();
  // SARS: a VAT-charging invoice must be headed "Tax Invoice". A quote isn't a tax document.
  // A credit note is headed "Credit Note" with or without VAT — that's the wording SARS asks for.
  document.querySelector('.doc-title').textContent = credit ? 'CREDIT NOTE' : quote ? 'QUOTE' : vatOn ? 'TAX INVOICE' : 'INVOICE';
  document.querySelector('label[for=invNumber]').textContent = credit ? 'Credit note #' : quote ? 'Quote #' : 'Invoice #';
  document.querySelector('label[for=dueDate]').textContent = quote ? 'Valid until' : 'Due date';
  document.getElementById('dueRow').hidden = credit; // a credit note isn't paid, so it has no due date
  document.getElementById('totalLabel').textContent = credit ? (vatOn ? 'Total credit incl. VAT' : 'Total credit')
    : vatOn ? 'Total incl. VAT' : quote ? 'Total' : 'Total due';
  document.getElementById('creditRef').textContent = creditFor ? `Credit note for invoice ${creditFor}` : '';
  document.getElementById('newInvoiceBtn').textContent = `New ${docName()}`;
  updateStamp(t.total, credited);
}

// --- Payment details: the EFT block and the online payment link (both print; the inputs don't) ---
// The link currently on the sheet ('' when none), for the Email button.
let payUrl = '';
const PAYPAL_TEMPLATE = 'https://paypal.me/<name>/{amount}{currency}';
let qrFor = '';

// Inline SVG, so nothing is fetched and it prints at any size. null when the vendored encoder is missing
// or the link is too long to encode — the link text still shows then.
function qrSvg(text) {
  if (typeof qrcode !== 'function') return null;
  try {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const quiet = 4;
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${n + quiet * 2} ${n + quiet * 2}`);
    svg.setAttribute('shape-rendering', 'crispEdges');
    svg.setAttribute('aria-hidden', 'true');
    const bg = document.createElementNS(ns, 'rect');
    bg.setAttribute('width', '100%');
    bg.setAttribute('height', '100%');
    bg.setAttribute('fill', '#fff');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', '#000');
    svg.append(bg, path);
    return svg;
  } catch { return null; }
}

// `balance` is what's still owed on an invoice (0 for quotes and credit notes, which show neither block's link).
function showPaymentDetails(balance) {
  const rows = isQuote() || isCredit() ? [] : eftRows(
    Object.fromEntries(SETTING_FIELDS.map(id => [id, document.getElementById(id).value])),
    document.getElementById('invNumber').value);
  document.getElementById('eftPrint').hidden = !rows.length;
  document.getElementById('eftRows').replaceChildren(...rows.flatMap(([label, value]) => {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    return [dt, dd];
  }));

  const template = document.getElementById('payLink').value;
  const url = balance > 0 ? paymentLink(template, {
    amount: balance, number: document.getElementById('invNumber').value, currency: document.getElementById('currency').value,
  }) : '';
  payUrl = url;
  document.getElementById('payLinkMsg').textContent = template.trim() && !paymentLink(template, { amount: 1, number: 'X', currency: 'ZAR' })
    ? 'That isn’t a usable link. It must be a full https:// address with no spaces or <placeholders>.' : '';
  document.getElementById('payPreset').value = template === PAYPAL_TEMPLATE ? 'paypal' : '';
  const box = document.getElementById('payOnline');
  box.hidden = !url;
  const anchor = document.getElementById('payOnlineLink');
  anchor.textContent = url;
  if (url) anchor.setAttribute('href', url); else anchor.removeAttribute('href');
  if (qrFor !== url) {
    qrFor = url;
    const svg = url ? qrSvg(url) : null;
    document.getElementById('payQr').replaceChildren(...(svg ? [svg] : []));
  }
  document.getElementById('payQr').hidden = !url || !document.getElementById('payQr').firstChild;
}

// Picking a preset fills the template; PayPal's needs the user's own name, so select that part.
document.getElementById('payPreset').addEventListener('input', (e) => {
  if (e.target.value !== 'paypal') return;
  const input = document.getElementById('payLink');
  input.value = PAYPAL_TEMPLATE;
  input.focus();
  const at = PAYPAL_TEMPLATE.indexOf('<name>');
  try { input.setSelectionRange(at, at + 6); } catch {}
});

// Sum of saved credit notes against the saved invoice that's open (0 for drafts, quotes and credit notes).
function openInvoiceCredits() {
  if (docKind() !== 'invoice' || !openInvoice) return 0;
  return creditsTotal(getSavedList(), openInvoice);
}

function collectData() {
  const data = {};
  fields.forEach(id => {
    const el = document.getElementById(id);
    data[id] = el.type === 'checkbox' ? el.checked : el.value;
  });
  data.items = [...itemsBody.querySelectorAll('tr')].map(tr => ({
    desc: tr.querySelector('.item-desc').value,
    qty: tr.querySelector('.item-qty').value,
    unit: tr.querySelector('.item-unit').value,
    price: tr.querySelector('.item-price').value,
    vatCat: tr.querySelector('.item-vatcat').value,
  }));
  data.payments = payments.map(p => ({ ...p }));
  data.creditFor = data.docType === 'credit' ? creditFor : '';
  if (data.docType !== 'invoice') data.repeat = '';
  data.lastRepeated = data.repeat ? lastRepeated : '';
  return data;
}

function applyData(data) {
  data = { docType: 'invoice', discountType: 'percent', discountValue: '', quoteStatus: '', creditReason: '', repeat: '', lastRepeated: '', ...data }; // saves from before quotes / discounts / quote status / credit notes / repeats existed
  // No defaults for SETTING_FIELDS: a save from before payment details keeps the ones on screen, like fromName,
  // so opening an old invoice and pressing New doesn't wipe the user's bank details.
  fields.forEach(id => {
    const el = document.getElementById(id);
    // Missing checkbox = unchecked, so older saves without `paid` don't inherit the previous invoice's tick.
    if (el.type === 'checkbox') el.checked = !!data[id];
    else if (id in data) el.value = data[id];
  });
  payments = Array.isArray(data.payments) ? data.payments.filter(p => p && typeof p === 'object').map(p => ({ ...p })) : [];
  creditFor = data.docType === 'credit' && typeof data.creditFor === 'string' ? data.creditFor : '';
  lastRepeated = typeof data.lastRepeated === 'string' ? data.lastRepeated : '';
  renderPayments();
  itemsBody.innerHTML = '';
  (data.items || []).forEach(item => addItem(item));
  recalc();
}

// localStorage throws when full (e.g. big logo + many saved invoices) — don't let that break the app.
function store(key, value) {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}

// Reading throws too when the browser blocks storage (some private windows, blocked site data).
function load(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function save() {
  store(STORAGE_KEY, JSON.stringify(collectData()));
}

// PAID / OVERDUE / EXPIRED / ACCEPTED / DECLINED / CREDITED stamp on the paper, from the form as it stands (not just saved invoices).
function updateStamp(total, credited) {
  const stamp = document.getElementById('stamp');
  let status = invoiceStatus({
    docType: docKind(),
    paid: document.getElementById('paid').checked,
    dueDate: document.getElementById('dueDate').value,
    quoteStatus: document.getElementById('quoteStatus').value,
    payments,
  }, localISODate(new Date()), total, credited);
  if (status === 'Part paid') status = ''; // part-paid shows as the Balance due row, not a stamp
  if (stamp.textContent === status) return; // it's a live region — don't re-announce on every keystroke
  stamp.hidden = !status;
  stamp.textContent = status;
  stamp.dataset.status = status.toLowerCase();
}

document.getElementById('addItem').addEventListener('click', () => { addItem(undefined, true); recalc(); save(); });

// --- Dark mode ---
// Only an explicit toggle is stored — until then the theme follows the OS. CSS swaps the icon.
const themeToggle = document.getElementById('themeToggle');
themeToggle.setAttribute('aria-pressed', document.documentElement.getAttribute('data-theme') === 'dark');
themeToggle.addEventListener('click', () => {
  const theme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  themeToggle.setAttribute('aria-pressed', theme === 'dark');
  store('theme', theme);
});

// --- Email compiler (opens the user's own mail app — can't attach the PDF automatically) ---
document.getElementById('emailBtn').addEventListener('click', () => {
  alert('Your email app will open with the message written for you. It can’t attach the PDF — download it first with Download PDF, then attach it.');
  const business = document.getElementById('fromName').value.trim() || 'us';
  const client = document.getElementById('toName').value.trim();
  const email = document.getElementById('toEmail').value.trim();
  const doc = docName();
  const num = document.getElementById('invNumber').value.trim() || `this ${doc}`;
  const total = document.getElementById('grandTotal').textContent;
  const due = isCredit() ? '' : document.getElementById('dueDate').value;
  const against = isCredit() && creditFor ? `, against invoice ${creditFor}` : '';

  const subject = `${capitalise(doc)} ${num} from ${business}`;
  const body = [
    `Hi ${client || 'there'},`,
    '',
    `Please find attached ${doc} ${num} for ${total}${against}${due ? `, ${doc === 'quote' ? 'valid until' : 'due'} ${due}` : ''}.`,
    '',
    ...(payUrl ? [`Pay online: ${payUrl}`, ''] : []),
    'Kind regards,',
    business,
  ].join('\n');

  openMail(`mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
});

// Its own function so tests can intercept the navigation.
function openMail(url) { window.location.href = url; }

// --- PDF filename (browser print/save-as-PDF uses the document title) ---
const APP_TITLE = document.title;
document.getElementById('printBtn').addEventListener('click', () => {
  const num = document.getElementById('invNumber').value.trim() || docName();
  const client = document.getElementById('toName').value.trim();
  document.title = `${capitalise(docName())} ${num}${client ? ' - ' + client : ''}`;
  window.print();
});
window.addEventListener('afterprint', () => { document.title = APP_TITLE; });

// Keeps business details, notes, logo and settings; clears the client and lines, bumps the number.
document.getElementById('newInvoiceBtn').addEventListener('click', () => {
  if (!confirm(`Start a new ${docName()}? Anything not saved on this one will be cleared. Your business details, notes and logo stay.`)) return;
  const data = collectData();
  applyData({
    ...data,
    invNumber: nextFreeNumber(getSavedList(), docKind(), data.invNumber.trim()),
    invDate: localISODate(new Date()),
    dueDate: '',
    toName: '', toDetails: '', toEmail: '', paid: false, discountValue: '', quoteStatus: '', payments: [], creditFor: '', creditReason: '', repeat: '', lastRepeated: '',
    items: [{ desc: '', qty: 1, unit: '', price: 0 }],
  });
  applyDueDate();
  setOpenInvoice('');
  refreshInvoiceList();
  save();
});

// --- Payment terms → auto due date ---
const termsSelect = document.getElementById('terms');
const invDateInput = document.getElementById('invDate');
const dueDateInput = document.getElementById('dueDate');

// Invoices: due date from payment terms. Quotes: valid for 30 days. Credit notes: none.
function applyDueDate() {
  if (isCredit()) { dueDateInput.value = ''; return; }
  const days = isQuote() ? 30 : termsSelect.value;
  if (days === 'custom') return;
  dueDateInput.value = addDays(invDateInput.value || localISODate(new Date()), days);
}
// 'input' (not 'change') so these run before the sheet-wide listener below recalcs and saves.
termsSelect.addEventListener('input', applyDueDate);
invDateInput.addEventListener('input', applyDueDate);

// --- Quotes ---
// Switching type makes it a new, unsaved document numbered in its own sequence (QUO-… / INV-… / CN-…).
function switchDocType(type) {
  document.getElementById('docType').value = type;
  document.getElementById('invNumber').value = nextFreeNumber(getSavedList(), type);
  document.getElementById('paid').checked = false;
  document.getElementById('quoteStatus').value = '';
  document.getElementById('creditReason').value = '';
  document.getElementById('repeat').value = '';
  lastRepeated = '';
  creditFor = '';
  payments = [];
  renderPayments();
  applyDueDate();
  setOpenInvoice('');
  recalc();
  save();
  refreshInvoiceList();
}
// Choosing "Credit note" while a saved invoice is open credits that invoice, same as the Credit note button.
document.getElementById('docType').addEventListener('input', (e) => {
  const list = getSavedList();
  if (e.target.value === 'credit' && list[openInvoice] && (list[openInvoice].docType || 'invoice') === 'invoice') {
    if (!startCreditNote(openInvoice)) e.target.value = 'invoice'; // cancelled: the select already shows "Credit note"
  } else switchDocType(e.target.value);
});

// --- Credit notes ---
// A new, unsaved credit note copying the saved invoice (not the screen, which may have unsaved edits):
// same parties, currency, VAT settings, discount and lines, dated today, with the next CN number.
// The user removes or edits lines to credit only part of it.
function startCreditNote(num) {
  const list = getSavedList();
  const original = list[num];
  if (!original || !confirmDiscard('Start a credit note')) return false;
  applyData({
    ...inheritSettings(original),
    docType: 'credit',
    invNumber: nextFreeNumber(list, 'credit'),
    invDate: localISODate(new Date()),
    dueDate: '', paid: false, quoteStatus: '', payments: [],
    creditFor: num, creditReason: '', repeat: '', lastRepeated: '',
  });
  setOpenInvoice('');
  save();
  refreshInvoiceList();
  document.getElementById('saveStatus').textContent = `Credit note ${document.getElementById('invNumber').value} for invoice ${num}. Add the reason, then press Save.`;
  document.getElementById('creditReason').focus(); // the Credit note button just disappeared
  return true;
}

// Credit note, Duplicate and Create replace the sheet. Only ask when that would lose something: the sheet differs
// from the saved copy of the open document (or there is none). A false "changed" only costs an extra question.
function confirmDiscard(action) {
  const savedCopy = getSavedList()[openInvoice];
  const current = collectData();
  const unchanged = savedCopy && Object.keys(current).every(k => JSON.stringify(current[k]) === JSON.stringify(savedCopy[k]));
  return unchanged || confirm(`${action}? Changes on screen that aren’t saved will be lost.`);
}
document.getElementById('creditNoteBtn').addEventListener('click', () => startCreditNote(openInvoice));

// Same client, lines and notes; dated today, with the next invoice number and due date from the terms.
document.getElementById('convertBtn').addEventListener('click', () => {
  // The saved quote that's open (not whatever the typed number matches) was accepted by being converted.
  const list = getSavedList();
  if (list[openInvoice] && list[openInvoice].docType === 'quote') {
    list[openInvoice].quoteStatus = 'accepted';
    store(LIST_KEY, JSON.stringify(list));
  }
  invDateInput.value = localISODate(new Date());
  switchDocType('invoice');
  document.getElementById('saveStatus').textContent = `Converted to invoice ${document.getElementById('invNumber').value}. Press Save to keep it.`;
  document.getElementById('saveInvoiceBtn').focus(); // the Convert button just disappeared
});
// A quote's "valid until" isn't payment terms — leave them alone so Convert still uses them.
dueDateInput.addEventListener('input', () => { if (!isQuote()) termsSelect.value = 'custom'; });

// --- Saved invoices (named history, separate from the always-on draft) ---
const LIST_KEY = 'invoice-list';
const invoiceListEl = document.getElementById('invoiceList');
const deleteInvoiceBtn = document.getElementById('deleteInvoiceBtn');
const ledger = document.getElementById('ledger');

// The saved invoice currently on the sheet ('' = unsaved draft). Persisted so a reload doesn't
// make re-saving it look like a clash with another invoice.
const OPEN_KEY = 'invoice-open';
let openInvoice = load(OPEN_KEY) || '';
function setOpenInvoice(num) {
  openInvoice = num;
  store(OPEN_KEY, num);
}

function getSavedList() {
  return safeParse(load(LIST_KEY), {});
}

function shortDate(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function dueNote(inv) {
  const until = inv.dueDate ? shortDate(inv.dueDate) : '';
  if (inv.docType === 'quote') return until ? `Quote until ${until}` : 'Quote';
  return until ? `Due ${until}` : '';
}

// --- Client autocomplete: names from saved documents, newest details win ---
let clients = {};
function refreshClients(list, numbersNewestFirst) {
  clients = {};
  [...numbersNewestFirst].reverse().forEach(num => {
    const { toName, toDetails = '', toEmail = '' } = list[num];
    if (toName?.trim()) clients[toName.trim()] = { toDetails, toEmail };
  });
  document.getElementById('clientList').replaceChildren(...Object.keys(clients).sort().map(name => {
    const opt = document.createElement('option');
    opt.value = name;
    return opt;
  }));
}

// Fill in a known client's details — but never over details the user typed for someone else.
// 'input' so it runs before the sheet-wide listener saves.
document.getElementById('toName').addEventListener('input', (e) => {
  const client = clients[e.target.value.trim()];
  const toDetails = document.getElementById('toDetails');
  if (!client) return;
  if (toDetails.value && !Object.values(clients).some(c => c.toDetails === toDetails.value)) return;
  toDetails.value = client.toDetails;
  document.getElementById('toEmail').value = client.toEmail;
});

// --- Ledger tools: search, status filter, totals, repeat notices ---
// Only the filter is remembered; search text starts empty each visit.
const FILTER_KEY = 'invoice-ledger-filter';
const ledgerSearch = document.getElementById('ledgerSearch');
const ledgerFilterEl = document.getElementById('ledgerFilter');
const savedFilter = load(FILTER_KEY);
if ([...ledgerFilterEl.options].some(o => o.value === savedFilter)) ledgerFilterEl.value = savedFilter;
ledgerSearch.addEventListener('input', () => refreshInvoiceList());
ledgerFilterEl.addEventListener('change', () => {
  store(FILTER_KEY, ledgerFilterEl.value);
  refreshInvoiceList();
});

// Outstanding and Overdue per currency (the currency is named only when there's more than one).
function renderLedgerTotals(list, today) {
  const totals = ledgerTotals(list, today);
  const currencies = Object.keys(totals).sort();
  const box = document.getElementById('ledgerTotals');
  box.hidden = !currencies.length;
  box.replaceChildren(...currencies.flatMap(cur => {
    const t = totals[cur];
    const prefix = currencies.length > 1 ? `${cur} · ` : '';
    return [['Outstanding', t.outstanding, t.count, ''], ['Overdue', t.overdue, t.overdueCount, t.overdue > 0 ? 'is-overdue' : 'is-zero']].map(([label, value, count, cls]) => {
      const line = document.createElement('div');
      line.className = `totals-line ${cls}`.trim();
      const name = document.createElement('span');
      name.className = 'totals-label';
      name.textContent = `${prefix}${label}${count ? ` (${count})` : ''}`;
      const amount = document.createElement('span');
      amount.className = 'totals-value';
      amount.textContent = money(value, cur);
      line.append(name, amount);
      return line;
    });
  }));
}

// Saved repeating invoices whose next date has come. Nothing is created until Create is pressed.
function renderRepeatDue(list, today) {
  const due = dueRepeats(list, today);
  document.getElementById('repeatDue').hidden = !due.length;
  document.getElementById('repeatList').replaceChildren(...due.map(({ num, date }) => {
    const li = document.createElement('li');
    const text = document.createElement('span');
    text.className = 'repeat-text';
    text.textContent = `${num} · ${list[num].toName || 'No client'} · ${shortDate(date)}`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn';
    btn.textContent = 'Create';
    btn.setAttribute('aria-label', `Create next invoice from ${num}, dated ${shortDate(date)}`);
    btn.addEventListener('click', () => createRepeat(num, date));
    li.append(text, btn);
    return li;
  }));
}

function refreshInvoiceList() {
  const list = getSavedList();
  const today = localISODate(new Date());
  const numbers = Object.keys(list).sort().reverse();
  const shown = numbers.filter(num => ledgerMatches(list, num, today, ledgerSearch.value, ledgerFilterEl.value));
  document.getElementById('invoiceCount').textContent = numbers.length || '';
  refreshClients(list, numbers);
  document.getElementById('ledgerEmpty').hidden = numbers.length > 0;
  document.getElementById('ledgerNoMatch').hidden = !numbers.length || shown.length > 0;
  document.getElementById('ledgerTools').hidden = !numbers.length;
  const count = numbers.length ? `${shown.length} of ${numbers.length} shown` : '';
  const countEl = document.getElementById('ledgerShown');
  if (countEl.textContent !== count) countEl.textContent = count; // a live region: only touch it when the text changes
  renderLedgerTotals(list, today);
  renderRepeatDue(list, today);
  invoiceListEl.replaceChildren(...shown.map(num => {
    const inv = list[num];
    const { total, credited, status, kind } = ledgerEntry(list, num, today);
    const credit = kind === 'credit';
    const owing = kind === 'invoice' && status !== 'Paid' && status !== 'Credited' &&
      (paymentsTotal(inv.payments) > 0 || credited > 0);
    // A credit note shows as money going back: negative.
    const amount = credit ? money(-total, inv.currency)
      : owing ? `${money(balanceDue(total, inv.payments, credited), inv.currency)} of ${money(total, inv.currency)}` : money(total, inv.currency);
    const label = credit ? (inv.creditFor ? `Credit for ${inv.creditFor}` : 'Credit note') : status || dueNote(inv);
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'ledger-row';
    row.dataset.status = credit ? 'credit' : status.toLowerCase();
    if (num === openInvoice) row.setAttribute('aria-current', 'true');
    // textContent, not innerHTML: invoice data may come from an imported file.
    [[num, 'num'], [amount, 'amount'], [inv.toName || 'No client', 'client'],
     [label, 'status']].forEach(([text, cls]) => {
      const span = document.createElement('span');
      span.className = `ledger-${cls}`;
      span.textContent = text;
      if (cls === 'amount' && owing) span.title = 'Balance due of total';
      row.append(span);
    });
    row.addEventListener('click', () => {
      setOpenInvoice(num); // first: the sheet's Credited row is worked out from the open invoice
      applyData(inv);
      save();
      refreshInvoiceList();
      if (narrowScreen.matches) ledger.open = false;
    });
    const li = document.createElement('li');
    li.append(row);
    return li;
  }));
  deleteInvoiceBtn.hidden = !list[openInvoice];
  document.getElementById('duplicateBtn').hidden = !list[openInvoice] || list[openInvoice].docType === 'credit';
  document.getElementById('repeatWrap').hidden = !(list[openInvoice] && (list[openInvoice].docType || 'invoice') === 'invoice');
  // Only a saved invoice can be credited: the credit note has to point at what was actually issued.
  document.getElementById('creditNoteBtn').hidden = !(list[openInvoice] && (list[openInvoice].docType || 'invoice') === 'invoice');
}

// --- Duplicate and repeat ---
// A new, unsaved copy of saved document `src` (not the screen, which may have unsaved edits): same type, client,
// lines, notes and settings, dated `date`, with the next free number and a due date from the terms.
// No payments, paid flag, quote status, credit reference or repeat schedule come along. Returns the new number.
function startCopy(src, date) {
  const type = src.docType || 'invoice';
  const typed = document.getElementById('invNumber').value.trim();
  // An unsaved copy still on screen holds its number, so a second copy doesn't take it too.
  const invNumber = nextFreeNumber(getSavedList(), type, docKind() === type ? typed : '');
  // Custom terms have no fixed days, so keep the gap between the original's date and due date.
  const gap = src.invDate && src.dueDate ? Math.round((new Date(src.dueDate) - new Date(src.invDate)) / 86400000) : NaN;
  applyData({
    ...inheritSettings(src), invNumber, invDate: date,
    dueDate: src.terms === 'custom' && type !== 'quote' && Number.isFinite(gap) ? addDays(date, gap) : '',
    paid: false, quoteStatus: '', payments: [], creditFor: '', creditReason: '', repeat: '', lastRepeated: '',
  });
  applyDueDate();
  setOpenInvoice('');
  save();
  refreshInvoiceList();
  document.getElementById('saveInvoiceBtn').focus(); // the pressed button just disappeared
  return invNumber;
}

document.getElementById('duplicateBtn').addEventListener('click', () => {
  const src = getSavedList()[openInvoice];
  if (!src || src.docType === 'credit' || !confirmDiscard(`Duplicate ${openInvoice}`)) return;
  const from = openInvoice;
  const num = startCopy(src, localISODate(new Date()));
  document.getElementById('saveStatus').textContent = `Duplicated ${from} as ${num}. Press Save to keep it.`;
});

// Create the repeat that's due: like Duplicate but dated on the scheduled date. The source is marked straight away
// (even before the new invoice is saved) so the notice doesn't offer the same period twice.
function createRepeat(from, date) {
  const list = getSavedList();
  if (!list[from] || !confirmDiscard(`Create the next ${from}`)) return; // before marking, so Cancel skips nothing
  list[from].lastRepeated = date;
  if (!store(LIST_KEY, JSON.stringify(list))) { alert('Couldn’t create it — this browser’s storage is full. Export a backup, then delete old invoices to make room.'); return; }
  const num = startCopy(list[from], date);
  document.getElementById('saveStatus').textContent = `Created ${num} from ${from}, dated ${shortDate(date)}. Press Save to keep it.`;
}

// Bookkeeping like Paid: the saved copy updates straight away. Nothing is created until a notice's Create is pressed.
document.getElementById('repeat').addEventListener('change', (e) => {
  save();
  updateOpenSaved({ repeat: e.target.value });
  document.getElementById('saveStatus').textContent = e.target.value
    ? 'Repeats monthly. A notice appears in your list when the next one is due.' : 'No longer repeats.';
});

document.getElementById('saveInvoiceBtn').addEventListener('click', () => {
  const data = collectData();
  const num = data.invNumber.trim();
  if (!num) { alert('Add an invoice number before saving.'); return; }
  const list = getSavedList();
  if (data.docType === 'credit' && !creditNoteOk(data, num, list)) return;
  // Re-saving the invoice you opened is fine; reusing another invoice's number would silently replace it.
  if (list[num] && openInvoice !== num &&
      !confirm(`${num}${list[num].toName ? ` (${list[num].toName})` : ''} is already saved. Replace it with this invoice? To keep both, press Cancel and change the invoice number.`)) return;
  list[num] = data;
  if (!store(LIST_KEY, JSON.stringify(list))) { alert('Couldn’t save — this browser’s storage is full. Export a backup, then delete old invoices to make room.'); return; }
  setOpenInvoice(num);
  recalc(); // credit notes may already point at this number
  refreshInvoiceList();
  showDone(document.getElementById('saveInvoiceBtn'), 'Saved', `${capitalise(docName())} ${num} saved`);
});

// SARS wants a credit note to say why it was issued and which invoice it adjusts. It also can't credit more
// than is left on that invoice. Alerts and returns false when the credit note can't be saved as it is.
function creditNoteOk(data, num, list) {
  if (!data.creditReason.trim()) {
    alert('Add a reason before saving — a credit note must briefly say why it’s issued (e.g. goods returned, overcharged).');
    document.getElementById('creditReason').focus();
    return false;
  }
  if (!data.creditFor) {
    alert('A credit note must be for a saved invoice. Open that invoice from your list and press Credit note.');
    return false;
  }
  const total = savedTotal(data);
  if (!(total > 0)) { alert('This credit note’s total is zero. Add the amounts you’re crediting as positive amounts.'); return false; }
  // An invoice that's since been deleted can't be checked; the credit note can still be saved.
  if (!list[data.creditFor]) return true;
  const left = creditRemaining(list, data.creditFor, num); // `num` is about to be replaced, so don't count it twice
  if (total > left) {
    alert(`This credit note (${money(total, data.currency)}) is more than is left to credit on invoice ${data.creditFor} (${money(left, data.currency)}). Lower the amounts or remove lines.`);
    return false;
  }
  return true;
}

// Briefly relabels a button and announces the result to screen readers. Not disabled meanwhile:
// disabling a focused button can drop keyboard focus.
function showDone(btn, label, message) {
  btn.dataset.label ||= btn.textContent;
  btn.textContent = label;
  document.getElementById('saveStatus').textContent = message;
  clearTimeout(btn.resetTimer);
  btn.resetTimer = setTimeout(() => { btn.textContent = btn.dataset.label; }, 2000);
}

deleteInvoiceBtn.addEventListener('click', () => {
  const num = openInvoice;
  if (!num) return;
  const list = getSavedList();
  const credits = Object.keys(list).filter(n => list[n].docType === 'credit' && list[n].creditFor === num);
  // Credit notes are tax documents in their own right, so they're kept — but say so.
  const creditWarning = credits.length && list[num].docType !== 'credit'
    ? ` Its credit note${credits.length === 1 ? '' : 's'} (${credits.join(', ')}) will stay saved, pointing at a deleted invoice.` : '';
  if (!confirm(`Delete ${num} from your saved invoices? This can’t be undone. It stays on screen until you start a new invoice.${creditWarning}`)) return;
  delete list[num];
  store(LIST_KEY, JSON.stringify(list));
  setOpenInvoice('');
  refreshInvoiceList();
});

// --- Backup (localStorage is wiped with browser data, so let people keep a file) ---
document.getElementById('exportBtn').addEventListener('click', () => {
  const backup = { invoices: getSavedList(), logo: load(LOGO_KEY) };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: 'application/json' }));
  a.download = `invoices-backup-${localISODate(new Date())}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// Zoho Books invoice import: exactly the invoices the ledger lists right now (search + status filter).
document.getElementById('zohoBtn').addEventListener('click', () => {
  const list = getSavedList();
  const today = localISODate(new Date());
  const numbers = Object.keys(list).sort().reverse()
    .filter(num => ledgerMatches(list, num, today, ledgerSearch.value, ledgerFilterEl.value))
    .filter(num => (list[num].docType || 'invoice') === 'invoice');
  if (!numbers.length) { alert('There are no invoices in the list to export. Quotes and credit notes aren’t included; check the search and filter.'); return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([toCSV(zohoInvoiceRows(list, numbers))], { type: 'text/csv;charset=utf-8' }));
  a.download = `zoho-invoices-${today}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  document.getElementById('zohoHelp').hidden = false;
});
document.getElementById('zohoHelpClose').addEventListener('click', () => { document.getElementById('zohoHelp').hidden = true; });

const importInput = document.getElementById('importInput');
document.getElementById('importBtn').addEventListener('click', () => importInput.click());
importInput.addEventListener('change', async () => {
  const file = importInput.files[0];
  importInput.value = '';
  if (!file) return;
  const backup = safeParse(await file.text(), null);
  if (!backup || !backup.invoices || typeof backup.invoices !== 'object') { alert('That file isn’t an invoice backup. Choose a .json file made with Export backup.'); return; }
  const count = Object.keys(backup.invoices).length;
  const invoices = `${count} invoice${count === 1 ? '' : 's'}`;
  if (!confirm(`Import ${invoices} from this backup? Saved invoices with the same numbers will be replaced.`)) return;
  if (!store(LIST_KEY, JSON.stringify({ ...getSavedList(), ...backup.invoices }))) { alert('Couldn’t import — this browser’s storage is full. Delete some saved invoices and try again.'); return; }
  if (backup.logo && !load(LOGO_KEY)) setLogo(backup.logo);
  recalc(); // imported credit notes may be against the open invoice
  refreshInvoiceList();
  showDone(document.getElementById('importBtn'), `Imported ${invoices}`, `Imported ${invoices}`);
});
// Paid is bookkeeping, not an edit — update the saved copy straight away so it doesn't need a re-save.
document.getElementById('paid').addEventListener('change', (e) => {
  recalc();
  save();
  const stamp = document.getElementById('stamp');
  stamp.classList.remove('thunk');
  if (e.target.checked) { void stamp.offsetWidth; stamp.classList.add('thunk'); } // restart the animation
  // The saved invoice that's open, not the number typed on screen — an unsaved draft can share a saved one's number.
  updateOpenSaved({ paid: e.target.checked });
});

// Patches the saved invoice that's open (never one found by the typed number) and refreshes the ledger.
function updateOpenSaved(patch) {
  const list = getSavedList();
  if (!list[openInvoice]) return;
  Object.assign(list[openInvoice], patch);
  store(LIST_KEY, JSON.stringify(list));
  refreshInvoiceList();
}

// Accepted / Declined is bookkeeping too, so it updates the open saved quote straight away.
document.getElementById('quoteStatus').addEventListener('change', (e) => {
  recalc();
  save();
  updateOpenSaved({ quoteStatus: e.target.value });
});

// --- Part payments (invoices only; the list is screen-only, the Paid / Balance due rows print) ---
let payments = [];
const payDate = document.getElementById('payDate');
const payAmount = document.getElementById('payAmount');
const payNote = document.getElementById('payNote');
const paymentMsg = document.getElementById('paymentMsg');

// `noPayments`: quotes and credit notes. `credited`: saved credit notes against this invoice.
function showPayments(total, noPayments, credited = 0) {
  const received = noPayments ? 0 : paymentsTotal(payments);
  const fullyPaid = document.getElementById('paid').checked;
  document.getElementById('paidRow').hidden = !received;
  document.getElementById('creditedRow').hidden = !credited;
  document.getElementById('balanceRow').hidden = !received && !credited;
  document.getElementById('paidAmount').textContent = money(-received);
  document.getElementById('creditedAmount').textContent = money(-credited);
  // Ticking "Paid" settles the invoice outright, so it shouldn't print a balance as well.
  const balance = fullyPaid ? 0 : balanceDue(total, received ? payments : [], credited);
  document.getElementById('balanceAmount').textContent = money(balance);
  return balance;
}

function renderPayments() {
  document.getElementById('paymentList').replaceChildren(...payments.map((p, i) => {
    const li = document.createElement('li');
    const text = document.createElement('span');
    // textContent: payment data may come from an imported file.
    text.textContent = [p.date ? shortDate(p.date) : '', p.note || '', money(parseFloat(p.amount) || 0)].filter(Boolean).join(' · ');
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'del-row';
    del.textContent = '×';
    const label = `Remove payment of ${money(parseFloat(p.amount) || 0)}${p.note ? ' (' + p.note + ')' : ''}`;
    del.setAttribute('aria-label', label);
    del.title = 'Remove payment';
    del.addEventListener('click', () => {
      payments.splice(i, 1);
      paymentsChanged();
      payAmount.focus(); // the pressed button is gone
    });
    li.append(text, del);
    return li;
  }));
}

function paymentsChanged() {
  renderPayments();
  recalc();
  save();
  updateOpenSaved({ payments: payments.map(p => ({ ...p })) });
}

function addPayment() {
  const amount = parseFloat(payAmount.value);
  if (!(amount > 0)) {
    paymentMsg.textContent = 'Enter the amount received.';
    payAmount.focus();
    return;
  }
  paymentMsg.textContent = '';
  payments.push({ date: payDate.value || localISODate(new Date()), amount: String(amount), note: payNote.value.trim() });
  payAmount.value = '';
  payNote.value = '';
  paymentsChanged();
  payAmount.focus();
}
document.getElementById('addPaymentBtn').addEventListener('click', addPayment);
[payAmount, payNote, payDate].forEach(el => el.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); addPayment(); }
}));
payDate.value = localISODate(new Date());
// Every edit on the sheet (fields, line items, checkboxes, selects) bubbles up here.
document.getElementById('sheet').addEventListener('input', () => { recalc(); save(); });

// --- Logo upload ---
const LOGO_KEY = 'invoice-logo';
const logoDrop = document.getElementById('logoDrop');
const logoInput = document.getElementById('logoInput');
const logoPreview = document.getElementById('logoPreview');
const logoRemove = document.getElementById('logoRemove');

function setLogo(dataUrl) {
  if (!dataUrl) { try { localStorage.removeItem(LOGO_KEY); } catch {} }
  else if (!store(LOGO_KEY, dataUrl)) { alert('Couldn’t add the logo — not enough browser storage. Try a smaller image (under 200 KB works best).'); return; }
  logoPreview.src = dataUrl || '';
  logoPreview.hidden = logoRemove.hidden = !dataUrl;
  logoDrop.classList.toggle('has-logo', !!dataUrl);
  logoDrop.setAttribute('aria-label', dataUrl ? 'Change logo' : 'Upload logo');
}

function loadLogoFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) { alert('That file isn’t an image. Use a PNG, JPG or SVG.'); return; }
  if (file.size > 2 * 1024 * 1024) { alert('That image is over 2 MB. Use a smaller PNG or JPG.'); return; }
  const reader = new FileReader();
  reader.onload = () => setLogo(reader.result);
  reader.readAsDataURL(file);
}

logoDrop.addEventListener('click', () => logoInput.click());
logoDrop.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); logoInput.click(); }
});
logoInput.addEventListener('change', () => loadLogoFile(logoInput.files[0]));
logoRemove.addEventListener('click', () => setLogo(null));
['dragover', 'dragenter'].forEach(evt =>
  logoDrop.addEventListener(evt, (e) => { e.preventDefault(); logoDrop.classList.add('drag-over'); })
);
['dragleave', 'drop'].forEach(evt =>
  logoDrop.addEventListener(evt, (e) => { e.preventDefault(); logoDrop.classList.remove('drag-over'); })
);
logoDrop.addEventListener('drop', (e) => loadLogoFile(e.dataTransfer.files[0]));

const draft = safeParse(load(STORAGE_KEY), null);
if (draft) applyData(draft);
if (!invDateInput.value) invDateInput.value = localISODate(new Date());
if (!draft) {
  addItem();
  applyDueDate();
}
const savedLogo = load(LOGO_KEY);
if (savedLogo) setLogo(savedLogo);
// Phones: ledger starts folded so the invoice is the first thing on screen.
const narrowScreen = matchMedia('(max-width: 900px)');
if (narrowScreen.matches) ledger.open = false;
refreshInvoiceList();
recalc();

// Offline + installable. Service workers need http(s), so opening index.html as a file skips this.
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js');

const STORAGE_KEY = 'invoice-draft';

const itemsBody = document.getElementById('itemsBody');
const fields = ['fromName','fromDetails','toName','toDetails','toEmail','invNumber','invDate','dueDate','notes','vatToggle','vatRate','currency','terms','paid','docType'];

const isQuote = () => document.getElementById('docType').value === 'quote';
const docName = () => (isQuote() ? 'quote' : 'invoice');

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

function addItem(data = { desc: '', qty: 1, price: 0 }, focus = false) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td class="col-desc"><textarea class="item-desc" placeholder="Description" aria-label="Description" rows="1"></textarea></td>
    <td class="col-qty"><input class="item-qty" type="number" min="0" step="1" aria-label="Quantity"></td>
    <td class="col-price"><input class="item-price" type="number" step="0.01" aria-label="Unit price" title="Use a negative price for a discount"></td>
    <td class="col-total row-total">R 0.00</td>
    <td class="col-del no-print"><button type="button" class="del-row" aria-label="Remove line" title="Remove line">&times;</button></td>
  `;
  const desc = tr.querySelector('.item-desc');
  desc.value = data.desc;
  tr.querySelector('.item-qty').value = data.qty;
  tr.querySelector('.item-price').value = data.price;
  itemsBody.appendChild(tr);
  autosize(desc);

  tr.querySelector('.del-row').addEventListener('click', () => { tr.remove(); recalc(); save(); });
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

function recalc() {
  const rows = [...itemsBody.querySelectorAll('tr')];
  const items = rows.map(tr => ({ qty: tr.querySelector('.item-qty').value, price: tr.querySelector('.item-price').value }));
  const vatOn = document.getElementById('vatToggle').checked;
  const vatRate = vatOn ? parseFloat(document.getElementById('vatRate').value) || 0 : 0;
  const t = invoiceTotals(items, vatRate);
  rows.forEach((tr, i) => { tr.querySelector('.row-total').textContent = money(t.lineTotals[i]); });
  document.getElementById('subtotal').textContent = money(t.subtotal);
  document.getElementById('vatAmount').textContent = money(t.vat);
  document.getElementById('grandTotal').textContent = money(t.total);
  const quote = isQuote();
  document.body.dataset.doc = docName();
  // SARS: a VAT-charging invoice must be headed "Tax Invoice". A quote isn't a tax document.
  document.querySelector('.doc-title').textContent = quote ? 'QUOTE' : vatOn ? 'TAX INVOICE' : 'INVOICE';
  document.querySelector('label[for=invNumber]').textContent = quote ? 'Quote #' : 'Invoice #';
  document.querySelector('label[for=dueDate]').textContent = quote ? 'Valid until' : 'Due date';
  document.getElementById('totalLabel').textContent = quote ? 'Total' : 'Total due';
  document.getElementById('newInvoiceBtn').textContent = `New ${docName()}`;
  updateStamp();
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
    price: tr.querySelector('.item-price').value,
  }));
  return data;
}

function applyData(data) {
  data = { docType: 'invoice', ...data }; // saves from before quotes existed
  fields.forEach(id => {
    const el = document.getElementById(id);
    // Missing checkbox = unchecked, so older saves without `paid` don't inherit the previous invoice's tick.
    if (el.type === 'checkbox') el.checked = !!data[id];
    else if (id in data) el.value = data[id];
  });
  itemsBody.innerHTML = '';
  (data.items || []).forEach(item => addItem(item));
  recalc();
}

// localStorage throws when full (e.g. big logo + many saved invoices) — don't let that break the app.
function store(key, value) {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}

function save() {
  store(STORAGE_KEY, JSON.stringify(collectData()));
}

// PAID / OVERDUE stamp on the paper, from the form as it stands (not just saved invoices).
function updateStamp() {
  const stamp = document.getElementById('stamp');
  const status = invoiceStatus({
    docType: docName(),
    paid: document.getElementById('paid').checked,
    dueDate: document.getElementById('dueDate').value,
  }, localISODate(new Date()));
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
  const due = document.getElementById('dueDate').value;

  const subject = `${doc === 'quote' ? 'Quote' : 'Invoice'} ${num} from ${business}`;
  const body = [
    `Hi ${client || 'there'},`,
    '',
    `Please find attached ${doc} ${num} for ${total}${due ? `, ${doc === 'quote' ? 'valid until' : 'due'} ${due}` : ''}.`,
    '',
    'Kind regards,',
    business,
  ].join('\n');

  window.location.href = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
});

// --- PDF filename (browser print/save-as-PDF uses the document title) ---
const APP_TITLE = document.title;
document.getElementById('printBtn').addEventListener('click', () => {
  const num = document.getElementById('invNumber').value.trim() || docName();
  const client = document.getElementById('toName').value.trim();
  document.title = `${isQuote() ? 'Quote' : 'Invoice'} ${num}${client ? ' - ' + client : ''}`;
  window.print();
});
window.addEventListener('afterprint', () => { document.title = APP_TITLE; });

// Keeps business details, notes, logo and settings; clears the client and lines, bumps the number.
document.getElementById('newInvoiceBtn').addEventListener('click', () => {
  if (!confirm(`Start a new ${docName()}? Anything not saved on this one will be cleared. Your business details, notes and logo stay.`)) return;
  const data = collectData();
  applyData({
    ...data,
    invNumber: nextInvoiceNumber(data.invNumber.trim()),
    invDate: localISODate(new Date()),
    dueDate: '',
    toName: '', toDetails: '', toEmail: '', paid: false,
    items: [{ desc: '', qty: 1, price: 0 }],
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

// Invoices: due date from payment terms. Quotes: valid for 30 days.
function applyDueDate() {
  const days = isQuote() ? 30 : termsSelect.value;
  if (days === 'custom') return;
  dueDateInput.value = addDays(invDateInput.value || localISODate(new Date()), days);
}
// 'input' (not 'change') so these run before the sheet-wide listener below recalcs and saves.
termsSelect.addEventListener('input', applyDueDate);
invDateInput.addEventListener('input', applyDueDate);

// --- Quotes ---
// Switching type makes it a new, unsaved document numbered in its own sequence (QUO-… / INV-…).
function switchDocType(type) {
  const list = getSavedList();
  const sameType = Object.keys(list).filter(num => (list[num].docType || 'invoice') === type);
  document.getElementById('docType').value = type;
  document.getElementById('invNumber').value = nextNumberAfter(sameType, type === 'quote' ? 'QUO-0001' : 'INV-0001');
  document.getElementById('paid').checked = false;
  applyDueDate();
  setOpenInvoice('');
  recalc();
  save();
  refreshInvoiceList();
}
document.getElementById('docType').addEventListener('input', (e) => switchDocType(e.target.value));

// Same client, lines and notes; dated today, with the next invoice number and due date from the terms.
document.getElementById('convertBtn').addEventListener('click', () => {
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
let openInvoice = localStorage.getItem(OPEN_KEY) || '';
function setOpenInvoice(num) {
  openInvoice = num;
  store(OPEN_KEY, num);
}

function getSavedList() {
  return safeParse(localStorage.getItem(LIST_KEY), {});
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

function refreshInvoiceList() {
  const list = getSavedList();
  const today = localISODate(new Date());
  const numbers = Object.keys(list).sort().reverse();
  document.getElementById('invoiceCount').textContent = numbers.length || '';
  refreshClients(list, numbers);
  document.getElementById('ledgerEmpty').hidden = numbers.length > 0;
  invoiceListEl.replaceChildren(...numbers.map(num => {
    const inv = list[num];
    const status = invoiceStatus(inv, today);
    const { total } = invoiceTotals(inv.items || [], inv.vatToggle ? parseFloat(inv.vatRate) || 0 : 0);
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'ledger-row';
    row.dataset.status = status.toLowerCase();
    if (num === openInvoice) row.setAttribute('aria-current', 'true');
    // textContent, not innerHTML: invoice data may come from an imported file.
    [[num, 'num'], [money(total, inv.currency), 'amount'], [inv.toName || 'No client', 'client'],
     [status || dueNote(inv), 'status']].forEach(([text, cls]) => {
      const span = document.createElement('span');
      span.className = `ledger-${cls}`;
      span.textContent = text;
      row.append(span);
    });
    row.addEventListener('click', () => {
      applyData(inv);
      setOpenInvoice(num);
      save();
      refreshInvoiceList();
      if (narrowScreen.matches) ledger.open = false;
    });
    const li = document.createElement('li');
    li.append(row);
    return li;
  }));
  deleteInvoiceBtn.hidden = !list[openInvoice];
}

document.getElementById('saveInvoiceBtn').addEventListener('click', () => {
  const data = collectData();
  const num = data.invNumber.trim();
  if (!num) { alert('Add an invoice number before saving.'); return; }
  const list = getSavedList();
  // Re-saving the invoice you opened is fine; reusing another invoice's number would silently replace it.
  if (list[num] && openInvoice !== num &&
      !confirm(`${num}${list[num].toName ? ` (${list[num].toName})` : ''} is already saved. Replace it with this invoice? To keep both, press Cancel and change the invoice number.`)) return;
  list[num] = data;
  if (!store(LIST_KEY, JSON.stringify(list))) { alert('Couldn’t save — this browser’s storage is full. Export a backup, then delete old invoices to make room.'); return; }
  setOpenInvoice(num);
  refreshInvoiceList();
  showDone(document.getElementById('saveInvoiceBtn'), 'Saved', `${isQuote() ? 'Quote' : 'Invoice'} ${num} saved`);
});

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
  if (!num || !confirm(`Delete ${num} from your saved invoices? This can’t be undone. It stays on screen until you start a new invoice.`)) return;
  const list = getSavedList();
  delete list[num];
  store(LIST_KEY, JSON.stringify(list));
  setOpenInvoice('');
  refreshInvoiceList();
});

// --- Backup (localStorage is wiped with browser data, so let people keep a file) ---
document.getElementById('exportBtn').addEventListener('click', () => {
  const backup = { invoices: getSavedList(), logo: localStorage.getItem(LOGO_KEY) };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: 'application/json' }));
  a.download = `invoices-backup-${localISODate(new Date())}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

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
  if (backup.logo && !localStorage.getItem(LOGO_KEY)) setLogo(backup.logo);
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
  const list = getSavedList();
  const num = document.getElementById('invNumber').value.trim();
  if (!list[num]) return;
  list[num].paid = e.target.checked;
  store(LIST_KEY, JSON.stringify(list));
  refreshInvoiceList();
});
// Every edit on the sheet (fields, line items, checkboxes, selects) bubbles up here.
document.getElementById('sheet').addEventListener('input', () => { recalc(); save(); });

// --- Logo upload ---
const LOGO_KEY = 'invoice-logo';
const logoDrop = document.getElementById('logoDrop');
const logoInput = document.getElementById('logoInput');
const logoPreview = document.getElementById('logoPreview');
const logoRemove = document.getElementById('logoRemove');

function setLogo(dataUrl) {
  if (!dataUrl) localStorage.removeItem(LOGO_KEY);
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

const draft = safeParse(localStorage.getItem(STORAGE_KEY), null);
if (draft) applyData(draft);
if (!invDateInput.value) invDateInput.value = localISODate(new Date());
if (!draft) {
  addItem();
  applyDueDate();
}
const savedLogo = localStorage.getItem(LOGO_KEY);
if (savedLogo) setLogo(savedLogo);
// Phones: ledger starts folded so the invoice is the first thing on screen.
const narrowScreen = matchMedia('(max-width: 900px)');
if (narrowScreen.matches) ledger.open = false;
refreshInvoiceList();
recalc();

// Offline + installable. Service workers need http(s), so opening index.html as a file skips this.
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js');

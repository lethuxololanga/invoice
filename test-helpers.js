// Boots index.html + lib.js + app.js in jsdom for browser-level tests. Not loaded by the app.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const html = read('index.html').replace(/<script[\s\S]*?<\/script>/g, '');

// seed: localStorage entries set before the app starts. confirm: answer for confirm() dialogs.
function boot({ seed = {}, blockStorage = false, confirm = true, narrow = false } = {}) {
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only' });
  const w = dom.window;
  w.matchMedia = () => ({ matches: narrow, addEventListener() {} });
  w.alerts = [];
  w.alert = msg => w.alerts.push(msg);
  w.confirm = () => confirm;
  w.print = () => {};
  for (const [k, v] of Object.entries(seed)) w.localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
  if (blockStorage) {
    Object.defineProperty(w, 'localStorage', {
      get() { throw new w.DOMException('The operation is insecure.', 'SecurityError'); },
    });
  }
  w.eval(read('lib.js'));
  w.eval(read('vendor/qrcode.js'));
  w.eval(read('app.js'));
  const d = w.document;
  const $ = sel => d.querySelector(sel);
  // Set a field's value and fire the events a real edit would.
  const type = (el, value) => {
    if (typeof el === 'string') el = $(el);
    if (el.type === 'checkbox') el.checked = value; else el.value = value;
    el.dispatchEvent(new w.Event('input', { bubbles: true }));
    el.dispatchEvent(new w.Event('change', { bubbles: true }));
  };
  const saved = () => JSON.parse(w.localStorage.getItem('invoice-list') || '{}');
  return { w, d, $, type, saved };
}

// A saved-invoice record as the app stores it.
function inv(num, extra = {}) {
  return { invNumber: num, docType: 'invoice', toName: 'Client', paid: false, vatToggle: false, vatRate: '15',
    currency: 'ZAR', items: [{ desc: 'Work', qty: '1', price: '100' }], ...extra };
}

module.exports = { boot, inv };

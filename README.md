# Invoice Generator

Make invoices, quotes and credit notes in the browser. Built for South African freelancers. No account, no server: everything stays in your browser's storage, and it works offline once installed.

- VAT (inclusive or exclusive, zero-rated and exempt lines); prints "TAX INVOICE" when VAT is charged
- Discounts, units, part payments, balance due, credit notes
- Saved documents with search, filters, outstanding/overdue totals and monthly repeats
- EFT details, an online payment link and a QR code on the printed invoice
- Download PDF via the browser's print dialog
- Export a CSV for Zoho Books' invoice import, and back up or restore everything as JSON

Clearing your browser data deletes saved invoices, so use **Export backup** now and then.

## Run

Open `index.html` in a browser. To install it as an app and use it offline, serve the folder over http(s), for example `npx serve .`.

## Test

```
npm install
npm test
```

The app itself has no dependencies. jsdom is only used by the tests. `vendor/qrcode.js` is [qrcode-generator](https://www.npmjs.com/package/qrcode-generator) 1.4.4 (MIT).

Made by [EasyStudio](https://www.easystudio.co.za).

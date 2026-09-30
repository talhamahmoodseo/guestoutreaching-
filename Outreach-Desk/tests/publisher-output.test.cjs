const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '../extension');
const appsScriptSource = fs.readFileSync(path.join(__dirname, '../sheets-apps-script/Code.gs'), 'utf8');
const secret = 'fixture-secret-123';
const config = { endpoint: 'https://script.google.com/macros/s/deployment_id-123/exec', secret };
function loadOutput() { const ctx = vm.createContext({ URL, TextEncoder, AbortController, setTimeout, clearTimeout, console }); vm.runInContext(fs.readFileSync(path.join(root, 'publisher-connections.js'), 'utf8'), ctx); vm.runInContext(fs.readFileSync(path.join(root, 'publisher-output.js'), 'utf8'), ctx); return ctx.PublisherOutput; }
const lead = (extra = {}) => ({ id: 'lead-1', campaignId: 'c1', campaignName: 'Fall outreach', niche: 'Education', domain: 'example.com', website: 'https://www.example.com/', bucket: 'ready', bestEmail: 'editor@example.com', language: 'en', da: 44, dr: 51, spam: 3, age: 150, collectedAt: '2026-09-02T09:00:00Z',
  emails: [{ email: 'editor@example.com', suitability: 'recommended' }, { email: 'ads@example.com', suitability: 'fallback' }, { email: 'noreply@example.com', suitability: 'excluded' }],
  contactPages: ['https://example.com/contact'], opportunities: [{ decision: 'qualified', url: 'https://example.com/write-for-us' }], forms: [], ...extra });
const plain = v => JSON.parse(JSON.stringify(v));

test('config needs the deployed /exec URL; the secret is optional', () => {
  const api = loadOutput();
  assert.deepEqual(plain(api.validateConfig(config)), config);
  assert.equal(api.validateConfig({ endpoint: config.endpoint }).secret, '');
  assert.throws(() => api.validateConfig({ endpoint: 'https://script.google.com/macros/s/id/dev' }), /exec/);
  assert.throws(() => api.validateConfig({ ...config, secret: 'short' }), /8-256/);
});

test('record contains only clean outreach columns', () => {
  const row = plain(loadOutput().record(lead()));
  assert.deepEqual(Object.keys(row), ['date', 'campaign', 'domain', 'website', 'bestEmail', 'emails', 'contactPages', 'language', 'da', 'dr', 'spam', 'domainAge']);
  assert.equal(row.date, '2026-09-02'); assert.equal(row.campaign, 'Fall outreach'); assert.equal(row.domain, 'example.com');
  assert.equal(row.emails, 'editor@example.com, ads@example.com'); assert.equal(row.contactPages, 'https://example.com/contact\nhttps://example.com/write-for-us');
  assert.equal(row.language, 'English'); assert.equal(row.domainAge, '12y 6m'); assert.equal(row.spam, 3);
  assert.equal(loadOutput().record(lead({ bucket: 'rejected' })).bestEmail, '');
});

test('send posts text/plain JSON and checks the confirmed row count', async () => {
  let sent;
  const ack = await loadOutput().send(config, 'upsert', [lead()], async (url, options) => { sent = { url, options }; return { ok: true, text: async () => JSON.stringify({ ok: true, accepted: 1 }) }; });
  assert.equal(ack.accepted, 1); assert.equal(sent.options.headers['Content-Type'], 'text/plain;charset=utf-8'); assert.equal(sent.options.credentials, 'omit');
  assert.equal(JSON.parse(sent.options.body).records[0].domain, 'example.com');
  await assert.rejects(loadOutput().send(config, 'upsert', [lead()], async () => ({ ok: true, text: async () => JSON.stringify({ ok: true, accepted: 0 }) })), /different number/);
});

class FakeRange {
  constructor(sheet, row, col, rows, cols) { Object.assign(this, { sheet, row, col, rows, cols }); }
  getValues() { return Array.from({ length: this.rows }, (_, r) => Array.from({ length: this.cols }, (_, c) => this.sheet.rows[this.row - 1 + r]?.[this.col - 1 + c] ?? '')); }
  getDisplayValues() { return this.getValues().map(row => row.map(value => String(value))); }
  setValues(values) {
    values.forEach((source, r) => {
      const targetRow = this.row - 1 + r;
      while (this.sheet.rows.length <= targetRow) this.sheet.rows.push([]);
      for (let c = 0; c < this.cols; c++) this.sheet.rows[targetRow][this.col - 1 + c] = source[c];
    });
    return this;
  }
  setBackground() { return this; } setFontColor() { return this; } setFontWeight() { return this; }
  setWrap() { return this; } setDataValidation() { return this; }
  clearContent() { for (let r = 0; r < this.rows; r++) { const row = this.sheet.rows[this.row - 1 + r]; if (row) for (let c = 0; c < this.cols; c++) row[this.col - 1 + c] = ''; } return this; } createFilter() { this.sheet.filter = { remove: () => { this.sheet.filter = null; } }; return this.sheet.filter; }
}
class FakeSheet {
  constructor(name) { this.name = name; this.rows = []; this.maxRows = 100; this.filter = null; this.widths = {}; }
  getLastRow() { for (let i = this.rows.length - 1; i >= 0; i--) if (this.rows[i].some(value => value !== '' && value !== undefined)) return i + 1; return 0; }
  getLastColumn() { return Math.max(0, ...this.rows.map(row => row.reduce((last, value, index) => value !== '' && value !== undefined ? index + 1 : last, 0))); }
  getRange(row, col, rows, cols) { return new FakeRange(this, row, col, rows, cols); }
  setFrozenRows() {} setColumnWidth(col, width) { this.widths[col] = width; }
  getMaxRows() { return this.maxRows; }
  insertRowsAfter(after, count) { this.maxRows += count; }
  deleteRow(row) { this.rows.splice(row - 1, 1); this.maxRows -= 1; }
  getFilter() { return this.filter; }
  getName() { return this.name; }
}
class FakeSpreadsheet {
  constructor() { this.sheets = new Map(); }
  getSheetByName(name) { return this.sheets.get(name) || null; }
  insertSheet(name) { const sheet = new FakeSheet(name); this.sheets.set(name, sheet); return sheet; }
  getSheets() { return [...this.sheets.values()]; }
}
function loadAppsScript(options = {}) {
  const spreadsheet = new FakeSpreadsheet();
  const property = options.secret === undefined ? secret : options.secret;
  const context = vm.createContext({
    Date, Utilities: { newBlob: value => ({ getBytes: () => new TextEncoder().encode(value) }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => key === 'OUTREACH_DESK_BEARER_SECRET' ? property : '' }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => options.standalone ? null : spreadsheet,
      newDataValidation: () => ({ requireValueInList() { return this; }, setAllowInvalid() { return this; }, build() { return {}; } })
    },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }) },
    GmailApp: options.gmail,
    ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: text => ({ text, setMimeType() { return this; } }) }
  });
  vm.runInContext(appsScriptSource, context);
  return { context, spreadsheet, post: payload => JSON.parse(context.doPost({ postData: { contents: JSON.stringify(payload) } }).text) };
}


function loadAppsScript(options = {}) {
  const spreadsheet = new FakeSpreadsheet();
  const property = options.secret === undefined ? secret : options.secret;
  const context = vm.createContext({
    Date, Utilities: { newBlob: value => ({ getBytes: () => new TextEncoder().encode(value) }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => key === 'OUTREACH_DESK_BEARER_SECRET' ? property : '' }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => options.standalone ? null : spreadsheet, newDataValidation: () => ({ requireValueInList() { return this; }, setAllowInvalid() { return this; }, build() { return {}; } }) },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }) }, GmailApp: options.gmail,
    ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: text => ({ text, setMimeType() { return this; } }) }
  });
  vm.runInContext(appsScriptSource, context);
  return { context, spreadsheet, post: payload => JSON.parse(context.doPost({ postData: { contents: JSON.stringify(payload) } }).text) };
}
const cell = (sheet, row, header) => sheet.rows[row - 1][sheet.rows[0].indexOf(header)];

test('Apps Script writes a clean Outreach tab, updates by domain + campaign and keeps your status and notes', () => {
  const backend = loadAppsScript(), row = plain(loadOutput().record(lead({ campaignName: '=HYPERLINK("x")' })));
  let ack = backend.post({ secret, action: 'upsert', records: [row] });
  assert.equal(ack.ok, true); assert.equal(ack.added, 1);
  const sheet = backend.spreadsheet.getSheetByName('Outreach');
  assert.deepEqual(sheet.rows[0], ['Date', 'Campaign', 'Domain', 'Website', 'Best Email', 'All Emails', 'Contact Page', 'Language', 'DA', 'DR', 'Spam Score', 'Domain Age', 'Outreach Status', 'Notes']);
  assert.equal(cell(sheet, 2, 'Campaign'), `'=HYPERLINK("x")`, 'formulas are escaped');
  assert.equal(cell(sheet, 2, 'Spam Score'), '3%'); assert.equal(cell(sheet, 2, 'Outreach Status'), 'Not started');
  sheet.rows[1][sheet.rows[0].indexOf('Outreach Status')] = 'Contacted'; sheet.rows[1][sheet.rows[0].indexOf('Notes')] = 'Replied';
  ack = backend.post({ secret, action: 'upsert', records: [{ ...row, dr: 60, da: null }] });
  assert.equal(ack.updated, 1); assert.equal(sheet.getLastRow(), 2);
  assert.equal(cell(sheet, 2, 'DR'), 60); assert.equal(cell(sheet, 2, 'DA'), 44, 'a missing value keeps the old one');
  assert.equal(cell(sheet, 2, 'Outreach Status'), 'Contacted'); assert.equal(cell(sheet, 2, 'Notes'), 'Replied');
  backend.post({ secret, action: 'upsert', records: [{ ...row, campaign: 'Other campaign' }] });
  assert.equal(sheet.getLastRow(), 3, 'same domain in another campaign is its own row');
});

test('Apps Script ping, secret, history tabs and errors', () => {
  const backend = loadAppsScript();
  const pong = backend.post({ secret, action: 'ping', records: [] });
  assert.equal(pong.message, 'pong'); assert.equal(pong.sheet, true); assert.equal(pong.account, 'owner@example.com');
  assert.match(backend.post({ secret: 'wrong', action: 'ping' }).error, /Wrong secret/);
  assert.match(backend.post({ secret, action: 'delete' }).error, /Unsupported action/);
  assert.match(backend.post({ secret, action: 'upsert', records: [{ domain: 'bad' }] }).error, /no valid domain/);
  assert.match(backend.post({ secret, action: 'upsert', records: Array.from({ length: 101 }, () => ({})) }).error, /between 1 and 100/);
  assert.match(JSON.parse(backend.context.doPost({ postData: { contents: ' '.repeat(512 * 1024 + 1) } }).text).error, /too large/);
  const open = loadAppsScript({ secret: '' });
  open.post({ action: 'upsert', records: [plain(loadOutput().record(lead()))] });
  const old = open.spreadsheet.insertSheet('Old outreach 2025'); old.rows = [['Website', 'Email'], ['https://oldsite.com', 'editor@oldsite.com']];
  const history = open.post({ action: 'history' });
  assert.equal(history.tabs.find(t => t.name === 'Old outreach 2025').history, true);
  assert.equal(history.tabs.find(t => t.name === 'Outreach').history, false);
});

test('sent-mail check matches the exact domain and returns only date and address', () => {
  const message = (to, date) => ({ getTo: () => to, getCc: () => '', getBcc: () => '', getDate: () => new Date(date) });
  const gmail = { search: q => q.includes('site.com') && !q.includes('notsite') ? [{ getMessages: () => [message('Editor <john@site.com>', '2026-03-01'), message('x@notsite.com', '2025-01-01')] }] : [] };
  const backend = loadAppsScript({ secret: '', standalone: true, gmail });
  const result = backend.post({ action: 'sent', domains: ['site.com', 'fresh.com'], emails: ['writer@gmail.com'] });
  assert.deepEqual(result.results.domains['site.com'], { sent: true, date: '2026-03-01T00:00:00.000Z', to: 'john@site.com' });
  assert.deepEqual(result.results.domains['fresh.com'], { sent: false });
  assert.match(backend.post({ action: 'upsert', records: [plain(loadOutput().record(lead()))] }).error, /not attached to a Sheet/);
});

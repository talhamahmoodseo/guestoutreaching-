/**
 * Outreach Desk companion script (v2). One file, three jobs:
 *   1. Output Sheet: writes campaign results into the Useful / Rejected tabs.
 *   2. History: sends the Sheet's outreach history back so contacted domains are skipped.
 *   3. Sent mail: answers "have I emailed this domain before?" from this account's Gmail.
 * Paste it into a Sheet (Extensions > Apps Script) for all three, or into a standalone
 * project at script.google.com for sent-mail checks only (extra Gmail accounts).
 * Only yes/no, a date and the matched address are returned for sent-mail checks.
 */

// Optional. The /exec URL is already a long private address. If you ever share the URL,
// put a secret here (8+ characters) and paste the same secret in the extension.
const SECRET = '';

const OUTPUT_VERSION = 3;
const OUTPUT_MAX_BODY_BYTES = 512 * 1024;
const OUTPUT_MAX_RECORDS = 100;
const OUTPUT_TAB = 'Outreach';
const OUTPUT_HEADERS = ['Date', 'Campaign', 'Domain', 'Website', 'Best Email', 'All Emails', 'Contact Page', 'Language', 'DA', 'DR', 'Spam Score', 'Domain Age', 'Outreach Status', 'Notes'];
const OUTPUT_STATUS_VALUES = ['Not started', 'Contacted', 'Follow-up', 'Responded', 'Negotiating', 'Agreed', 'Declined', 'Do not contact'];
// Tabs whose rows count as history only when their Outreach Status says so. Every other tab is history.
const RESULT_TABS = ['Outreach', 'Useful', 'Rejected'];

/** Optional: run once from the editor to create the Outreach tab before the first send. */
function initializeOutputWorkbook() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error('Open this script from the output workbook.');
  ensureOutputSheet(spreadsheet);
  return 'Outreach tab is ready.';
}

/** Opening the /exec URL in a browser shows whether the deployment works. */
function doGet() {
  return outputJson({ ok: true, app: 'Outreach Desk', version: OUTPUT_VERSION, sheet: !!activeSpreadsheet(), message: 'Deployment works. Paste this URL into Outreach Desk.' });
}

function doPost(e) {
  try {
    const raw = e && e.postData && e.postData.contents;
    if (typeof raw !== 'string' || !raw) throw new Error('Request body is missing.');
    if (raw.length > OUTPUT_MAX_BODY_BYTES || Utilities.newBlob(raw).getBytes().length > OUTPUT_MAX_BODY_BYTES) {
      throw new Error('Request is too large. Send fewer publisher records.');
    }
    const payload = JSON.parse(raw);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Request must be a JSON object.');
    const expected = configuredSecret();
    if (expected && !constantTimeEquals(String(payload.secret || ''), expected)) {
      throw new Error('Wrong secret. Use the same secret in the script and in Outreach Desk, or clear both.');
    }
    if (payload.action === 'ping') {
      if (payload.records !== undefined && (!Array.isArray(payload.records) || payload.records.length !== 0)) throw new Error('Ping requests must not include records.');
      return outputJson({ ok: true, accepted: 0, message: 'pong', version: OUTPUT_VERSION, sheet: !!activeSpreadsheet(), gmail: typeof GmailApp !== 'undefined', account: accountEmail() });
    }
    if (payload.action === 'sent') return outputJson({ ok: true, results: sentCheck(payload.domains, payload.emails) });
    const spreadsheet = activeSpreadsheet();
    if (payload.action === 'history') {
      return outputJson({ ok: true, tabs: spreadsheet ? readHistory(spreadsheet) : [] });
    }
    if (payload.action !== 'upsert') throw new Error('Unsupported action.');
    if (!spreadsheet) throw new Error('This script is not attached to a Sheet. Use it from Extensions > Apps Script inside your output Sheet.');
    if (!Array.isArray(payload.records) || payload.records.length < 1 || payload.records.length > OUTPUT_MAX_RECORDS) {
      throw new Error('Send between 1 and 100 results.');
    }
    const incoming = payload.records.map(normalizeOutputRecord);
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const outcome = upsertOutputRecords(spreadsheet, incoming);
      return outputJson({ ok: true, accepted: payload.records.length, added: outcome.added, updated: outcome.updated });
    } finally { lock.releaseLock(); }
  } catch (error) {
    return outputJson({ ok: false, accepted: 0, error: safeError(error) });
  }
}

function configuredSecret() {
  if (SECRET) return String(SECRET);
  try { return PropertiesService.getScriptProperties().getProperty('OUTREACH_DESK_BEARER_SECRET') || ''; } catch (_) { return ''; }
}
function activeSpreadsheet() { try { return SpreadsheetApp.getActiveSpreadsheet(); } catch (_) { return null; } }
function accountEmail() { try { return Session.getEffectiveUser().getEmail() || ''; } catch (_) { return ''; } }

/* ---------- Sent-mail history ---------- */

function sentCheck(domains, emails) {
  if (typeof GmailApp === 'undefined') throw new Error('Gmail is not available to this script.');
  const out = { domains: {}, emails: {} };
  (Array.isArray(domains) ? domains : []).slice(0, 25).forEach(function (value) {
    const domain = normalizeOutputDomain(value);
    if (!domain) return;
    out.domains[domain] = searchSent(domain, function (address) { const host = address.split('@')[1] || ''; return host === domain || host.slice(-(domain.length + 1)) === '.' + domain; });
  });
  (Array.isArray(emails) ? emails : []).slice(0, 25).forEach(function (value) {
    const email = safeEmail(value);
    if (!email) return;
    out.emails[email] = searchSent(email, function (address) { return address === email; });
  });
  return out;
}

function searchSent(term, matches) {
  const threads = GmailApp.search('in:sent (to:' + term + ' OR cc:' + term + ' OR bcc:' + term + ')', 0, 10);
  let found = null;
  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (message) {
      const recipients = [message.getTo(), message.getCc(), message.getBcc()].join(',').toLowerCase()
        .match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}/g) || [];
      const hit = recipients.filter(matches)[0];
      if (!hit) return;
      const date = message.getDate();
      if (!found || date < found.at) found = { at: date, to: hit };
    });
  });
  return found ? { sent: true, date: found.at.toISOString(), to: found.to } : { sent: false };
}

/* ---------- History for duplicate checks ---------- */

/** Useful/Rejected rows count when their Outreach Status says contacted. Every other tab
    (old lists, IMPORTRANGE copies) counts as history. Tabs starting with "_" are ignored. */
function readHistory(spreadsheet) {
  return spreadsheet.getSheets().filter(function (sheet) {
    return sheet.getName().charAt(0) !== '_';
  }).map(function (sheet) {
    const lastRow = Math.min(sheet.getLastRow(), 20000), lastColumn = Math.min(sheet.getLastColumn(), 40);
    const rows = lastRow && lastColumn ? sheet.getRange(1, 1, lastRow, lastColumn).getDisplayValues() : [];
    return { name: sheet.getName(), history: RESULT_TABS.indexOf(sheet.getName()) < 0, rows: rows };
  });
}

/* ---------- Output upsert ---------- */

function normalizeOutputRecord(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('A result is invalid.');
  const domain = normalizeOutputDomain(input.domain);
  if (!domain) throw new Error('A result has no valid domain.');
  return {
    date: /^\d{4}-\d{2}-\d{2}$/.test(safeText(input.date, 10)) ? safeText(input.date, 10) : new Date().toISOString().slice(0, 10),
    campaign: safeText(input.campaign, 120) || 'Outreach', domain: domain,
    website: normalizeOutputUrl(input.website, true) || 'https://' + domain + '/',
    bestEmail: safeEmail(input.bestEmail), emails: safeDelimitedComma(input.emails),
    contactPages: String(input.contactPages || '').split(/\n/).map(function (u) { return normalizeOutputUrl(u.trim(), false); }).filter(Boolean).slice(0, 6).join('\n'),
    language: safeText(input.language, 40), da: safeMetric(input.da), dr: safeMetric(input.dr), spam: safeMetric(input.spam),
    domainAge: safeText(input.domainAge, 20)
  };
}
function safeDelimitedComma(value) {
  return Array.from(new Set(safeText(value, 3000).split(/[,;]/).map(function (part) { return safeEmail(part.trim()); }).filter(Boolean))).slice(0, 20).join(', ');
}

/** Adds new rows and updates existing ones (same domain + campaign). Reads once, writes once.
    Outreach Status and Notes, and any columns you add yourself, are never overwritten. */
function upsertOutputRecords(spreadsheet, incoming) {
  const sheet = ensureOutputSheet(spreadsheet), headers = getSheetHeaders(sheet), map = headerMap(headers);
  const lastRow = sheet.getLastRow();
  const rows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, headers.length).getValues() : [];
  const before = rows.length, byKey = {};
  const key = function (domain, campaign) { return String(domain || '').toLowerCase() + '|' + String(campaign || '').replace(/^'/, '').trim().toLowerCase(); };
  rows.forEach(function (values, index) { byKey[key(values[map.Domain], values[map.Campaign])] = index; });
  let added = 0, updated = 0;
  incoming.forEach(function (row) {
    const k = key(row.domain, row.campaign);
    let values = byKey[k] === undefined ? null : rows[byKey[k]];
    if (!values) { values = Array(headers.length).fill(''); rows.push(values); byKey[k] = rows.length - 1; added++; } else updated++;
    const fields = {
      'Date': row.date, 'Campaign': safeCell(row.campaign, 120), 'Domain': row.domain, 'Website': safeCell(row.website, 2048),
      'Best Email': safeCell(row.bestEmail, 254), 'All Emails': safeCell(row.emails, 3000), 'Contact Page': safeCell(row.contactPages, 5000),
      'Language': safeCell(row.language, 40), 'DA': row.da === null ? '' : row.da, 'DR': row.dr === null ? '' : row.dr,
      'Spam Score': row.spam === null ? '' : row.spam + '%', 'Domain Age': safeCell(row.domainAge, 20)
    };
    Object.keys(fields).forEach(function (name) {
      if (map[name] === undefined) return;
      // A recheck without a value keeps the value already in the Sheet.
      if (fields[name] === '' && ['DA', 'DR', 'Spam Score', 'Domain Age', 'Language'].indexOf(name) >= 0 && values[map[name]] !== '') return;
      values[map[name]] = fields[name];
    });
    if (map['Outreach Status'] !== undefined && !values[map['Outreach Status']]) values[map['Outreach Status']] = 'Not started';
  });
  if (rows.length) {
    ensureOutputCapacity(sheet, rows.length + 1);
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
  if (rows.length > before) refreshOutputFilter(sheet);
  return { added: added, updated: updated };
}

function ensureOutputSheet(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(OUTPUT_TAB);
  let changed = false;
  if (!sheet) { sheet = spreadsheet.insertSheet(OUTPUT_TAB, 0); changed = true; }
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, OUTPUT_HEADERS.length).setValues([OUTPUT_HEADERS]);
    changed = true;
  } else {
    const headers = getSheetHeaders(sheet);
    OUTPUT_HEADERS.forEach(function (header) {
      if (headers.indexOf(header) < 0) { sheet.getRange(1, headers.length + 1, 1, 1).setValues([[header]]); headers.push(header); changed = true; }
    });
  }
  if (changed) formatOutputSheet(sheet);
  return sheet;
}
function formatOutputSheet(sheet) {
  sheet.setFrozenRows(1);
  const headers = getSheetHeaders(sheet), map = headerMap(headers);
  sheet.getRange(1, 1, 1, headers.length).setBackground('#17202c').setFontColor('#ffffff').setFontWeight('bold');
  const widths = { 'Date': 95, 'Campaign': 170, 'Domain': 180, 'Website': 220, 'Best Email': 220, 'All Emails': 280, 'Contact Page': 280, 'Language': 90, 'DA': 50, 'DR': 50, 'Spam Score': 85, 'Domain Age': 90, 'Outreach Status': 130, 'Notes': 280 };
  headers.forEach(function (header, index) { if (widths[header]) sheet.setColumnWidth(index + 1, widths[header]); });
  applyOutreachStatusValidation(sheet, map);
}
function getSheetHeaders(sheet) {
  const count = sheet.getLastColumn();
  if (!count) return [];
  return sheet.getRange(1, 1, 1, count).getDisplayValues()[0].map(function (value) { return String(value || '').trim(); });
}
function headerMap(headers) { const map = {}; headers.forEach(function (name, index) { if (name) map[name] = index; }); return map; }
function applyOutreachStatusValidation(sheet, map) {
  const index = map['Outreach Status'];
  if (index === undefined) return;
  const validation = SpreadsheetApp.newDataValidation().requireValueInList(OUTPUT_STATUS_VALUES, true).setAllowInvalid(true).build();
  sheet.getRange(2, index + 1, Math.max(1, sheet.getMaxRows() - 1), 1).setDataValidation(validation);
}
function refreshOutputFilter(sheet) {
  const existing = sheet.getFilter();
  if (existing) existing.remove();
  sheet.getRange(1, 1, Math.max(2, sheet.getLastRow()), getSheetHeaders(sheet).length).createFilter();
}
function ensureOutputCapacity(sheet, requiredRow) {
  const maxRows = sheet.getMaxRows();
  if (requiredRow > maxRows) {
    sheet.insertRowsAfter(maxRows, requiredRow - maxRows + 50);
    applyOutreachStatusValidation(sheet, headerMap(getSheetHeaders(sheet)));
  }
}
function safeCount(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number < 1e13 ? number : null;
}
function normalizeOutputDomain(value) {
  let raw = safeText(value, 2048).toLowerCase().replace(/^https?:\/\//, '').split(/[/?#]/)[0].replace(/\.$/, '');
  if (raw.startsWith('www.')) raw = raw.slice(4);
  if (raw.length > 253 || raw.indexOf('..') >= 0 || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(raw)) return '';
  return raw;
}
function normalizeOutputUrl(value, allowBareHost) {
  try { return normalizeOutputUrlUnsafe(value, allowBareHost); } catch (_) { return ''; }
}
function normalizeOutputUrlUnsafe(value, allowBareHost) {
  let raw = safeText(value, 2048);
  if (allowBareHost && !/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
  const match = raw.match(/^(https?):\/\/([^/?#\s]+)([^#]*)$/i);
  if (!match || match[2].indexOf('@') >= 0) return '';
  const authority = match[2].toLowerCase(), hostMatch = authority.match(/^([a-z0-9.-]+)(?::(80|443))?$/);
  if (!hostMatch || !normalizeOutputDomain(hostMatch[1])) return '';
  const protocol = match[1].toLowerCase(), domain = normalizeOutputDomain(hostMatch[1]);
  const port = hostMatch[2] && !((protocol === 'https' && hostMatch[2] === '443') || (protocol === 'http' && hostMatch[2] === '80')) ? ':' + hostMatch[2] : '';
  return protocol + '://' + domain + port + (match[3] || '/');
}
function safeText(value, limit) {
  if (value === null || value === undefined || !['string', 'number', 'boolean'].includes(typeof value)) return '';
  return String(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}
function safeCell(value, limit) { const text = safeText(value, limit); return /^[\s]*[=+@-]/.test(text) ? "'" + text : text; }
function safeCampaignId(value) {
  const id = safeText(value, 120);
  if (!id) return '';
  if (!/^[A-Za-z0-9_.-]+$/.test(id)) throw new Error('Campaign ID contains unsupported characters.');
  return id;
}
function safeEmail(value) {
  const email = safeText(value, 254).toLowerCase();
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(email) ? email : '';
}
function safeDelimited(value, limit, mapper) {
  return Array.from(new Set(safeText(value, limit).split(';').map(function (part) { return mapper(part.trim()); }).filter(Boolean))).slice(0, 30).join('; ');
}
function safeUrlList(value, maxItems) {
  return Array.from(new Set(safeText(value, 5000).split(';').map(function (part) { return normalizeOutputUrl(part.trim(), false); }).filter(Boolean))).slice(0, maxItems).join('; ');
}
function safeMetric(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100 ? number : null;
}
function safeIsoDate(value) {
  const text = safeText(value, 40);
  if (!text) return '';
  const date = new Date(text);
  return isNaN(date.getTime()) ? '' : date.toISOString();
}
function constantTimeEquals(left, right) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index++) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}
function safeError(error) { return safeText(error && error.message ? error.message : 'Request failed.', 300) || 'Request failed.'; }
function outputJson(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }

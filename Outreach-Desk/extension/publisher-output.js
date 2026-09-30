/* Sends selected results to the user's Output Sheet through their Apps Script.
   Only clean outreach columns are sent; rows are matched by domain + campaign name. */
(function (g) {
  'use strict';
  const MAX_RECORDS = 100;
  const MAX_PAYLOAD_BYTES = 400 * 1024;
  const REQUEST_TIMEOUT_MS = 30000;
  const LANGUAGES = {en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', pt: 'Portuguese', nl: 'Dutch', pl: 'Polish', ur: 'Urdu', ar: 'Arabic'};

  function clean(value, limit) {
    let text = String(value == null ? '' : value);
    if (typeof text.normalize === 'function') text = text.normalize('NFKC');
    return text.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
  }
  function host(value) {
    let raw = clean(value, 2048);
    if (!raw) return '';
    if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
    try {
      const parsed = new URL(raw);
      if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) return '';
      let hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
      if (hostname.startsWith('www.')) hostname = hostname.slice(4);
      return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(hostname) ? hostname : '';
    } catch (_) { return ''; }
  }
  function safeUrl(value) {
    const raw = clean(value, 2048);
    try {
      const parsed = new URL(raw);
      if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password || !host(parsed.hostname)) return '';
      parsed.hash = '';
      return parsed.href.slice(0, 2048);
    } catch (_) { return ''; }
  }
  function email(value) {
    const candidate = clean(value, 254).toLowerCase();
    return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(candidate) ? candidate : '';
  }
  function metric(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n) : null;
  }
  function ageText(months) {
    const m = Number(months);
    return Number.isInteger(m) && m >= 0 ? Math.floor(m / 12) + 'y ' + (m % 12) + 'm' : '';
  }
  const unique = (list, limit) => [...new Set(list.filter(Boolean))].slice(0, limit);
  function usable(contact) { return contact && contact.suitability !== 'excluded' && contact.override !== 'exclude'; }

  function record(lead) {
    if (!lead || typeof lead !== 'object' || Array.isArray(lead)) throw new Error('Choose a result to send.');
    const domain = host(lead.domain || lead.website);
    if (!domain) throw new Error('Result has no valid domain.');
    const rejected = lead.bucket === 'rejected' || lead.doNotContact;
    const contacts = Array.isArray(lead.emails) ? lead.emails : [];
    const emails = rejected ? [] : unique(contacts.filter(usable).map(c => email(typeof c === 'string' ? c : c.email)), 20);
    const offers = (Array.isArray(lead.opportunities) ? lead.opportunities : []).filter(o => o && o.decision === 'qualified').map(o => o.url);
    const pages = unique([...(lead.contactPages || []), ...offers, ...(lead.forms || [])].map(x => safeUrl(typeof x === 'string' ? x : x && x.url)), 6);
    const when = new Date(lead.collectedAt || lead.createdAt || Date.now());
    return {
      date: Number.isFinite(when.getTime()) ? when.toISOString().slice(0, 10) : '',
      campaign: clean(lead.campaignName || lead.niche, 120) || 'Outreach',
      domain, website: safeUrl(lead.website) || 'https://' + domain + '/',
      bestEmail: rejected ? '' : email(lead.bestEmail || lead.selectedEmail) || emails[0] || '',
      emails: emails.join(', '), contactPages: pages.join('\n'),
      language: LANGUAGES[lead.language] || '',
      da: metric(lead.da), dr: metric(lead.dr), spam: metric(lead.spam), domainAge: ageText(lead.age)
    };
  }

  function validateConfig(config) {
    if (!config || typeof config !== 'object') throw new Error('Enter the Apps Script web app URL.');
    let parsed;
    try { parsed = new URL(clean(config.endpoint, 2048)); } catch (_) { throw new Error('Use the deployed Google Apps Script /exec URL.'); }
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'script.google.com' || parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash ||
        !/^\/(?:a\/[^/]+\/)?macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(parsed.pathname)) {
      throw new Error('Endpoint must be an HTTPS script.google.com/macros/s/.../exec web app URL.');
    }
    const secret = typeof config.secret === 'string' ? config.secret.trim() : '';
    if (secret && (secret.length < 8 || secret.length > 256 || /\s/.test(secret))) throw new Error('Secret must be 8-256 characters without spaces, or leave it empty.');
    return {endpoint: parsed.origin + parsed.pathname, secret};
  }

  async function send(config, action, records, fetcher) {
    const checked = validateConfig(config);
    if (action !== 'upsert' && action !== 'ping') throw new Error('Action must be upsert or ping.');
    if (!Array.isArray(records)) throw new Error('Records must be provided as a list.');
    if (action === 'ping' && records.length) throw new Error('Connection test does not accept records.');
    if (action === 'upsert' && (!records.length || records.length > MAX_RECORDS)) throw new Error('Send between 1 and 100 results at a time.');
    const rows = action === 'upsert' ? records.map(r => r && typeof r.date === 'string' && typeof r.campaign === 'string' ? r : record(r)) : [];
    const body = JSON.stringify({...(checked.secret ? {secret: checked.secret} : {}), action, records: rows});
    if (new TextEncoder().encode(body).length > MAX_PAYLOAD_BYTES) throw new Error('Too much data in one request. Send fewer results.');
    const request = fetcher || g.fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response, text;
    try {
      response = await request(checked.endpoint, {method: 'POST', headers: {'Content-Type': 'text/plain;charset=utf-8'}, body, credentials: 'omit', cache: 'no-store', redirect: 'follow', signal: controller.signal});
      text = typeof response.text === 'function' ? await response.text() : JSON.stringify(await response.json());
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error('Apps Script did not answer within 30 seconds.');
      throw new Error('Could not reach the Apps Script web app. Check that it is deployed with access "Anyone".');
    } finally { clearTimeout(timer); }
    if (!response || response.ok !== true) throw new Error('Apps Script returned an HTTP error. Check the deployment URL and access setting.');
    let ack;
    try { ack = JSON.parse(text); } catch (_) { throw new Error('Apps Script returned an unreadable answer. Paste the latest Code.gs and deploy a new version.'); }
    if (!ack || ack.ok !== true) throw new Error(clean(ack && ack.error, 300) || 'Apps Script did not accept the request.');
    if (!Number.isInteger(ack.accepted) || ack.accepted !== rows.length) throw new Error('Apps Script confirmed a different number of rows. Paste the latest Code.gs and deploy a new version.');
    return ack;
  }
  async function test(config, fetcher) {
    const ack = await send(config, 'ping', [], fetcher);
    if (ack.message !== 'pong') throw new Error('Apps Script connection test did not return pong.');
    return ack;
  }
  g.PublisherOutput = Object.freeze({validateConfig, record, send, test});
})(globalThis);

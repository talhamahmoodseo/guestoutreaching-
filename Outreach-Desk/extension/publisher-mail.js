/* Talks to the user's own Apps Script web apps (the Output Sheet script and any
   extra Gmail accounts running the same script). Used for connection tests,
   Output Sheet history and sent-mail history. Only yes/no + date + matched address
   comes back for sent-mail checks; no email content leaves Gmail. */
(function (g) {
  'use strict';
  const C = PublisherCore;
  const CACHE_KEY = 'publisherMailCache';
  const NEGATIVE_TTL = 14 * 86400000;
  const BATCH = 10;

  /* ---------- One retry policy for every Apps Script call ----------
     Apps Script returns HTTP 404, 429 and 5xx transiently: while a deployment
     propagates, under Google's own load, and sometimes for no visible reason.
     Treating the first failure as "disconnected" is what made campaigns stop
     mid-run and report a working connection as broken. Everything retries with
     backoff; only errors that cannot fix themselves skip the retries. */
  const PERMANENT = /Wrong secret|not the Outreach Desk|sign-in page|unreadable answer|Paste the Apps Script|Use the deployed Apps Script|Secret must be|Authorization is required|no valid domain|between 1 and 100|different number/i;
  const permanent = e => PERMANENT.test((e && e.message) || '');
  const pause = ms => new Promise(r => setTimeout(r, ms));
  const settings = x => (typeof x === 'function' ? {fetcher: x} : x) || {};
  // `wait` is injected by the worker so its tests advance a fake clock instead of really sleeping.
  async function attempt(run, {tries = 4, base = 1200, cap = 15000, wait = pause} = {}) {
    let last;
    for (let n = 0; n < tries; n++) {
      if (n) await wait(Math.min(cap, base * 2 ** (n - 1)));
      try { return await run(n); } catch (e) { last = e; if (permanent(e)) break; }
    }
    throw last;
  }

  function endpoint(value) {
    let parsed;
    try { parsed = new URL(C.clean(value)); } catch (_) { throw new Error('Paste the Apps Script web app URL that ends in /exec.'); }
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'script.google.com' || parsed.port || parsed.username || parsed.password ||
        !/^\/(?:a\/[^/]+\/)?macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(parsed.pathname)) {
      throw new Error('Use the deployed Apps Script URL: https://script.google.com/macros/s/.../exec (not /dev).');
    }
    return parsed.origin + parsed.pathname;
  }
  function secret(value) {
    const s = typeof value === 'string' ? value.trim() : '';
    if (s && (s.length < 8 || s.length > 256 || /\s/.test(s))) throw new Error('Secret must be 8-256 characters without spaces, or leave it empty.');
    return s;
  }

  // POST text/plain JSON (no CORS preflight). Apps Script answers through a redirect.
  async function call(config, action, payload = {}, timeoutMs = 30000, o) {
    const url = endpoint(config.endpoint), key = secret(config.secret);
    const request = settings(o).fetcher || g.fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response, text;
    try {
      response = await request(url, {
        method: 'POST', headers: {'Content-Type': 'text/plain;charset=utf-8'},
        body: JSON.stringify({...payload, action, ...(key ? {secret: key} : {})}),
        credentials: 'omit', cache: 'no-store', redirect: 'follow', signal: controller.signal
      });
      text = await response.text();
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error('Apps Script did not answer within ' + Math.round(timeoutMs / 1000) + ' seconds.');
      throw new Error('Could not reach the Apps Script web app. Check that it is deployed with access "Anyone".');
    } finally { clearTimeout(timer); }
    if (!response.ok) throw new Error('Apps Script returned HTTP ' + response.status + '. Check the deployment URL and that access is "Anyone".');
    let body;
    try { body = JSON.parse(text); } catch (_) {
      if (/<html|<!doctype/i.test(text || '')) throw new Error('Apps Script returned a Google sign-in page. Redeploy with "Who has access: Anyone".');
      throw new Error('Apps Script returned an unreadable answer. Paste the latest Code.gs and redeploy.');
    }
    if (!body || body.ok !== true) throw new Error(C.clean(body && body.error).slice(0, 300) || 'Apps Script rejected the request.');
    return body;
  }

  // Single attempt on purpose: callers wrap this in attempt() so there is only ever one retry layer.
  async function ping(config, o) {
    const body = await call(config, 'ping', {records: []}, 25000, o);
    if (body.message !== 'pong') throw new Error('This URL is not the Outreach Desk script. Paste the latest Code.gs and redeploy.');
    return {account: C.clean(body.account).toLowerCase().slice(0, 254), sheet: !!body.sheet, gmail: body.gmail !== false, version: Number(body.version) || 1};
  }

  async function history(config, o) {
    const body = await attempt(() => call(config, 'history', {}, 45000, o), settings(o));
    if (!Array.isArray(body.tabs)) throw new Error('Output Sheet history was not returned. Paste the latest Code.gs and redeploy.');
    return PublisherSheets.scriptTabs(body.tabs);
  }

  const cacheKey = (accountId, kind, value) => accountId + '|' + kind + '|' + value;
  async function loadCache() { return (await chrome.storage.local.get(CACHE_KEY))[CACHE_KEY] || {}; }
  async function saveCache(cache) {
    const entries = Object.entries(cache);
    if (entries.length > 30000) {
      entries.sort((a, b) => (a[1].s ? 1 : 0) - (b[1].s ? 1 : 0) || a[1].at - b[1].at);
      for (const [k] of entries.slice(0, entries.length - 25000)) delete cache[k];
    }
    await chrome.storage.local.set({[CACHE_KEY]: cache});
  }
  const fresh = entry => entry && (entry.s || Date.now() - entry.at < NEGATIVE_TTL);

  /* Checks domains (company level) and free-provider emails (exact) against the
     sent mail of every selected account. Returns hits keyed by domain/email.
     Throws with blockedAccount when any selected account cannot be checked. */
  async function check(accounts, {domains = [], emails = []}, o) {
    const wantDomains = C.uniq(domains.map(C.domain)), wantEmails = C.uniq(emails.map(e => String(e || '').toLowerCase()));
    const hits = {domains: {}, emails: {}};
    if (!accounts.length || (!wantDomains.length && !wantEmails.length)) return hits;
    const cache = await loadCache();
    let changed = false;
    for (const account of accounts) {
      const needD = wantDomains.filter(d => !fresh(cache[cacheKey(account.id, 'd', d)]));
      const needE = wantEmails.filter(e => !fresh(cache[cacheKey(account.id, 'e', e)]));
      for (let i = 0; i < Math.max(needD.length, needE.length); i += BATCH) {
        const partD = needD.slice(i, i + BATCH), partE = needE.slice(i, i + BATCH);
        if (!partD.length && !partE.length) continue;
        let body;
        try {
          body = await attempt(() => call(account, 'sent', {domains: partD, emails: partE}, 60000, o), settings(o));
        } catch (e) {
          if (changed) await saveCache(cache);
          const error = new Error((account.label || account.email || 'Email account') + ' could not be checked: ' + e.message);
          error.blockedAccount = account.id;
          throw error;
        }
        const results = body.results || {};
        for (const d of partD) { const r = results.domains?.[d] || {}; cache[cacheKey(account.id, 'd', d)] = {s: r.sent ? 1 : 0, date: C.clean(r.date).slice(0, 40), to: C.clean(r.to).slice(0, 254), at: Date.now()}; }
        for (const e of partE) { const r = results.emails?.[e] || {}; cache[cacheKey(account.id, 'e', e)] = {s: r.sent ? 1 : 0, date: C.clean(r.date).slice(0, 40), to: C.clean(r.to).slice(0, 254), at: Date.now()}; }
        changed = true;
      }
      for (const [kind, list, out] of [['d', wantDomains, hits.domains], ['e', wantEmails, hits.emails]]) {
        for (const value of list) {
          const entry = cache[cacheKey(account.id, kind, value)];
          if (entry?.s) (out[value] ||= []).push({accountId: account.id, account: account.email || account.label, date: entry.date, to: entry.to});
        }
      }
    }
    if (changed) await saveCache(cache);
    return hits;
  }

  function describe(hit) {
    const when = hit.date ? new Date(hit.date).toLocaleDateString(undefined, {day: 'numeric', month: 'short', year: 'numeric'}) : '';
    return 'Emailed' + (hit.to ? ' ' + hit.to : '') + ' from ' + hit.account + (when ? ' on ' + when : '');
  }

  g.PublisherMail = {endpoint, secret, call, ping, history, check, describe, attempt, permanent, CACHE_KEY};
})(globalThis);

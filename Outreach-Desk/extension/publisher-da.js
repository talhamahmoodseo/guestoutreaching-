/* Reads SEO metrics that other extensions render beside Google results.
   Supports RankSEO-style badges (DA, PA, DR, Spam, Age, TR) and MozBar (DA/PA).
   Only values that are visible as page text are read. Conflicting values for the
   same metric inside one result are dropped instead of guessed. */
(function (g) {
  'use strict';
  const C = PublisherCore;
  const LABELS = {da: 'DA', pa: 'PA', dr: 'DR', spam: 'Spam', age: 'Age', traffic: 'TR'};
  function metric(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isInteger(n) && n >= 0 && n <= 100 ? n : null;
  }
  function score(raw) {
    const m = String(raw || '').match(/^(\d{1,3}(?:\.\d+)?)\s*%?$/);
    if (!m) return null;
    const n = Math.round(Number(m[1]));
    return n >= 0 && n <= 100 ? n : null;
  }
  function age(raw) {
    const s = String(raw || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const m = s.match(/^(?:(\d{1,3})\s*y(?:ears?|rs?)?)?\s*(?:(\d{1,2})\s*m(?:o|os|onths?)?)?$/);
    if (!m || (m[1] === undefined && m[2] === undefined)) return null;
    const months = Number(m[1] || 0) * 12 + Number(m[2] || 0);
    return months >= 0 && months < 1200 ? months : null;
  }
  function traffic(raw) {
    const m = String(raw || '').replace(/,/g, '').match(/^(\d+(?:\.\d+)?)\s*([kmb])?$/i);
    if (!m) return null;
    const mult = {k: 1e3, m: 1e6, b: 1e9}[String(m[2] || '').toLowerCase()] || 1;
    return Math.round(Number(m[1]) * mult);
  }
  const PARSE = {da: score, pa: score, dr: score, spam: score, age, traffic};
  // One badge such as "DA 70", "DR: 2", "SPAM 30%", "Age: 18y 7m" or "TR 3.9K".
  const TOKEN = /^(DA|PA|DR|SPAM(?:\s*SCORE)?|AGE|TR)\s*[:：]?\s*(.{1,12})$/i;
  function token(text) {
    const m = C.clean(text).match(TOKEN);
    if (!m) return null;
    const label = m[1].toUpperCase().replace(/\s+/g, ' ');
    const key = label.startsWith('SPAM') ? 'spam' : label === 'TR' ? 'traffic' : label.toLowerCase();
    const value = PARSE[key](m[2]);
    return value === null ? null : {key, value};
  }
  // MozBar-style single card: "DA: 35 PA: 22". Kept as the fallback reader.
  function parseCard(input) {
    const s = C.clean(input);
    if (s.length > 180) return null;
    const da = s.match(/(?:^|[^A-Za-z])DA\s*[:：]?\s*(\d{1,3})(?=\s|$|[^\d])/i);
    const pa = s.match(/(?:^|[^A-Za-z])PA\s*[:：]?\s*(\d{1,3})(?=\s|$|[^\d])/i);
    if (!da || !pa || Math.abs(da.index - pa.index) > 130) return null;
    const value = metric(da[1]), pageAuthority = metric(pa[1]);
    return value === null || pageAuthority === null ? null : {value, pageAuthority};
  }
  function elements(root) {
    const out = [];
    const walk = node => {
      for (const el of node.querySelectorAll('*')) {
        out.push(el);
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    };
    walk(root);
    return out;
  }
  function textOf(el) { return el.textContent || ''; }
  function merge(found) {
    const out = {};
    for (const [key, values] of Object.entries(found)) {
      const unique = [...new Set(values)];
      if (unique.length === 1) out[key] = unique[0];
    }
    return out;
  }
  // Metrics for the result whose title is h.
  function read(h) {
    let ancestor = h.parentElement;
    for (let level = 0; ancestor && ancestor !== h.ownerDocument.body && level < 10; level++, ancestor = ancestor.parentElement) {
      if (ancestor.querySelectorAll('h3').length !== 1) break;
      const found = {}, moz = [];
      for (const el of elements(ancestor)) {
        if (el.contains(h) || el === h) continue;
        const text = textOf(el);
        const t = text.length <= 28 ? token(text) : null;
        if (t) (found[t.key] ||= []).push(t.value);
        else if (!el.querySelector('h3')) {
          const card = parseCard(text);
          if (card) moz.push(card);
        }
      }
      if (!found.da && !found.pa && moz.length) {
        const unique = [...new Set(moz.map(x => x.value + '/' + x.pageAuthority))];
        if (unique.length === 1) { found.da = [moz[0].value]; found.pa = [moz[0].pageAuthority]; found.source = ['MozBar']; }
      }
      const source = found.source ? 'MozBar' : 'SEO extension';
      delete found.source;
      const metrics = merge(found);
      if (Object.keys(metrics).length) return {...metrics, source};
    }
    return null;
  }

  function collectFound(list) {
    const found = {};
    for (const t of list) (found[t.key] ||= []).push(t.value);
    return merge(found);
  }
  /* Assigns visible metric badges to Google results. A badge belongs to the result block
     that contains it; inside blocks with several titles (sitelinks) it belongs to the
     nearest result title before it in page order. */
  function assign(results, heads) {
    if (!Array.isArray(heads) || heads.length !== results.length || !heads.length) return results;
    const doc = heads[0].ownerDocument, index = new Map(heads.map((h, i) => [h, i]));
    const perResult = results.map(() => []), moz = results.map(() => []);
    let currentIdx = -1;
    const owner = el => {
      let anc = el.parentElement;
      for (let level = 0; anc && level < 8; level++, anc = anc.parentElement) {
        const inside = heads.filter(h => anc.contains(h));
        if (inside.length === 1) return index.get(inside[0]);
        if (inside.length > 1) break;
      }
      return currentIdx;
    };
    for (const el of elements(doc)) {
      if (el.tagName === 'H3') { currentIdx = index.has(el) ? index.get(el) : -1; continue; }
      if (el.closest && el.closest('h3,#tads,#bottomads,[data-text-ad]')) continue;
      const text = textOf(el);
      if (text.length > 180) continue;
      const t = text.length <= 28 ? token(text) : null;
      if (t) { const i = owner(el); if (i >= 0) perResult[i].push(t); continue; }
      if (!el.querySelector('h3')) {
        const card = parseCard(text);
        if (card) { const i = owner(el); if (i >= 0) moz[i].push(card); }
      }
    }
    return results.map((r, i) => {
      let metrics = collectFound(perResult[i]), source = 'SEO extension';
      if (metrics.da === undefined && metrics.dr === undefined && moz[i].length) {
        const unique = [...new Set(moz[i].map(x => x.value + '/' + x.pageAuthority))];
        if (unique.length === 1) { metrics = {da: moz[i][0].value, pa: moz[i][0].pageAuthority}; source = 'MozBar'; }
      }
      if (!Object.keys(metrics).length) return r;
      const out = {...r, metricSource: 'Google result (' + source + ')'};
      for (const key of Object.keys(LABELS)) if (metrics[key] !== undefined) out[key] = metrics[key];
      if (out.da !== undefined) out.daSource = 'Visible Google result metric';
      return out;
    });
  }
  /* Metrics shown by the SEO extension's toolbar when the website itself is open. Only
     reads badges inside a toolbar (RankSEO/Moz label, or a fixed/sticky bar) so numbers
     in the page content (for example guest-post lists) are never used. */
  function readSite(doc = document) {
    const view = doc.defaultView;
    const fixed = el => { for (let a = el, n = 0; a && n < 8; a = a.parentElement || a.getRootNode?.().host, n++) { try { const p = view.getComputedStyle(a).position; if (p === 'fixed' || p === 'sticky') return true; } catch (_) { /* ignore */ } } return false; };
    const tokens = [];
    for (const el of elements(doc)) {
      const text = textOf(el);
      if (text.length > 28) continue;
      const t = token(text);
      if (t && !(el.firstElementChild && token(textOf(el.firstElementChild)))) tokens.push({el, t});
    }
    let best = null;
    for (const {el} of tokens) {
      for (let a = el.parentElement || el.getRootNode?.().host, n = 0; a && n < 6; a = a.parentElement || a.getRootNode?.().host, n++) {
        const text = textOf(a);
        if (text.length > 2500) break;
        const inside = tokens.filter(x => a.contains(x.el));
        const keys = new Set(inside.map(x => x.t.key));
        if (keys.size < 2) continue;
        if (!(/rank\s*seo|mozbar|\bmoz\b/i.test(text) || fixed(a))) continue;
        if (!best || keys.size > best.keys) best = {keys: keys.size, list: inside.map(x => x.t)};
        break;
      }
    }
    if (!best) return null;
    const metrics = collectFound(best.list);
    return Object.keys(metrics).length ? metrics : null;
  }
  function attach(results, doc = document, base = location.href) {
    const heads = [...doc.querySelectorAll('h3')];
    const byKey = new Map();
    for (const h of heads) {
      const a = h.closest('a') || h.querySelector('a');
      if (!a) continue;
      let u = C.url(a.getAttribute('href'), base);
      if (u && new URL(u).hostname === new URL(base).hostname && new URL(u).pathname === '/url') { const q = new URL(u).searchParams; u = C.url(q.get('q') || q.get('url')); }
      const key = u + '|' + C.clean(h.innerText || h.textContent);
      byKey.set(key, byKey.has(key) ? null : h);
    }
    const matched = results.map(r => byKey.get(C.url(r.url) + '|' + C.clean(r.title)) || null);
    const pairs = results.map((r, i) => [r, matched[i]]).filter(([, h]) => h);
    const done = assign(pairs.map(p => p[0]), pairs.map(p => p[1]));
    return results.map(r => { const i = pairs.findIndex(p => p[0] === r); return i >= 0 ? done[i] : r; });
  }
  const has = (r, key) => r[key] !== undefined && r[key] !== null;
  // Checks that at least two separate results expose the metrics a campaign filters on.
  // Blocks only when no result on the page shows any of the needed metrics.
  function preflight(results, needed = ['da']) {
    const keys = needed.length ? needed : ['da'];
    const readable = results.filter(r => keys.some(k => has(r, k)));
    const missing = keys.filter(k => !results.some(r => has(r, k)));
    if (!readable.length) return {ok: false, count: 0, missing, reason: 'No ' + keys.map(k => LABELS[k]).join(', ') + ' values are visible beside the Google results. Check that your SEO extension is on and showing metrics.'};
    return {ok: true, count: readable.length, missing, reason: readable.length + ' of ' + results.length + ' Google results show metrics' + (missing.length ? '; not visible: ' + missing.map(k => LABELS[k]).join(', ') : '') + '.'};
  }
  const metricCount = results => results.filter(r => ['da', 'dr', 'spam', 'age'].some(k => has(r, k))).length;
  g.PublisherDA = {metric, parseCard, token, age, traffic, read, attach, assign, readSite, preflight, metricCount, LABELS};
})(globalThis);

/* Semrush discovery: parse an export, normalise it, and filter it down to candidates.
   Pure logic — no I/O, no storage, no tabs — so every rule here is unit-testable and every
   rejection carries a reason. Thresholds come from measuring real exports; see
   docs/SEMRUSH-PLAN.md sections 11 and 12.

   Two shapes arrive from Semrush and both are handled:
   - Referring Domains: a plain CSV table (domain, domain_ascore, category, is_follow …)
   - Organic Competitors: a JSON-RPC envelope with the payload as JSON inside one cell */
(function (g) {
  'use strict';
  const C = PublisherCore, R = PublisherRules;

  /* ---------- CSV to rows ---------- */
  function rows(text) {
    const out = [];
    let row = [], cell = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
      else if (ch === ',' && !quoted) { row.push(cell); cell = ''; }
      else if ((ch === '\n' || ch === '\r') && !quoted) { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); out.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (quoted) throw Error('This file has an unclosed quote and could not be read.');
    if (cell || row.length) { row.push(cell); out.push(row); }
    if (!out.length) throw Error('This file is empty.');
    const head = out[0].map(h => C.clean(h).replace(/^﻿/, ''));
    return out.slice(1).filter(r => r.some(v => C.clean(v)))
      .map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
  }

  /* ---------- Unwrap whichever export shape this is ---------- */
  const num = v => { const n = Number(String(v ?? '').replace(/[, ]/g, '')); return Number.isFinite(n) ? n : null; };
  const bool = v => /^(true|1|yes)$/i.test(String(v ?? '').trim());

  function unwrap(text) {
    const table = rows(text);
    const head = Object.keys(table[0] || {});
    // Organic Competitors arrives as JSON-RPC: the payload is a JSON array inside `result`.
    if (head.includes('jsonrpc') || head.includes('result')) {
      const items = [];
      let limited = false;
      for (const r of table) {
        const v = String(r.result || '').trim(), err = String(r.error || '').trim();
        if (v.startsWith('[')) { try { items.push(...JSON.parse(v)); } catch {} }
        if (/Report limits exceeded|-32107/.test(v + ' ' + err)) limited = true;
      }
      if (!items.length) {
        throw Error(limited
          ? 'This export contains only "Report limits exceeded" errors — the Semrush account ran out of report allowance. Try again later or use another account.'
          : 'No Semrush data was found in this file. It looks like an API envelope but carries no results.');
      }
      return {records: items, limited};
    }
    return {records: table, limited: false};
  }

  /* ---------- Which report is this? ---------- */
  function detect(records) {
    const keys = new Set(Object.keys(records[0] || {}));
    if (keys.has('commonKeywords') || keys.has('competitionLvl')) return 'competitors';
    if (keys.has('domain_ascore') || keys.has('backlinks_num') || keys.has('is_follow')) return 'backlinks';
    if (keys.has('domain') || keys.has('Domain')) return 'backlinks';
    return '';
  }

  /* ---------- Normalise both shapes to one candidate ---------- */
  function normalise(record, method, seed) {
    const raw = record.domain ?? record.Domain ?? record.target ?? '';
    const domain = C.domain(raw);
    if (!domain) return null;
    const base = {domain, method, seed: seed || '', raw: C.clean(raw)};
    if (method === 'competitors') {
      const keywords = num(record.organicPositions), traffic = num(record.organicTraffic);
      return Object.assign(base, {
        commonKeywords: num(record.commonKeywords) ?? 0,
        competition: num(record.competitionLvl) ?? 0,
        organicKeywords: keywords ?? 0,
        organicTraffic: traffic ?? 0,
        // A content site ranks for many keywords relative to its traffic; a shop or restaurant
        // earns most of its traffic from its own brand name on very few keywords.
        trafficPerKeyword: keywords ? Math.round((traffic || 0) / keywords * 100) / 100 : null
      });
    }
    return Object.assign(base, {
      ascore: num(record.domain_ascore) ?? null,
      backlinks: num(record.backlinks_num) ?? 0,
      country: C.clean(record.country).toLowerCase(),
      category: C.clean(record.category).toLowerCase(),
      firstSeen: C.clean(record.first_seen),
      lastSeen: C.clean(record.last_seen),
      follow: record.is_follow === '' ? null : bool(record.is_follow),
      lost: bool(record.lost),
      fresh: bool(record.new)
    });
  }

  /* ---------- Category split, measured against a real 949-row export ----------
     Semrush assigns one of ~73 categories. These two lists are the starting point and are
     meant to be edited; anything unlisted is kept, because uncertainty keeps the site. */
  const PUBLISHER_CATEGORIES = ['mass_media', 'newspapers', 'publishing', 'online_services', 'entertainment',
    'travel_and_tourism', 'wellness', 'visual_art', 'music', 'lifestyle', 'books_and_literature',
    'arts_and_entertainment', 'photography', 'sports', 'food_and_beverages', 'apparel_and_fashion',
    'education', 'information_technology', 'advertising_and_marketing', 'design', 'writing_and_editing_services'];
  const BUSINESS_CATEGORIES = ['real_estate', 'restaurants', 'hospitality', 'retail', 'construction_and_maintenance',
    'legal', 'automotive', 'healthcare_services', 'beauty', 'financial_services', 'insurance', 'manufacturing',
    'renewable_energy', 'agriculture', 'logistics', 'telecommunications', 'transportation_and_logistics',
    'recruitment_and_staffing', 'accounting_and_auditing', 'banking', 'furniture', 'jewelry_and_luxury_products'];

  /* ---------- Link types that are never a guest-post opportunity ---------- */
  const PATTERNS = [
    ['directory', /(^|\.)(yelp|yellowpages|bbb\.org|crunchbase|manta|foursquare|trustpilot|clutch\.co|angi|houzz|thumbtack|tripadvisor|mapquest|citysearch|superpages|hotfrog|brownbook|cylex|chamberofcommerce|alignable|merchantcircle|expertise|birdeye|nextdoor|eventbrite|meetup|zillow|realtor|apartments)\./i,
      'Business directory or citation site, not a publisher'],
    ['forum', /(^|\.)(forum|forums|board|community)\.|(forum|forums)\.(com|net|org)$/i,
      'Forum or community site'],
    ['free_host', /(^|\.)(wordpress|blogspot|blogger|weebly|wixsite|wix|webnode|jimdo|strikingly|github|tumblr|substack|medium|blogspot)\.[a-z.]{2,}$/i,
      'Free subdomain host, not an independent publisher']
  ];

  const DEFAULTS = {
    backlinks: {categoriesOff: BUSINESS_CATEGORIES.slice(), ascoreMin: null, ascoreMax: null,
      countries: [], followOnly: false, excludeLost: true},
    competitors: {commonMin: 10, trafficMin: 1000, trafficMax: 60000, shapeMax: 5, competitionMin: null}
  };

  /* ---------- The filter. Every drop carries a code and a sentence. ---------- */
  function screen(candidate, settings, blocklist) {
    const d = candidate.domain;
    const platform = R.platform('https://' + d + '/');
    if (platform) return {code: 'platform', reason: 'Platform or social site: ' + platform};
    const blocked = C.excluded(d, blocklist || []);
    if (blocked) return {code: 'blocked', reason: blocked};
    // Check the address as exported as well as its registrable domain: collapsing
    // "someone.webnode.com" to "webnode.com" would otherwise hide the free host.
    for (const [code, re, reason] of PATTERNS) if (re.test(d) || re.test(candidate.raw || '')) return {code, reason};

    if (candidate.method === 'backlinks') {
      const s = settings;
      if (s.excludeLost !== false && candidate.lost) return {code: 'lost', reason: 'The link is no longer live'};
      if (s.followOnly && candidate.follow === false) return {code: 'nofollow', reason: 'Nofollow link'};
      if (s.ascoreMin != null && candidate.ascore != null && candidate.ascore < s.ascoreMin)
        return {code: 'ascore', reason: 'Authority Score ' + candidate.ascore + ' is below ' + s.ascoreMin};
      if (s.ascoreMax != null && candidate.ascore != null && candidate.ascore > s.ascoreMax)
        return {code: 'ascore', reason: 'Authority Score ' + candidate.ascore + ' is above ' + s.ascoreMax};
      if ((s.countries || []).length && candidate.country && !s.countries.includes(candidate.country))
        return {code: 'country', reason: 'Country ' + candidate.country.toUpperCase() + ' is outside your selection'};
      // A blank category is kept: uncertainty must not reject a site.
      if (candidate.category && (s.categoriesOff || []).includes(candidate.category))
        return {code: 'category', reason: 'Semrush category "' + candidate.category.replace(/_/g, ' ') + '" rarely publishes contributions'};
      return null;
    }

    const s = settings;
    if (s.commonMin != null && candidate.commonKeywords < s.commonMin)
      return {code: 'overlap', reason: 'Only ' + candidate.commonKeywords + ' shared keyword' + (candidate.commonKeywords === 1 ? '' : 's') + ', below ' + s.commonMin};
    if (s.competitionMin != null && candidate.competition < s.competitionMin)
      return {code: 'overlap', reason: 'Competition level ' + candidate.competition + ' is below ' + s.competitionMin};
    if (s.trafficMin != null && candidate.organicTraffic < s.trafficMin)
      return {code: 'traffic', reason: 'Organic traffic ' + candidate.organicTraffic.toLocaleString() + ' is below ' + s.trafficMin.toLocaleString()};
    if (s.trafficMax != null && candidate.organicTraffic > s.trafficMax)
      return {code: 'traffic', reason: 'Organic traffic ' + candidate.organicTraffic.toLocaleString() + ' is above ' + s.trafficMax.toLocaleString() + ' — too large to accept contributions'};
    if (s.shapeMax != null && candidate.trafficPerKeyword != null && candidate.trafficPerKeyword > s.shapeMax)
      return {code: 'shape', reason: 'Earns ' + candidate.trafficPerKeyword + ' visits per keyword — a brand or local business, not a content site'};
    return null;
  }

  /* ---------- Whole-file pipeline ---------- */
  function read(text, {seed = '', method = ''} = {}) {
    const {records, limited} = unwrap(String(text || ''));
    const kind = method || detect(records);
    if (!kind) throw Error('This does not look like a Semrush Referring Domains or Organic Competitors export.');
    const seen = new Set(), candidates = [];
    let duplicates = 0, unreadable = 0;
    for (const record of records) {
      const candidate = normalise(record, kind, seed);
      if (!candidate) { unreadable++; continue; }
      if (seen.has(candidate.domain)) { duplicates++; continue; }
      seen.add(candidate.domain);
      candidates.push(candidate);
    }
    if (!candidates.length) throw Error('No readable website addresses were found in this export.');
    return {method: kind, candidates, duplicates, unreadable, limited};
  }

  function apply(candidates, settings, blocklist) {
    const kept = [], dropped = [], counts = {};
    for (const candidate of candidates) {
      const miss = screen(candidate, settings, blocklist);
      if (miss) { counts[miss.code] = (counts[miss.code] || 0) + 1; dropped.push({...candidate, ...miss}); }
      else kept.push(candidate);
    }
    return {kept, dropped, counts};
  }

  g.PublisherSemrush = {read, apply, screen, normalise, detect, unwrap, rows,
    DEFAULTS, PUBLISHER_CATEGORIES, BUSINESS_CATEGORIES, PATTERNS};
})(globalThis);

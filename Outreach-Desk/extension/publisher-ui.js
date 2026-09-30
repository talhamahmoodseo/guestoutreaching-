(function () {
'use strict';
const C = PublisherCore, R = PublisherRules, $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const BUCKETS = {all: 'All', ready: 'Ready', form: 'Form only', no_email: 'No email', rejected: 'Rejected'};
const STATUS = {running: 'Running', paused: 'Paused', stopped: 'Stopped', complete: 'Complete', verification: 'Needs verification', database_blocked: 'Source unavailable', da_blocked: 'Metrics missing', mail_blocked: 'Email check failed', sync: 'Checking sources'};
const RELATIONS = ['New', 'Contacted', 'Follow-up', 'Responded', 'Negotiating', 'Agreed', 'Not a fit'];
const LANG = {any: 'Any language', unknown: 'Unknown', en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', pt: 'Portuguese', nl: 'Dutch', pl: 'Polish', ur: 'Urdu', ar: 'Arabic'};
const PAGE_SIZE = 50;
let state, campaign = '', view = 'opportunities', bucket = 'all', page = 0, selected = new Set(), settingsLoaded = false, busy = false, toastTimer, openId = '', lastJSON = '';

const date = v => v ? new Date(v).toLocaleDateString(undefined, {day: 'numeric', month: 'short', year: 'numeric'}) : 'Not checked';
const time = v => new Date(v).toLocaleTimeString(undefined, {hour: '2-digit', minute: '2-digit'});
const pill = (text, kind = '') => `<span class="pill ${esc(kind)}">${esc(text)}</span>`;
const ext = (u, text, cls = '') => C.url(u) ? `<a href="${esc(C.url(u))}" target="_blank" rel="noopener noreferrer" class="${cls}">${esc(text || u)}</a>` : '';
const types = r => C.uniq((r.opportunities || []).filter(o => !o.recheckPending).flatMap(o => o.types || []));
const queries = r => C.uniq((r.discoveries || []).map(d => d.query));
const best = r => r.bucket === 'rejected' || r.doNotContact ? undefined : (r.emails || []).find(e => e.email === r.bestEmail) || R.usableContacts(r)[0];
const offer = r => (r.opportunities || []).find(o => !o.recheckPending && o.decision === 'qualified') || (r.opportunities || []).find(o => !o.recheckPending);
const age = m => Number.isInteger(m) ? (m >= 12 ? Math.floor(m / 12) + 'y' + (m % 12 ? ' ' + (m % 12) + 'm' : '') : m + 'm') : '';
const traffic = n => Number.isFinite(n) ? n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K' : String(n) : '';
const suffix = r => PublisherDeps.parse(r.domain, {allowPrivateDomains: true}).publicSuffix || '';
const num = id => { const v = $(id).value.trim(); return v === '' ? null : Number(v); };

function toast(message, error = false) { const e = $('#toast'); e.textContent = message; e.classList.toggle('error', error); e.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => e.hidden = true, error ? 9000 : 4500); }
async function send(type, data = {}) { const r = await chrome.runtime.sendMessage({type, ...data}); if (!r?.ok) throw Error(r?.error || 'The extension did not respond. Reload this page.'); return r.value; }
async function action(fn, button) { if (button) button.disabled = true; try { await fn(); await refresh(true); } catch (e) { toast(e.message, true); } finally { if (button) button.disabled = false; } }
const current = () => state?.campaigns.find(c => c.id === state.activeId);
const selectedCampaign = () => state.campaigns.find(c => c.id === campaign);
// Websites still waiting in a campaign's queue are not results; they are shown as a queue count instead.
const campaignRows = () => state.leads.filter(r => (!campaign || r.campaignId === campaign) && r.bucket !== 'unchecked');
const queuedRows = () => state.leads.filter(r => (!campaign || r.campaignId === campaign) && r.bucket === 'unchecked');

/* ---------- Views ---------- */
function changeView(v) { view = v; $$('[data-page]').forEach(e => e.hidden = e.dataset.page !== v); $$('[data-view]').forEach(e => e.classList.toggle('active', e.dataset.view === v)); render(); }

const REASONS = [['verification', 'Verification / CAPTCHA'], ['contacted', 'Already contacted / in your sources'], ['platform', 'Irrelevant platform'], ['directory', 'Directory / list'], ['metrics', 'Metric requirement'], ['irrelevant', 'Irrelevant website'], ['opportunity', 'Not a publisher opportunity'], ['contact', 'No usable contact'], ['you', 'Rejected by you'], ['other', 'Other']];
function reasonOf(r) {
  const code = r.hardReject?.code || '', text = (r.hardReject?.reason || r.decisionReason || '').toLowerCase();
  if (code === 'verification' || /captcha|verification/.test(text)) return 'verification';
  if (['contacted', 'contacted_email', 'mail_history'].includes(code) || /contacted before|emailed|already in|in your sources/.test(text)) return 'contacted';
  if (['platform', 'domain', 'invalid', 'tld'].includes(code) || /platform|community|blocklist|domain extension/.test(text)) return 'platform';
  if (['listicle', 'seller'].includes(code) || /list of guest|lists other websites|link-selling|outreach service/.test(text)) return 'directory';
  if (['da_range', 'metric_range', 'metric_missing', 'da_missing'].includes(code) || /\b(da|dr|spam score|domain age|traffic)\b.*(outside|below|above|not available)/.test(text)) return 'metrics';
  if (['wrong_niche', 'ai_irrelevant', 'language'].includes(code) || /niche|language/.test(text)) return 'irrelevant';
  if (['article', 'closed'].includes(code) || /informational|refuses|closed|not accepting|not a (direct|publisher)/.test(text)) return 'opportunity';
  if (/contact|email|bounce/.test(text)) return 'contact';
  if (r.reviewDecision === 'reject' || r.doNotContact) return 'you';
  return 'other';
}
const missingMetrics = r => !Number.isFinite(r.da) || !Number.isFinite(r.dr) || !Number.isFinite(r.spam) || !Number.isInteger(r.age);
function metricFilters() {
  return {daMin: num('#da-min-filter'), daMax: num('#da-max-filter'), drMin: num('#dr-min-filter'), spamMax: num('#spam-max-filter'), ageMin: num('#age-min-filter'), trafficMin: num('#traffic-min-filter'), hideMissing: $('#hide-missing-filter').checked};
}
function passMetric(value, test, hideMissing) { if (value == null || !Number.isFinite(value)) return !hideMissing; return test(value); }
function filtered() {
  if (!state) return [];
  const term = $('#search').value.toLowerCase().trim(), type = $('#type-filter').value, emailType = $('#email-filter').value, availability = $('#availability-filter').value,
    sort = $('#sort').value, niche = $('#niche-filter').value, language = $('#language-filter').value, keyword = $('#keyword-filter').value,
    tlds = $('#tld-filter').value.toLowerCase().split(/[\s,]+/).map(x => x.replace(/^\./, '')).filter(Boolean), recent = Number($('#recent-filter').value) || 0,
    score = Number($('#score-min-filter').value) || 0, m = bucket === 'rejected' ? {daMin: null, daMax: null, drMin: null, spamMax: null, ageMin: null, trafficMin: null, hideMissing: false} : metricFilters(), reason = $('#reason-filter').value, missingOnly = $('#missing-only-filter').checked, rejectedTab = bucket === 'rejected';
  const rows = campaignRows().filter(r =>
    (bucket === 'all' || r.bucket === bucket) && (!keyword || queries(r).includes(keyword)) &&
    (!rejectedTab || !reason || reasonOf(r) === reason) && (rejectedTab || !missingOnly || missingMetrics(r)) && (rejectedTab || !type || types(r).includes(type)) &&
    (!emailType || R.usableContacts(r).some(e => e.kind === emailType)) &&
    (!availability || availability === 'email' && (r.emails || []).some(e => !e.recheckPending) || availability === 'form' && r.bucket === 'form' || availability === 'none' && !(r.emails || []).some(e => !e.recheckPending)) &&
    (!niche || r.niche === niche) && (!language || r.language === language) &&
    (m.daMin == null || passMetric(r.da, v => v >= m.daMin, m.hideMissing)) && (m.daMax == null || passMetric(r.da, v => v <= m.daMax, m.hideMissing)) &&
    (m.drMin == null || passMetric(r.dr, v => v >= m.drMin, m.hideMissing)) && (m.spamMax == null || passMetric(r.spam, v => v <= m.spamMax, m.hideMissing)) &&
    (m.ageMin == null || passMetric(r.age, v => v >= m.ageMin * 12, m.hideMissing)) && (m.trafficMin == null || passMetric(r.traffic, v => v >= m.trafficMin, m.hideMissing)) &&
    (!tlds.length || tlds.includes(suffix(r))) && (!recent || r.collectedAt && Date.now() - Date.parse(r.collectedAt) <= recent * 86400000) && (r.score || 0) >= score &&
    (!term || [r.domain, r.title, r.campaignName, ...(r.emails || []).map(e => e.email), ...queries(r)].join(' ').toLowerCase().includes(term)));
  const n = v => Number.isFinite(v) ? v : -1;
  const sorters = {domain: (a, b) => a.domain.localeCompare(b.domain), score: (a, b) => (b.score || 0) - (a.score || 0), da: (a, b) => n(b.da) - n(a.da), dr: (a, b) => n(b.dr) - n(a.dr), age: (a, b) => n(b.age) - n(a.age), traffic: (a, b) => n(b.traffic) - n(a.traffic), purpose: (a, b) => R.rank(best(a) || {}) - R.rank(best(b) || {}), recent: (a, b) => (b.collectedAt || b.createdAt || '').localeCompare(a.collectedAt || a.createdAt || '')};
  return rows.sort(sorters[sort] || sorters.recent);
}

function renderTabs() {
  const rows = campaignRows();
  $('#inbox-filters').innerHTML = Object.entries(BUCKETS).map(([k, label]) => `<button class="tab ${bucket === k ? 'active' : ''}" data-bucket="${k}" role="tab" aria-selected="${bucket === k}" type="button">${label}<b>${k === 'all' ? rows.length : rows.filter(r => r.bucket === k).length}</b></button>`).join('');
  const counts = new Map(); for (const r of rows) for (const q of queries(r)) counts.set(q, (counts.get(q) || 0) + 1);
  const kw = $('#keyword-filter'), keep = kw.value;
  kw.innerHTML = `<option value="">All keywords (${counts.size})</option>` + [...counts].sort((a, b) => b[1] - a[1]).map(([q, c]) => `<option value="${esc(q)}">${esc(q.length > 60 ? q.slice(0, 57) + '...' : q)} (${c})</option>`).join('');
  kw.value = counts.has(keep) ? keep : '';
  const nf = $('#niche-filter'), nk = nf.value; nf.innerHTML = '<option value="">Any niche</option>' + C.uniq(rows.map(r => r.niche)).map(n => `<option>${esc(n)}</option>`).join(''); nf.value = nk;
  const rejectedTab = bucket === 'rejected';
  for (const id of ['#type-filter', '#availability-filter', '#metric-pop']) $(id).hidden = rejectedTab;
  $('#reason-filter').hidden = !rejectedTab;
  if (rejectedTab) {
    const counts = {}; for (const r of rows) if (r.bucket === 'rejected') { const k = reasonOf(r); counts[k] = (counts[k] || 0) + 1; }
    const rf = $('#reason-filter'), rk = rf.value;
    rf.innerHTML = '<option value="">All reasons</option>' + REASONS.filter(([k]) => counts[k]).map(([k, label]) => `<option value="${k}">${label} (${counts[k]})</option>`).join('');
    rf.value = counts[rk] ? rk : '';
  }
  const active = Object.entries(metricFilters()).filter(([k, v]) => k !== 'hideMissing' && v != null).length + ($('#missing-only-filter').checked ? 1 : 0);
  $('#metric-count').hidden = !active; $('#metric-count').textContent = active;
}

function metricCell(value, cls, label, r) {
  if (value == null || !Number.isFinite(value)) return r?.metricsStatus === 'missing' ? `<td class="num"><span class="m gone" title="${label} not found, also after Recheck metrics (${date(r.metricsCheckedAt)})">Missing</span></td>` : `<td class="num"><span class="m missing" title="${label} not read yet. Use Recheck metrics.">-</span></td>`;
  return `<td class="num"><span class="m ${cls}" title="${label} ${value}">${value}<i style="--v:${Math.max(0, Math.min(100, value))}%"></i></span></td>`;
}
function renderResults() {
  if (!state) return;
  const rows = filtered();
  selected = new Set([...selected].filter(id => state.leads.some(r => r.id === id)));
  $('#bulk').hidden = !selected.size; $('#selection').textContent = selected.size + ' selected';
  const unselected = rows.filter(r => !selected.has(r.id)).length;
  $('#select-all').hidden = !unselected; $('#select-all').textContent = 'Select all ' + rows.length + ' in this view';
  $('#send-sheet').hidden = !state.output?.endpoint;
  page = Math.min(page, Math.max(0, Math.ceil(rows.length / PAGE_SIZE) - 1));
  $('#pager').innerHTML = rows.length > PAGE_SIZE ? `<div class="pager">${page * PAGE_SIZE + 1}-${Math.min((page + 1) * PAGE_SIZE, rows.length)} of ${rows.length}<button class="btn small" data-page-step="-1" type="button" ${page === 0 ? 'disabled' : ''}>Previous</button><button class="btn small" data-page-step="1" type="button" ${(page + 1) * PAGE_SIZE >= rows.length ? 'disabled' : ''}>Next</button></div>` : '';
  if (!rows.length) {
    $('#results').innerHTML = state.leads.length
      ? `<div class="empty"><h2>No results match these filters</h2><p>Clear a filter or switch campaign to see the rest of your research.</p><div class="actions"><button class="btn" data-reset type="button">Clear filters</button></div></div>`
      : `<div class="empty"><h2>No research yet</h2><p>Connect your history first so contacted domains are skipped, then start a campaign.</p><div class="actions"><button class="btn primary" data-start type="button">New campaign</button><button class="btn" data-go="databases" type="button">Connect sources</button></div></div>`;
    return;
  }
  const slice = rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  $('#results').innerHTML = `<div class="table-wrap"><table><thead><tr><th class="pick"><input type="checkbox" id="select-page" aria-label="Select visible results" ${slice.every(r => selected.has(r.id)) ? 'checked' : ''}></th><th>Website</th><th>${bucket === 'rejected' ? 'Reason' : 'Best contact'}</th><th class="num">Score</th><th class="num">DA</th><th class="num">DR</th><th class="num">Spam</th><th class="num">Age</th><th class="num">Traffic</th><th>Status</th><th></th></tr></thead><tbody>` +
    slice.map(r => {
      const o = offer(r), e = best(r), qs = queries(r);
      const contact = e ? `<span class="email">${esc(e.email)}</span><span class="kind">${esc(e.kind || 'Email')}${R.usableContacts(r).length > 1 ? ', +' + (R.usableContacts(r).length - 1) + ' more' : ''}</span>`
        : `<span class="none">${r.bucket === 'rejected' ? esc(shortReason(r)) : r.forms?.length ? 'Contact form' : 'No useful email'}</span>`;
      const status = r.mailHistory?.length ? pill('Contacted before', 'rejected') : pill(BUCKETS[r.bucket] || 'Review', r.bucket);
      return `<tr data-detail="${esc(r.id)}" class="${selected.has(r.id) ? 'selected' : ''}"><td class="pick"><input type="checkbox" data-select="${esc(r.id)}" aria-label="Select ${esc(r.domain)}" ${selected.has(r.id) ? 'checked' : ''}></td>
        <td><div class="site">${ext(r.website, r.domain, 'domain')}<span class="page" title="${esc(o?.title || r.title || '')}">${esc(o?.title || r.title || 'Page not researched')}</span><span class="kw" title="${esc(qs.join(', '))}">${esc(campaign ? (qs[0] || 'Manual URL') : (r.campaignName || r.niche))}</span></div></td>
        <td><div class="contact">${contact}</div></td>
        <td class="num"><span class="score ${r.score >= 70 ? 'high' : r.score >= 40 ? 'medium' : 'low'}" title="${esc((r.scoreReasons || []).map(x => x.label + ' +' + x.points).join(', '))}">${r.score || 0}</span></td>
        ${metricCell(r.da, 'da', 'DA', r)}${metricCell(r.dr, 'dr', 'DR', r)}
        <td class="num ${r.spam >= 30 ? 'spam-high' : ''}">${Number.isFinite(r.spam) ? r.spam + '%' : r.metricsStatus === 'missing' ? '<span class="m gone">Missing</span>' : '<span class="m missing">-</span>'}</td>
        <td class="num">${age(r.age) || (r.metricsStatus === 'missing' ? '<span class="m gone">Missing</span>' : '<span class="m missing">-</span>')}</td>
        <td class="num">${traffic(r.traffic) || '<span class="m missing">-</span>'}</td>
        <td>${status}<span class="rel">${esc(r.doNotContact ? 'Do not contact' : r.dealStatus || 'New')}${r.sheetSentAt ? ', in Sheet' : ''}</span></td>
        <td><span class="chev" aria-hidden="true">&rsaquo;</span></td></tr>`;
    }).join('') + '</tbody></table></div>';
}
function shortReason(r) { const t = r.hardReject?.reason || r.decisionReason || 'Rejected'; return t.length > 70 ? t.slice(0, 67) + '...' : t; }

function renderReport() {
  const select = $('#campaign-filter');
  select.innerHTML = '<option value="">All campaigns</option>' + state.campaigns.map(c => `<option value="${esc(c.id)}">${esc(c.name || c.niche || 'Imported campaign')}</option>`).join('');
  select.value = campaign;
  const rows = campaignRows(), c = selectedCampaign(), scored = rows.filter(r => r.collectedAt), avg = scored.length ? Math.round(scored.reduce((a, r) => a + (r.score || 0), 0) / scored.length) : 0;
  const stats = c
    ? [['Ready', c.stats.ready || 0, 'good'], ['Form only', c.stats.form || 0], ['Researched', c.stats.researched || 0], ['Skipped: history', (c.stats.contacted || 0) + (c.stats.database || 0)], ['Skipped: filters', (c.stats.daRejected || 0) + (c.stats.tldRejected || 0)], ['Avg. score', avg]]
    : [['Ready', rows.filter(r => r.bucket === 'ready').length, 'good'], ['Websites', new Set(rows.map(r => r.domain)).size], ['Campaigns', state.campaigns.length], ['Avg. score', avg]];
  const criteria = c ? [
    c.niche, LANG[c.researchLanguage] || 'Any language',
    c.requestedDA ? metricText(c) + (c.daBypass ? ' (continued without filters)' : '') : 'No metric filters',
    c.tlds?.length ? c.tlds.map(x => '.' + x).join(', ') : '',
    'Sources ' + (c.checkDatabase !== false ? 'on' : 'off'), 'Contacted ' + (c.checkContacted !== false ? 'on' : 'off'),
    c.checkMail ? 'Sent mail: ' + (c.mailAccountIds || []).length + ' account(s)' : '', (c.parallel || 5) + ' sites at once',
    c.useGemini ? (c.aiDisabledReason ? 'Gemini off: ' + c.aiDisabledReason : 'Gemini on') : ''
  ].filter(Boolean) : [];
  const queued = c ? (c.queued || 0) : queuedRows().length;
  const waiting = c ? (queued && c.status !== 'running' ? c : null) : state.campaigns.filter(x => x.queued && x.status !== 'running').sort((a, b) => b.queued - a.queued)[0];
  $('#campaign-report').innerHTML = stats.map(([k, v, cls]) => `<div class="stat ${cls || ''}"><b>${v}</b><span>${k}</span></div>`).join('') +
    (queued ? `<div class="stat queue"><b>${queued}</b><span>In queue${c && c.status === 'running' ? '' : ', not researched'}</span></div>` : '') +
    (!c && waiting ? `<div class="report-actions"><button class="btn small accent-btn" data-research-queue="${esc(waiting.id)}" type="button">Research ${waiting.queued} waiting in ${esc(waiting.name || waiting.niche)}</button></div>` : '') +
    (c ? `<div class="report-actions">${pill(STATUS[c.status] || c.status, c.status === 'complete' ? 'ok' : c.status === 'running' ? '' : 'warn')}<button class="btn small" data-duplicate="${esc(c.id)}" type="button">Duplicate</button>${c.queued && c.status !== 'running' ? `<button class="btn small accent-btn" data-research-queue="${esc(c.id)}" type="button">Research ${c.queued} waiting</button>` : ''}${c.status !== 'complete' ? `<button class="btn small" data-campaign-command="${c.status === 'running' ? 'PUB_PAUSE' : 'PUB_RESUME'}" data-campaign-id="${esc(c.id)}" type="button">${c.status === 'running' ? 'Pause' : 'Resume'}</button>` : ''}${queued && c.status !== 'running' ? `<button class="btn small accent-btn" data-research-queue="${esc(c.id)}" type="button">Research ${queued} waiting</button>` : ''}</div><div class="criteria">${criteria.map(x => pill(x)).join('')}</div>` : '');
}
function metricText(c) {
  const parts = [];
  if (c.daMin != null || c.daMax != null) parts.push('DA ' + (c.daMin ?? 0) + '-' + (c.daMax ?? 100));
  if (c.drMin != null) parts.push('DR ' + c.drMin + '+'); if (c.spamMax != null) parts.push('Spam up to ' + c.spamMax + '%');
  if (c.ageMinMonths != null) parts.push('Age ' + Math.round(c.ageMinMonths / 12 * 10) / 10 + 'y+'); if (c.trafficMin != null) parts.push('Traffic ' + traffic(c.trafficMin) + '+');
  return parts.join(', ') || 'DA shown';
}

function renderRun() {
  const c = current(), box = $('#run'), mr = state.metricRun, metricBox = mr && mr.status === 'running' ? `<div class="run-sub"><div class="run-head"><strong>Rechecking metrics</strong><span class="run-state">${mr.done}/${mr.total}</span></div><div class="meter"><i style="width:${mr.done / Math.max(1, mr.total) * 100}%"></i></div><p class="run-msg">${mr.updated} updated, ${mr.missing} still missing, ${mr.parallel} at a time.</p>${mr.note ? `<p class="run-msg">${esc(mr.note)}</p>` : ''}<div class="actions"><button class="btn" id="metrics-stop" type="button">Stop recheck</button></div></div>` : '';
  const showCampaign = c && !['complete', 'stopped'].includes(c.status);
  box.hidden = !showCampaign && !metricBox;
  if (box.hidden) return;
  if (!showCampaign) { box.innerHTML = metricBox; return; }
  const n = c.contactGoal === 'form' ? c.stats.form : c.contactGoal === 'any' || c.includeForms ? c.stats.ready + c.stats.form : c.stats.ready;
  const warn = c.status !== 'running', jobs = c.jobs || [];
  box.innerHTML = `<div class="run-head"><strong title="${esc(c.name)}">${esc(c.name || c.niche)}</strong><span class="run-state ${warn ? 'warn' : ''}">${esc(STATUS[c.status] || c.status)}</span></div>
    <div class="run-count"><b>${n}</b>of ${c.target} ready</div><div class="meter"><i style="width:${Math.min(100, n / Math.max(1, c.target) * 100)}%"></i></div>
    ${jobs.length ? `<div class="jobs">${jobs.map(j => `<div class="job ${j.parked ? 'parked' : ''}"><i class="pulse"></i><span title="${esc(j.url)}">${esc(j.domain)}${j.parked ? ' (verify)' : ''}</span>${j.parked ? `<button data-open-tab="research" data-domain="${esc(j.domain)}" type="button">Open</button>` : ''}<button data-skip="${esc(j.domain)}" type="button">Skip</button></div>`).join('')}</div>` : ''}
    <p class="run-msg">${esc(c.message || '')}</p>
    <div class="actions"><button class="btn" data-command="${c.status === 'running' ? 'PUB_PAUSE' : 'PUB_RESUME'}" type="button">${c.status === 'running' ? 'Pause' : 'Resume'}</button>${['verification', 'paused', 'da_blocked'].includes(c.status) && (c.verificationKind === 'search' || !jobs.length) ? '<button class="btn" data-open-tab="search" type="button">Open Google tab</button><button class="btn" data-command="PUB_SKIP" type="button">Skip keyword</button>' : ''}<button class="btn" data-command="PUB_STOP" type="button">Stop</button></div>${metricBox}`;
}
function renderMoz() { const c = current(), d = $('#moz-dialog'); if (c?.status === 'da_blocked') { $('#moz-message').textContent = c.message; if (!d.open) d.showModal(); } else if (d.open) d.close(); }

function renderCampaigns() {
  const list = state.campaigns.filter(c => !campaign || c.id === campaign);
  $('#campaign-list').innerHTML = list.length ? list.map(c => `<article class="camp">
    <div class="camp-head"><div><h2>${esc(c.name || c.niche)}</h2><p>${date(c.createdAt)}, ${c.manual ? 'own website list' : c.queries.length + ' keywords'}, ${esc(c.message || '')}</p></div>
      <div class="actions">${pill(STATUS[c.status] || c.status, c.status === 'complete' ? 'ok' : 'warn')}<button class="btn small" data-report="${esc(c.id)}" type="button">View results</button><button class="btn small" data-duplicate="${esc(c.id)}" type="button">Duplicate</button>${c.queued && c.status !== 'running' ? `<button class="btn small accent-btn" data-research-queue="${esc(c.id)}" type="button">Research ${c.queued} waiting</button>` : ''}${c.status !== 'complete' ? `<button class="btn small" data-campaign-command="${c.status === 'running' ? 'PUB_PAUSE' : 'PUB_RESUME'}" data-campaign-id="${esc(c.id)}" type="button">${c.status === 'running' ? 'Pause' : 'Resume'}</button>` : ''}</div></div>
    <div class="camp-stats">${[['Ready', c.stats.ready], ['Form only', c.stats.form], ['In queue', c.queued || 0], ['Researched', c.stats.researched], ['Unique domains', c.stats.unique], ['Skipped: contacted', c.stats.contacted], ['Skipped: in sources', c.stats.database], ['Skipped: metrics', c.stats.daRejected], ['Skipped: title/niche', (c.stats.titleRejected || 0) + (c.stats.wrongNiche || 0)], ['Google pages', c.stats.searchPages]].map(([k, v]) => `<div><b>${v || 0}</b><span>${k}</span></div>`).join('')}</div>
    <details><summary>Keyword performance</summary><div class="table-wrap"><table><thead><tr><th>Keyword</th><th class="num">Pages</th><th class="num">Links</th><th class="num">Rejected</th><th class="num">Queued</th><th class="num">Ready</th></tr></thead><tbody>${Object.entries(c.queryStats || {}).map(([q, d]) => `<tr><td>${esc(q)}</td><td class="num">${d.pages || 0}</td><td class="num">${d.links || 0}</td><td class="num">${d.rejected || 0}</td><td class="num">${d.queued || 0}</td><td class="num">${d.ready || 0}</td></tr>`).join('') || '<tr><td colspan="6">No keywords searched yet.</td></tr>'}</tbody></table></div></details>
    <details><summary>Skipped websites and why (${c.skips?.length || 0})</summary><div class="table-wrap"><table><tbody>${(c.skips || []).slice(0, 300).map(x => `<tr><td>${esc(x.domain)}</td><td>${esc(x.reason)}</td></tr>`).join('') || '<tr><td>Nothing skipped.</td></tr>'}</tbody></table></div></details>
    <details><summary>Activity log</summary>${(c.events || []).map(e => `<div class="event"><time>${time(e.at)}</time><span>${esc(e.message)}</span></div>`).join('')}</details>
  </article>`).join('') : '<div class="empty"><h2>No campaigns yet</h2><p>Each campaign keeps its own keywords, criteria, progress and skip reasons.</p><div class="actions"><button class="btn primary" data-start type="button">New campaign</button></div></div>';
}

function renderSources() {
  const o = state.output || {};
  $('#output-pill').textContent = o.endpoint ? (o.status || 'Not tested') : 'Not connected';
  $('#output-pill').className = 'pill ' + (o.status === 'Connected' ? 'ok' : o.status === 'Error' ? 'error' : o.endpoint ? 'warn' : '');
  $('#sheet-mode').value = state.settings.sheetMode || 'manual';
  $('#output-status').textContent = o.endpoint ? `${o.account ? o.account + '. ' : ''}${o.pendingIds?.length || 0} results waiting to sync${o.lastSyncedAt ? ', last checked ' + date(o.lastSyncedAt) : ''}.${o.error ? ' ' + o.error : ''}` : 'Not connected in this Chrome profile. Restoring a backup does not bring the Apps Script URL back; paste it again.';
  $('#output-status').classList.toggle('bad', o.status === 'Error' || (!o.endpoint && !!o.status && o.status !== 'Not connected'));
  if (document.activeElement !== $('#output-endpoint')) $('#output-endpoint').value = o.endpoint || '';
  $('#mail-history').checked = !!state.settings.mailHistory;
  const accounts = state.mailAccounts || [];
  $('#mail-list').innerHTML = accounts.length ? accounts.map(a => `<div class="row"><div class="grow"><strong>${esc(a.label)}</strong><span>${esc(a.email || 'Account')}, URL ${esc(a.endpointHint)}${a.hasSecret ? ', with secret' : ''}</span>${a.error ? `<span class="err">${esc(a.error)}</span>` : ''}</div>${pill(a.status || 'Connected', a.status === 'Error' ? 'error' : 'ok')}<button class="btn small" data-mail-test="${esc(a.id)}" type="button">Test</button><button class="link danger" data-mail-remove="${esc(a.id)}" type="button">Remove</button></div>`).join('') : '<p class="hint">No accounts yet. Add the URL of each Gmail account you send outreach from.</p>';
  $('#db-count').textContent = state.databases.length + ' sources';
  $('#db-list').innerHTML = state.databases.length ? state.databases.map(d => `<div class="row"><div class="grow"><strong>${esc(d.name)}</strong><span>${d.kind === 'output' ? 'Output Sheet history' : d.kind === 'sheet' ? 'Public Google Sheet' : 'Uploaded file'}: ${(d.count || 0).toLocaleString()} domains, ${(d.contactedCount || 0).toLocaleString()} contacted, ${d.tabs?.length || 0} tabs, checked ${date(d.lastSyncedAt)}</span>${d.error ? `<span class="err">${esc(d.error)}</span>` : ''}</div>${pill(d.status === 'ready' ? 'Ready' : d.status === 'error' ? 'Error' : 'Not checked', d.status === 'ready' ? 'ok' : d.status === 'error' ? 'error' : 'warn')}${d.kind !== 'file' ? `<button class="btn small" data-sync="${esc(d.id)}" type="button">Refresh</button>` : ''}${d.kind === 'sheet' ? ext(d.url, 'Open', 'link') : ''}${d.kind !== 'output' ? `<button class="link" data-rename="${esc(d.id)}" type="button">Rename</button><button class="link danger" data-remove="${esc(d.id)}" type="button">Remove</button>` : ''}</div>`).join('') : '<p class="hint">No sources yet.</p>';
}

function renderSettings() {
  if (settingsLoaded) return;
  const f = $('#settings'), st = state.settings;
  for (const k of ['name', 'email', 'company', 'website', 'subject', 'message']) f.elements[k].value = st.sender?.[k] || '';
  f.elements.blocklist.value = (st.blocklist || []).join('\n'); f.elements.excludePlatforms.checked = st.excludePlatforms !== false; f.elements.researchUnclear.checked = !!st.researchUnclear;
  f.elements.ai.checked = !!st.aiQueries; f.elements.geminiModel.value = st.geminiModel || 'gemini-3.1-flash-lite'; f.elements.parallel.value = String(st.parallel || 5);
  $('#key-state').textContent = state.hasKey ? 'saved' : 'not set';
  settingsLoaded = true;
}
function renderSenders() {
  $('#sender-list').innerHTML = (state.senderProfiles || []).map(p => `<div class="row"><div class="grow"><strong>${esc(p.label)}</strong><span>${esc(p.name)} ${esc(p.email)}</span></div><button class="link danger" data-sender-remove="${esc(p.id)}" type="button">Remove</button></div>`).join('') || '<p class="hint">No profiles yet.</p>';
}

function render() {
  if (!state) return;
  renderRun(); renderMoz();
  if (view === 'opportunities') { renderReport(); renderTabs(); renderResults(); }
  if (view === 'searches') renderCampaigns();
  if (view === 'databases') renderSources();
  if (view === 'preferences') { renderSettings(); renderSenders(); }
}
async function refresh(force = false) {
  if (busy) return; busy = true;
  try {
    const next = await send('PUB_GET'), text = JSON.stringify(next), mine = chrome.runtime.getManifest?.().version;
    if (force || text !== lastJSON) { lastJSON = text; state = next; render(); if (openId && $('#detail-dialog').open) detail(openId, true); }
    // The dashboard and the background engine must be the same version. An old engine keeps running until the extension is reloaded.
    if (mine && next.engine !== mine) { $('#error-banner').textContent = `The background engine is out of date (engine ${next.engine || 'before 0.9'}, dashboard ${mine}). Open chrome://extensions, click Reload on Outreach Desk, then reopen this page. Until then new features will fail.`; $('#error-banner').hidden = false; }
    else $('#error-banner').hidden = true;
    $('#engine-version').textContent = 'v' + (next.engine || '?');
  }
  catch (e) { $('#error-banner').textContent = e.message; $('#error-banner').hidden = false; }
  finally { busy = false; }
}

/* ---------- New / duplicate campaign ---------- */
function openCampaign(from) {
  if (!state) return;
  const f = $('#search-form'); f.reset();
  $('#search-title').textContent = from ? 'Duplicate campaign' : 'New campaign';
  f.elements.senderId.innerHTML = '<option value="">Default details</option>' + (state.senderProfiles || []).map(p => `<option value="${esc(p.id)}">${esc(p.label)} (${esc(p.email)})</option>`).join('');
  f.elements.useGemini.checked = !!state.settings.aiQueries; f.elements.parallel.value = String(state.settings.parallel || 5);
  $('#topic-chips').innerHTML = ''; $('#query-note').textContent = ''; $('#da-status').textContent = 'Leave empty to research without metric filters.';
  const accounts = state.mailAccounts || [];
  $('#mail-choice').innerHTML = state.settings.mailHistory && accounts.length ? `<strong>Check sent mail in</strong><div class="accounts">${accounts.map(a => `<label class="check"><input type="checkbox" name="mailAccount" value="${esc(a.id)}" ${!from || (from.mailAccountIds || []).includes(a.id) ? 'checked' : ''}> ${esc(a.label)}${a.email && a.email !== a.label ? ' (' + esc(a.email) + ')' : ''}</label>`).join('')}</div>` : '';
  const dbs = state.databases.length, mail = state.settings.mailHistory ? accounts.length : 0;
  $('#source-check').textContent = dbs || mail ? `${dbs} source(s)${mail ? ' and ' + mail + ' email account(s)' : ''} are checked before any website is opened.` : 'No history connected. Add your Output Sheet or email accounts in Sources to skip domains you already contacted.';
  if (from) {
    const set = (k, v) => { if (f.elements[k] && v != null) f.elements[k].value = v; };
    set('niche', from.niche); set('campaignName', (from.name || from.niche) + ' (copy)'); set('researchLanguage', from.researchLanguage); set('target', from.target); set('contactGoal', from.contactGoal || 'email');
    set('senderId', from.senderId || ''); set('subtopics', from.subtopics); f.elements.relatedTopics.checked = !!from.relatedTopics; f.elements.useGemini.checked = !!from.useGemini;
    if (from.manual) { set('urls', ''); } else set('queries', (from.queries || []).join('\n'));
    set('daMin', from.daMin); set('daMax', from.daMax); set('drMin', from.drMin); set('spamMax', from.spamMax); set('ageMinYears', from.ageMinMonths != null ? from.ageMinMonths / 12 : null); set('trafficMin', from.trafficMin);
    set('onVerification', from.onVerification || 'skip'); set('missingMetric', from.missingMetric || 'keep'); set('tlds', (from.tlds || []).join(', ')); set('parallel', from.parallel); set('maxPages', from.maxPages); set('budget', from.budget); set('pageLimit', from.pageLimit);
    f.elements.checkDatabase.checked = from.checkDatabase !== false; f.elements.checkContacted.checked = from.checkContacted !== false;
    loadTopics();
  }
  $('#search-dialog').showModal();
}
let topicsTimer;
async function loadTopics() {
  const f = $('#search-form'), niche = f.elements.niche.value.trim();
  if (!niche) { $('#topic-chips').innerHTML = ''; return; }
  try {
    const chosen = f.elements.subtopics.value.split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
    const list = await send('PUB_TOPICS', {niche});
    $('#topic-chips').innerHTML = list.map(x => `<button type="button" class="chip ${chosen.includes(x.term.toLowerCase()) ? 'selected' : ''}" data-topic="${esc(x.term)}">${esc(x.term)} <small>${esc(x.kind)}</small></button>`).join('') || '<span class="hint">No suggestions for this niche. Type your own topics.</span>';
  } catch (e) { $('#topic-chips').textContent = e.message; }
}

/* ---------- Detail drawer ---------- */
function contactHTML(r, e) {
  const usable = R.usableContacts(r).some(x => x.email === e.email);
  const kind = e.override === 'include' ? 'ready' : e.override === 'exclude' ? 'rejected' : e.suitability === 'recommended' ? 'ready' : e.suitability === 'excluded' ? 'rejected' : 'review';
  return `<div class="mail ${e.suitability === 'excluded' ? 'excluded' : ''}"><div class="mail-top"><strong>${esc(e.email)}</strong>${pill(e.kind || 'Email', kind)}</div>
    <p>${esc(e.reason || '')}${e.mx === 'none' ? ' No mail server found for this domain.' : ''}${e.contacted ? ' Contacted before.' : ''}${e.databaseDuplicate ? ' Already in your sources.' : ''}${e.recheckPending ? ' Not seen during the latest recheck.' : ''}</p>
    ${e.context ? `<div class="quote">${esc(e.context)}</div>` : ''}
    <div class="actions">${ext(e.source, 'Where it was found', 'link')}<button class="btn small" data-copy="${esc(e.email)}" type="button">Copy</button><button class="btn small" data-primary="${esc(e.email)}" data-lead="${esc(r.id)}" type="button" ${!usable ? 'disabled' : ''}>${r.bestEmail === e.email ? 'Primary contact' : 'Make primary'}</button>
    <select aria-label="Decision for ${esc(e.email)}" data-contact-override="${esc(e.email)}" data-lead="${esc(r.id)}">${[['auto', 'Use detected purpose'], ['include', 'Include for outreach'], ['exclude', 'Exclude']].map(([v, t]) => `<option value="${v}" ${(e.override || 'auto') === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div></div>`;
}
function detail(id, keepScroll = false) {
  const r = state.leads.find(x => x.id === id); if (!r) return;
  openId = id;
  const body = $('#detail-body'), scroll = keepScroll ? $('#detail-dialog').scrollTop : 0;
  const useful = R.usableContacts(r), other = (r.emails || []).filter(e => !useful.includes(e));
  const metric = (label, v) => `<div><b>${v || '-'}</b><span>${label}</span></div>`;
  const t = r.terms, termPills = t ? [t.pricing === 'paid' ? pill('Paid placement', 'warn') : t.pricing === 'free' ? pill('Free contribution', 'ok') : '', t.links === 'dofollow' ? pill('Dofollow links', 'ok') : t.links === 'nofollow' ? pill('Nofollow links', 'warn') : t.links === 'none' ? pill('No links allowed', 'rejected') : ''].join('') : '';
  body.innerHTML = `<div class="d-head"><div class="d-top"><div><h2>${esc(r.domain)}</h2><div class="d-meta">${r.mailHistory?.length ? pill('Contacted before', 'rejected') : pill(BUCKETS[r.bucket] || 'Review', r.bucket)}<span class="score ${r.score >= 70 ? 'high' : r.score >= 40 ? 'medium' : 'low'}">${r.score || 0}/100</span>${ext(r.website, 'Open website', 'link')}</div></div><button class="icon-btn" data-close="detail-dialog" type="button" aria-label="Close" autofocus>&times;</button></div>
    <div class="d-metrics">${metric('DA', r.da)}${metric('DR', r.dr)}${metric('Spam', Number.isFinite(r.spam) ? r.spam + '%' : '')}${metric('Age', age(r.age))}${metric('Traffic', traffic(r.traffic))}${metric('Language', LANG[r.language] || 'Unknown')}</div></div>
    ${r.mailHistory?.length ? `<div class="d-sec"><h3>Contact history</h3>${r.mailHistory.map(h => `<div class="callout bad">Emailed <b>${esc(h.to)}</b> from <b>${esc(h.account)}</b>${h.date ? ' on ' + date(h.date) : ''}.</div>`).join('')}</div>` : ''}
    <div class="d-sec"><h3>Decision <small>${esc(r.campaignName || r.niche || '')}</small></h3>
      <div class="callout ${r.bucket === 'ready' ? 'good' : r.bucket === 'rejected' ? 'bad' : 'warn'}">${esc(r.hardReject?.reason || r.decisionReason || 'Not researched yet')}</div>
      ${termPills || t?.requirements ? `<div class="terms">${termPills}</div>${t?.requirements ? `<p>${esc(t.requirements)}</p>` : ''}${(t?.evidence || []).map(q => `<div class="quote">${esc(q)}</div>`).join('')}` : ''}
      ${(r.scoreReasons || []).length ? `<div class="terms">${r.scoreReasons.map(x => pill(x.label + ' +' + x.points)).join('')}</div>` : ''}
      <div class="actions"><button class="btn small" data-decision="approve" data-lead="${esc(id)}" type="button">Approve</button><button class="btn small" data-decision="reject" data-lead="${esc(id)}" type="button">Reject</button><button class="btn small" data-decision="auto" data-lead="${esc(id)}" type="button">Use detected decision</button><button class="btn small" data-recheck="${esc(id)}" type="button">Recheck website</button></div>
      <p class="hint">First found ${date(r.createdAt)}, last checked ${date(r.collectedAt)}, ${r.pagesRead || 0} pages read.${r.incompleteReason ? ' ' + esc(r.incompleteReason) : ''}</p></div>
    <div class="d-sec"><h3>Outreach contacts <small>${useful.length} useful</small></h3>
      ${useful.map(e => contactHTML(r, e)).join('') || '<p class="hint">No suitable outreach email confirmed.</p>'}
      ${r.forms?.length ? `<div class="actions">${ext(r.forms[0], 'Contact form', 'link')}<button class="btn small" data-prefill="${esc(id)}" type="button">Prepare form</button><span class="hint">You review and submit it yourself.</span></div>` : ''}
      ${other.length ? `<details class="help"><summary>Excluded or unclassified (${other.length})</summary><div class="stack" style="margin-top:8px">${other.map(e => contactHTML(r, e)).join('')}</div></details>` : ''}</div>
    <div class="d-sec"><h3>Publisher evidence</h3>
      ${(r.opportunities || []).map(o => `<div class="offer"><strong>${esc(o.title || o.htmlTitle || o.url)}</strong><div class="d-meta">${pill(o.recheckPending ? 'Previous evidence' : o.decision, o.recheckPending ? 'review' : o.decision === 'qualified' ? 'ok' : o.decision === 'reject' ? 'rejected' : 'review')}${(o.types || []).map(x => pill(x)).join('')}</div><p class="hint">${esc(o.reason || '')}</p>${o.evidence ? `<div class="quote">${esc(o.evidence)}</div>` : ''}${o.refusalEvidence ? `<p class="hint">Closed routes: ${esc((o.closedTypes || []).join(', '))}</p><div class="quote">${esc(o.refusalEvidence)}</div>` : ''}<p class="hint">Topic evidence: ${o.topic?.terms?.length ? esc(o.topic.terms.join(', ')) : 'not confirmed'}</p>${ext(o.url, 'Read the page', 'link')}</div>`).join('') || `<p class="hint">${esc(r.screenReason || 'Not researched yet.')}</p>`}
      ${r.aiAssessment ? `<p class="hint">Gemini: ${esc(r.aiAssessment.reason || '')} (${r.aiAssessment.confidence}% confident)</p>` : ''}</div>
    <div class="d-sec"><h3>Your notes</h3><form id="notes" data-id="${esc(id)}" class="stack"><div class="form-grid"><label>Relationship<select name="dealStatus">${RELATIONS.map(x => `<option ${r.dealStatus === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label><label class="check" style="align-self:end"><input name="doNotContact" type="checkbox" ${r.doNotContact ? 'checked' : ''}> Do not contact</label></div><label>Notes<textarea name="notes" rows="3">${esc(r.notes)}</textarea></label><div class="actions"><button class="btn primary" type="submit">Save</button></div></form></div>
    <div class="d-sec"><h3>Found with <small>${r.discoveries?.length || 0}</small></h3>${(r.discoveries || []).map(d => `<div class="hist"><time>${date(d.at)}</time><span>${esc(d.query)}: ${ext(d.url, d.title || d.url, 'link')}</span></div>`).join('')}</div>
    <div class="d-sec"><h3>History</h3>${(r.history || []).map(h => `<div class="hist"><time>${date(h.at)}</time><span>${esc(BUCKETS[h.decision] || h.decision)}: ${esc(h.reason)}</span></div>`).join('') || '<p class="hint">Not researched yet.</p>'}</div>`;
  if (!$('#detail-dialog').open) $('#detail-dialog').showModal();
  $('#detail-dialog').scrollTop = scroll;
}
async function updateDetail(fn, b) { await action(async () => { await fn(); }, b); }

/* ---------- Helpers ---------- */
function selectedRows() { const rows = filtered(); return selected.size ? state.leads.filter(r => selected.has(r.id)) : rows; }
function download(name, data, type) { const u = URL.createObjectURL(new Blob([data], {type})), a = document.createElement('a'); a.href = u; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(u), 30000); }
function resetFilters() {
  bucket = 'all'; page = 0; selected.clear(); $('#search').value = '';
  for (const id of ['type-filter', 'email-filter', 'availability-filter', 'keyword-filter', 'niche-filter', 'da-min-filter', 'da-max-filter', 'dr-min-filter', 'spam-max-filter', 'age-min-filter', 'traffic-min-filter', 'tld-filter', 'language-filter', 'recent-filter', 'score-min-filter']) $('#' + id).value = '';
  $('#hide-missing-filter').checked = false; $('#missing-only-filter').checked = false; $('#reason-filter').value = ''; render();
}

/* ---------- Events ---------- */
document.addEventListener('click', e => {
  const pop = e.target.closest('details.pop'); for (const d of $$('details.pop[open]')) if (d !== pop) d.open = false;
  const row = e.target.closest('tr[data-detail]');
  if (row && !e.target.closest('input,a,button,select')) { detail(row.dataset.detail); return; }
  const b = e.target.closest('button'); if (!b) return;
  const d = b.dataset;
  if (d.view) changeView(d.view);
  if (d.report) { campaign = d.report; page = 0; changeView('opportunities'); }
  if (d.go) changeView(d.go);
  if (b.id === 'new-search' || b.hasAttribute('data-start')) openCampaign();
  if (d.duplicate) openCampaign(state.campaigns.find(c => c.id === d.duplicate));
  if (d.close) $('#' + d.close).close();
  if (d.bucket) { bucket = d.bucket; page = 0; selected.clear(); render(); }
  if (d.pageStep) { page += Number(d.pageStep); renderResults(); }
  if (b.id === 'reset-filters' || b.hasAttribute('data-reset')) resetFilters();
  if (b.id === 'clear-selection') { selected.clear(); renderResults(); }
  if (b.id === 'select-all') { for (const r of filtered()) selected.add(r.id); renderResults(); }
  if (b.id === 'metrics-stop') action(() => send('PUB_METRICS_STOP'), b);
  if (b.id === 'send-sheet') action(async () => { const r = await send('PUB_SEND_SHEET', {ids: [...selected]}); toast(r.sent + ' results sent to your Sheet.'); selected.clear(); }, b);
  if (b.id === 'recheck-metrics') action(async () => { const r = await send('PUB_RECHECK_METRICS', {ids: [...selected], parallel: 5}); toast('Rechecking metrics for ' + r.queued + ' websites, 5 at a time. Keep Chrome open.'); selected.clear(); }, b);
  if (b.id === 'delete-selected') action(async () => { const n = selected.size; if (!confirm('Delete ' + n + ' selected result' + (n > 1 ? 's' : '') + '? Only these rows are removed. Results in other campaigns stay.')) return; const r = await send('PUB_DELETE', {ids: [...selected]}); toast(r.deleted + ' deleted.'); selected.clear(); }, b);
  if (d.campaignCommand) action(() => send(d.campaignCommand, {campaignId: d.campaignId}), b);
  if (d.researchQueue) action(async () => { const r = await send('PUB_RESEARCH_QUEUE', {campaignId: d.researchQueue}); toast('Researching ' + r.queued + ' waiting websites.'); }, b);
  if (d.command) action(() => send(d.command), b);
  if (d.skip) action(() => send('PUB_SKIP', {domain: d.skip}), b);
  if (d.openTab) action(() => send('PUB_OPEN_TAB', {kind: d.openTab, domain: d.domain}), b);
  if (d.copy) action(async () => { await navigator.clipboard.writeText(d.copy); toast('Email copied.'); }, b);
  if (d.decision) updateDetail(() => send('PUB_UPDATE_LEAD', {id: d.lead, reviewDecision: d.decision}), b);
  if (d.primary) updateDetail(() => send('PUB_UPDATE_LEAD', {id: d.lead, selectedEmail: d.primary}), b);
  if (d.recheck) action(async () => { await send('PUB_RECHECK', {id: d.recheck}); $('#detail-dialog').close(); toast('Recheck started as a separate report.'); }, b);
  if (d.prefill) action(async () => { const r = await send('PUB_PREFILL', {id: d.prefill}); toast(`${r.filled} fields prepared. ${r.message}`); }, b);
  if (d.sync) action(async () => { await send('PUB_SYNC_DB', {id: d.sync}); toast('Source refreshed.'); }, b);
  if (d.rename) action(async () => { const db = state.databases.find(x => x.id === d.rename), name = prompt('Source name', db.name); if (name) await send('PUB_RENAME_DB', {id: db.id, name}); }, b);
  if (d.remove) action(async () => { if (confirm('Remove this source from history checks?')) await send('PUB_DELETE_DB', {id: d.remove}); }, b);
  if (d.senderRemove) action(() => send('PUB_SENDER_DELETE', {id: d.senderRemove}), b);
  if (d.mailTest) action(async () => { const r = await send('PUB_MAIL_TEST', {id: d.mailTest}); toast('Connected: ' + (r.email || 'account')); }, b);
  if (d.mailRemove) action(async () => { if (confirm('Remove this email account?')) await send('PUB_MAIL_REMOVE', {id: d.mailRemove}); }, b);
  const chip = e.target.closest('[data-topic]');
  if (chip) {
    const input = $('#search-form').elements.subtopics, term = chip.dataset.topic, list = input.value.split(',').map(x => x.trim()).filter(Boolean);
    const has = list.some(x => x.toLowerCase() === term.toLowerCase());
    input.value = (has ? list.filter(x => x.toLowerCase() !== term.toLowerCase()) : [...list, term]).join(', ');
    chip.classList.toggle('selected', !has); if (!has) $('#search-form').elements.relatedTopics.checked = true;
  }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.select) { if (t.checked) selected.add(t.dataset.select); else selected.delete(t.dataset.select); renderResults(); }
  if (t.id === 'select-page') { for (const r of filtered().slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)) if (t.checked) selected.add(r.id); else selected.delete(r.id); renderResults(); }
  if (t.dataset.contactOverride) updateDetail(() => send('PUB_EMAIL_OVERRIDE', {id: t.dataset.lead, email: t.dataset.contactOverride, value: t.value}), t);
  if (t.id === 'bulk-status' && t.value) { const v = t.value; t.value = ''; action(async () => { const r = await send('PUB_BULK', {ids: [...selected], ...(v === 'dnc' ? {doNotContact: true} : {dealStatus: v})}); toast(r.changed + ' results updated.'); }); }
  if (t.id === 'sheet-mode') action(async () => { const r = await send('PUB_SHEET_MODE', {mode: t.value}); toast(r.mode === 'auto' ? 'Qualifying results will be sent to the Sheet automatically.' : 'Sheet export is manual: select results and click Send to Sheet.'); });
  if (t.id === 'mail-history') action(async () => { await send('PUB_MAIL_TOGGLE', {enabled: t.checked}); toast(t.checked ? 'Sent-mail checks are on for new campaigns.' : 'Sent-mail checks are off.'); });
});
const liveFilters = ['search', 'da-min-filter', 'da-max-filter', 'dr-min-filter', 'spam-max-filter', 'age-min-filter', 'traffic-min-filter', 'tld-filter', 'score-min-filter'];
for (const id of [...liveFilters, 'type-filter', 'email-filter', 'availability-filter', 'keyword-filter', 'sort', 'niche-filter', 'language-filter', 'recent-filter', 'hide-missing-filter', 'missing-only-filter', 'reason-filter'])
  $('#' + id).addEventListener(liveFilters.includes(id) ? 'input' : 'change', () => { page = 0; renderTabs(); renderResults(); });
$('#campaign-filter').onchange = e => { campaign = e.target.value; bucket = 'all'; page = 0; selected.clear(); $('#keyword-filter').value = ''; render(); };

$('#generate').onclick = e => action(async () => {
  const f = $('#search-form'), r = await send('PUB_QUERIES', {niche: f.elements.niche.value, subtopics: f.elements.subtopics.value, relatedTopics: f.elements.relatedTopics.checked, ai: f.elements.useGemini.checked});
  if (r.topics?.length) f.elements.subtopics.value = r.topics.join(', ');
  f.elements.queries.value = r.queries.join('\n'); $('#query-note').textContent = r.queries.length + ' keywords from ' + r.source + '. Edit freely.'; loadTopics();
}, e.currentTarget);
$('#search-form').elements.niche.addEventListener('input', () => { clearTimeout(topicsTimer); topicsTimer = setTimeout(loadTopics, 280); });
$('#search-form').onsubmit = e => {
  e.preventDefault();
  action(async () => {
    const f = e.target, data = Object.fromEntries(new FormData(f)); delete data.mailAccount;
    const cid = await send('PUB_START', {...data, checkDatabase: f.elements.checkDatabase.checked, checkContacted: f.elements.checkContacted.checked, useGemini: f.elements.useGemini.checked,
      relatedTopics: f.elements.relatedTopics.checked, includeForms: data.contactGoal !== 'email', tlds: String(data.tlds || '').split(/[\s,]+/).filter(Boolean),
      ...($('#mail-choice').innerHTML ? {mailAccountIds: $$('#mail-choice input[name=mailAccount]:checked').map(x => x.value)} : {})});
    campaign = cid; bucket = 'all'; $('#search-dialog').close(); changeView('opportunities'); toast('Research started. Keep Chrome open.');
  }, e.submitter);
};
$('#test-da').onclick = e => action(async () => {
  const f = $('#search-form'), q = f.elements.queries.value.split('\n').map(x => x.trim()).find(Boolean) || (f.elements.niche.value ? f.elements.niche.value + ' "write for us"' : 'write for us');
  const metrics = [['daMin', 'da'], ['daMax', 'da'], ['drMin', 'dr'], ['spamMax', 'spam'], ['ageMinYears', 'age'], ['trafficMin', 'traffic']].filter(([k]) => f.elements[k].value !== '').map(([, m]) => m);
  const r = await send('PUB_DA_TEST', {query: q, metrics: C.uniq(metrics)}); $('#da-status').textContent = r.reason; toast(r.reason, !r.ok);
}, e.currentTarget);

$('#copy-emails').onclick = e => action(async () => {
  const rows = selectedRows().filter(r => r.bucket === 'ready' && !r.doNotContact), emails = C.uniq(rows.flatMap(R.usableContacts).map(x => x.email));
  if (!emails.length) throw Error('No ready outreach emails in this view.');
  await navigator.clipboard.writeText(emails.join('\n')); toast(emails.length + ' emails copied from ready results.');
}, e.currentTarget);
$('#export').onclick = () => { const n = selectedRows().length; if (!n) return toast('No results in this view.', true); $('#export-count').textContent = n + ' results from ' + (selected.size ? 'your selection.' : 'the current view.'); $('#export-dialog').showModal(); };
$('#download-csv').onclick = () => { download('outreach-desk-' + new Date().toISOString().slice(0, 10) + '.csv', PublisherExport.csv(selectedRows(), {allContacts: $('#export-all').checked, mode: $('#export-mode').value, campaigns: state.campaigns}), 'text/csv;charset=utf-8'); $('#export-dialog').close(); toast('CSV downloaded.'); };

$('#connect').onclick = e => action(async () => { await send('PUB_ADD_DB', {links: $('#sheet-links').value}); $('#sheet-links').value = ''; toast('Sheets added. Click Refresh to check them now.'); }, e.currentTarget);
$('#import-db').onchange = e => action(async () => {
  const f = e.target.files[0]; if (!f) return; if (f.size > 20 * 1024 * 1024) throw Error('Choose a file smaller than 20 MB.');
  const result = /\.xlsx$/i.test(f.name) ? PublisherSheets.xlsx(new Uint8Array(await f.arrayBuffer())) : PublisherSheets.csv(await f.text());
  if (!result.domains.length) throw Error('No website domains found in this file.');
  await send('PUB_IMPORT_DB', {name: f.name, ...result}); e.target.value = ''; toast(result.domains.length + ' domains imported.');
});
$('#output-connect').onclick = e => action(async () => { const r = await send('PUB_OUTPUT_SETTINGS', {endpoint: $('#output-endpoint').value, secret: $('#output-secret').value, useForMail: $('#output-mail').checked}); $('#output-secret').value = ''; toast(r.status, /Error/.test(r.status)); }, e.currentTarget);
$('#output-sync').onclick = e => action(async () => { const r = await send('PUB_OUTPUT_SYNC'); toast(r.status, /Error/.test(r.status)); }, e.currentTarget);
$('#output-disconnect').onclick = e => action(async () => { if (!confirm('Disconnect the Output Sheet? Local results stay.')) return; await send('PUB_OUTPUT_DISCONNECT'); toast('Output Sheet disconnected.'); }, e.currentTarget);
$('#mail-add').onclick = e => action(async () => { const r = await send('PUB_MAIL_ADD', {endpoint: $('#mail-endpoint').value, secret: $('#mail-secret').value, label: $('#mail-label').value}); for (const id of ['#mail-endpoint', '#mail-secret', '#mail-label']) $(id).value = ''; toast('Connected ' + (r.email || r.label) + '. Sent-mail checks are on.'); }, e.currentTarget);

function settingsPayload() {
  const f = $('#settings');
  return {sender: Object.fromEntries(['name', 'email', 'company', 'website', 'subject', 'message'].map(k => [k, f.elements[k].value])), blocklist: f.elements.blocklist.value, excludePlatforms: f.elements.excludePlatforms.checked,
    researchUnclear: f.elements.researchUnclear.checked, aiQueries: f.elements.ai.checked, geminiModel: f.elements.geminiModel.value, parallel: f.elements.parallel.value};
}
$('#settings').onsubmit = e => { e.preventDefault(); action(async () => { const f = e.target; await send('PUB_SETTINGS', {...settingsPayload(), apiKey: f.elements.apiKey.value, clearKey: f.elements.clearKey.checked}); f.elements.apiKey.value = ''; f.elements.clearKey.checked = false; settingsLoaded = false; toast('Settings saved.'); }, e.submitter); };
$('#gemini-test').onclick = e => action(async () => { const f = $('#settings'), r = await send('PUB_AI_TEST', {key: f.elements.apiKey.value, model: f.elements.geminiModel.value}); $('#gemini-status').textContent = r.ok ? 'Connected: ' + r.model : 'Connection failed'; toast('Gemini works.'); }, e.currentTarget);
$('#sender-save').onclick = e => action(async () => { const q = n => $(`#sender-form [name=${n}]`); await send('PUB_SENDER_SAVE', {sender: {label: q('senderLabel').value, name: q('senderName').value, email: q('senderEmail').value, company: q('senderCompany').value, website: q('senderWebsite').value, subject: q('senderSubject').value, message: q('senderMessage').value}}); $$('#sender-form input, #sender-form textarea').forEach(x => x.value = ''); toast('Sender profile saved.'); }, e.currentTarget);
$('#backup').onclick = e => action(async () => download('outreach-desk-backup-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(await send('PUB_BACKUP'), null, 2), 'application/json'), e.currentTarget);
$('#restore').onchange = e => action(async () => { const f = e.target.files[0]; if (!f) return; if (f.size > 30 * 1024 * 1024) throw Error('Backup is larger than 30 MB.'); const r = await send('PUB_RESTORE', {backup: JSON.parse(await f.text())}); e.target.value = ''; toast(`${r.added} results and ${r.databases} sources restored.`); });
$('#moz-continue').onclick = e => action(() => send('PUB_DA_CONTINUE'), e.currentTarget);
$('#moz-stop').onclick = e => action(() => send('PUB_STOP'), e.currentTarget);
document.addEventListener('submit', e => { if (e.target.id !== 'notes') return; e.preventDefault(); updateDetail(() => send('PUB_UPDATE_LEAD', {id: e.target.dataset.id, ...Object.fromEntries(new FormData(e.target)), doNotContact: e.target.elements.doNotContact.checked}), e.submitter); });
$('#detail-dialog').addEventListener('close', () => { openId = ''; });
$('#detail-dialog').addEventListener('click', e => { if (e.target === $('#detail-dialog')) $('#detail-dialog').close(); });

chrome.storage.onChanged.addListener(changes => { if (Object.keys(changes).some(k => k.startsWith('publisher'))) refresh(); });
refresh().then(() => { const h = location.hash; if (h === '#new') openCampaign(); else if (h === '#sources') changeView('databases'); if (h) history.replaceState(null, '', location.pathname); });
setInterval(refresh, 4000);
})();

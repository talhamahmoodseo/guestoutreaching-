(function () {
'use strict';
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const STATUS = {running: 'Running', paused: 'Paused', stopped: 'Stopped', complete: 'Complete', verification: 'Needs verification', database_blocked: 'Source unavailable', da_blocked: 'Metrics missing', mail_blocked: 'Email check failed'};
let state, last = '', toastTimer;
async function send(type, data = {}) { const r = await chrome.runtime.sendMessage({type, ...data}); if (!r?.ok) throw Error(r?.error || 'The extension did not respond.'); return r.value; }
function toast(text, error) { const t = $('#toast'); t.textContent = text; t.classList.toggle('error', !!error); t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, 4000); }
async function act(fn, b) { if (b) b.disabled = true; try { await fn(); await refresh(true); } catch (e) { toast(e.message, true); } finally { if (b) b.disabled = false; } }
const dashboard = hash => chrome.tabs.create({url: chrome.runtime.getURL('publisher.html') + (hash || '')});
const pill = (t, k = '') => `<span class="pill ${k}">${esc(t)}</span>`;

function campaignCard() {
  const c = state.campaigns.find(x => x.id === state.activeId) || state.campaigns[state.campaigns.length - 1];
  if (!c) return `<div class="sp-card sp-empty"><h2>No campaign yet</h2><p>Connect your history in Sources, then start a campaign from the dashboard.</p><button class="btn primary" data-new type="button">New campaign</button></div>`;
  const live = !['complete', 'stopped'].includes(c.status);
  const ready = c.contactGoal === 'form' ? c.stats.form : c.contactGoal === 'any' || c.includeForms ? c.stats.ready + c.stats.form : c.stats.ready;
  const queued = c.queued || 0;
  const warn = ['verification', 'database_blocked', 'da_blocked', 'mail_blocked', 'paused'].includes(c.status);
  const jobs = c.jobs || [];
  let actions = '';
  if (live) {
    actions += `<button class="btn ${c.status === 'running' ? '' : 'primary'}" data-cmd="${c.status === 'running' ? 'PUB_PAUSE' : 'PUB_RESUME'}" type="button">${c.status === 'running' ? 'Pause' : 'Resume'}</button><button class="btn" data-cmd="PUB_STOP" type="button">Stop</button>`;
    if (c.status === 'da_blocked') actions += `<button class="btn primary wide" data-cmd="PUB_DA_CONTINUE" type="button">Continue without metrics</button>`;
    if (['verification', 'paused'].includes(c.status) && (c.verificationKind === 'search' || !jobs.length)) actions += `<button class="btn wide" data-tab="search" type="button">Open Google tab</button>`;
  } else actions = `${queued ? `<button class="btn primary wide" data-research-queue="${esc(c.id)}" type="button">Research ${queued} waiting</button>` : ''}<button class="btn wide" data-results type="button">Review results</button>`;
  return `<div class="sp-card">
    <div class="sp-head"><div style="min-width:0"><h2 title="${esc(c.name)}">${esc(c.name || c.niche)}</h2><p>${esc(c.niche)}${c.checkMail ? ', sent mail checked' : ''}</p></div>${pill(STATUS[c.status] || c.status, c.status === 'running' ? 'ok' : c.status === 'complete' ? '' : 'warn')}</div>
    <div class="sp-big"><b>${ready}</b><span>of ${c.target} ready</span></div>
    <div class="meter"><i style="width:${Math.min(100, ready / Math.max(1, c.target) * 100)}%"></i></div>
    <div class="sp-stats"><div><b>${c.stats.researched || 0}</b><span>Researched</span></div><div><b>${(c.stats.contacted || 0) + (c.stats.database || 0)}</b><span>Skipped: history</span></div><div><b>${queued}</b><span>In queue</span></div></div>
    ${jobs.length ? `<div class="sp-label">Researching now</div><div class="sp-sites">${jobs.map(j => `<div class="sp-site ${j.parked ? 'parked' : ''}"><i></i><span title="${esc(j.url)}">${esc(j.domain)}${j.parked ? ' needs verification' : ''}</span>${j.parked ? `<button class="link" data-tab="research" data-domain="${esc(j.domain)}" type="button">Open</button>` : ''}<button class="link" data-skip="${esc(j.domain)}" type="button">Skip</button></div>`).join('')}</div>` : ''}
    ${c.message ? `<p class="sp-msg ${warn ? 'warn' : ''}">${esc(c.message)}</p>` : ''}
    <div class="sp-actions">${actions}</div></div>`;
}
function metricsCard() {
  const m = state.metricRun;
  if (!m || m.status !== 'running') return '';
  return `<div class="sp-card"><div class="sp-head"><h2>Rechecking metrics</h2>${pill(m.done + '/' + m.total, 'ok')}</div><div class="meter"><i style="width:${m.done / Math.max(1, m.total) * 100}%"></i></div><p class="hint">${m.updated} updated, ${m.missing} still missing, ${m.parallel} websites at a time.</p><div class="sp-actions"><button class="btn wide" data-cmd="PUB_METRICS_STOP" type="button">Stop recheck</button></div></div>`;
}
function recentCard() {
  const rows = state.leads.filter(r => r.bucket === 'ready' && !r.doNotContact && r.bestEmail).sort((a, b) => (b.collectedAt || '').localeCompare(a.collectedAt || '')).slice(0, 6);
  if (!rows.length) return '';
  return `<div class="sp-card"><div class="sp-head"><h2>Latest ready</h2><button class="link" data-results type="button">See all</button></div><div class="sp-list">${rows.map(r => `<div class="sp-row"><div><strong>${esc(r.domain)}</strong><span>${esc(r.bestEmail)}${Number.isFinite(r.da) ? ', DA ' + r.da : ''}${Number.isFinite(r.dr) ? ', DR ' + r.dr : ''}</span></div><button class="btn small" data-copy="${esc(r.bestEmail)}" type="button">Copy</button></div>`).join('')}</div></div>`;
}
function sourcesCard() {
  const o = state.output || {}, accounts = state.mailAccounts || [], dbs = state.databases || [];
  const sheet = !o.endpoint ? pill('Not connected') : o.status === 'Error' ? pill('Error', 'error') : pill('Connected', 'ok');
  return `<div class="sp-head"><h2>History checks</h2><button class="link" data-sources type="button">Manage</button></div>
    <div class="sp-src"><span>Output Sheet</span>${sheet}</div>
    <div class="sp-src"><span>Email accounts</span>${state.settings.mailHistory && accounts.length ? pill(accounts.length + ' checked', 'ok') : pill('Off')}</div>
    <div class="sp-src"><span>Sources</span>${pill(dbs.length + ' connected', dbs.some(d => d.status === 'error') ? 'error' : dbs.length ? 'ok' : '')}</div>`;
}
async function refresh(force) {
  try {
    const next = await send('PUB_GET'), text = JSON.stringify([next.campaigns, next.activeId, next.metricRun, next.output, next.mailAccounts, next.databases?.length, next.leads.length]);
    const mine = chrome.runtime.getManifest?.().version;
    if (mine && next.engine !== mine) { $('#error').textContent = 'The background engine is out of date. Open chrome://extensions and click Reload on Outreach Desk.'; $('#error').hidden = false; }
    else $('#error').hidden = true;
    if (!force && text === last) return;
    last = text; state = next;
    $('#campaign').innerHTML = campaignCard(); $('#metrics').innerHTML = metricsCard(); $('#recent').innerHTML = recentCard(); $('#sources').innerHTML = sourcesCard();
  } catch (e) { $('#error').textContent = e.message; $('#error').hidden = false; }
}
document.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const d = b.dataset;
  if (b.id === 'open') dashboard();
  if (d.new !== undefined) dashboard('#new');
  if (d.results !== undefined) dashboard('#results');
  if (d.sources !== undefined) dashboard('#sources');
  if (d.cmd) act(() => send(d.cmd), b);
  if (d.skip) act(() => send('PUB_SKIP', {domain: d.skip}), b);
  if (d.researchQueue) act(() => send('PUB_RESEARCH_QUEUE', {campaignId: d.researchQueue}), b);
  if (d.tab) act(() => send('PUB_OPEN_TAB', {kind: d.tab, domain: d.domain}), b);
  if (d.copy) act(async () => { await navigator.clipboard.writeText(d.copy); toast('Email copied.'); }, b);
});
chrome.storage.onChanged.addListener(changes => { if (Object.keys(changes).some(k => k.startsWith('publisher'))) refresh(); });
refresh(true); setInterval(refresh, 3000);
})();

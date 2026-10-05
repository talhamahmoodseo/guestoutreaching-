/* Renders the real dashboard against the preview fixture in a headless DOM.
   Unit tests prove the rules; this proves the screens actually build without throwing,
   which is the class of breakage a pure-logic suite always misses. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');

const root = path.join(__dirname, '..');
const ext = f => fs.readFileSync(path.join(root, 'extension', f), 'utf8');

const SCRIPTS = ['vendor/publisher-deps.js', 'publisher-core.js', 'publisher-rules.js', 'publisher-da.js',
  'publisher-topics.js', 'publisher-model.js', 'publisher-sheets.js', 'publisher-output.js',
  'publisher-language.js', 'publisher-export.js'];

function boot(search = '') {
  const html = ext('publisher.html');
  const { window, document } = parseHTML(html);
  const errors = [];

  // linkedom implements neither dialogs nor form.elements; both are DOM plumbing, not product
  // behaviour, so they are stubbed rather than worked around in the extension.
  for (const d of document.querySelectorAll('dialog')) {
    d.showModal = function () { this.open = true; };
    d.close = function () { this.open = false; };
  }
  for (const form of document.querySelectorAll('form')) {
    form.reset = () => {};
    Object.defineProperty(form, 'elements', {
      get() {
        const out = {};
        for (const el of this.querySelectorAll('input,select,textarea')) if (el.name && !(el.name in out)) out[el.name] = el;
        return out;
      }
    });
  }
  // linkedom's <select>.value is getter-only; back it with the first option like a real one.
  for (const sel of document.querySelectorAll('select')) {
    const first = sel.querySelector('option');
    let v = first ? (first.getAttribute('value') ?? first.textContent) : '';
    Object.defineProperty(sel, 'value', { get: () => v, set: x => { v = String(x); }, configurable: true });
  }
  const timers = [];
  const ctx = vm.createContext({
    window, document, location: { href: 'chrome-extension://test/publisher.html' + search, hash: '', pathname: '/publisher.html', search },
    history: { replaceState() {} },
    navigator: { clipboard: { writeText: async () => {} } },
    URL, URLSearchParams, Blob: class { constructor() {} }, TextEncoder, TextDecoder, Uint8Array,
    structuredClone, console,
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout: () => {},
    setInterval: () => 0, clearInterval: () => {},
    chrome: { runtime: { getManifest: () => ({ version: '0.12.0' }) }, storage: { onChanged: { addListener() {} } }, tabs: { create: async () => {} } }
  });
  ctx.globalThis = ctx;
  ctx.self = ctx;
  ctx.window.location = ctx.location;

  for (const f of SCRIPTS) vm.runInContext(ext(f), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'publisher-preview-mock.js'), 'utf8'), ctx);
  // The fixture installs itself on window.chrome; promote it to the global the dashboard reads,
  // then restore the two pieces the fixture does not provide.
  vm.runInContext("globalThis.chrome=window.chrome;chrome.runtime.getManifest=()=>({version:'0.12.0'});chrome.storage={onChanged:{addListener(){}}};", ctx);
  try { vm.runInContext(ext('publisher-ui.js'), ctx); } catch (e) { errors.push(e); }
  return { ctx, document, errors, settle: async () => { for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r)); } };
}

const click = (document, selector) => {
  const el = document.querySelector(selector);
  assert.ok(el, 'missing ' + selector);
  el.dispatchEvent(new document.defaultView.Event('click', { bubbles: true }));
};

test('the dashboard renders results for the fixture campaigns without throwing', async () => {
  const { document, errors, settle } = boot();
  await settle();
  assert.deepEqual(errors, []);
  assert.ok(document.querySelectorAll('#results tbody tr').length > 0, 'result rows rendered');
  assert.ok(document.querySelectorAll('#inbox-filters .tab').length === 5, 'five status tabs');
  assert.match(document.querySelector('#campaign-filter').innerHTML, /campaign/i);
});

test('the four sections are the whole product and each one renders', async () => {
  const { document, settle } = boot();
  await settle();
  const views = [...document.querySelectorAll('.nav-item')].map(b => b.dataset.view);
  assert.deepEqual(views, ['results', 'campaigns', 'connections', 'settings']);
  for (const view of views) {
    click(document, `.nav-item[data-view="${view}"]`);
    await settle();
    const page = document.querySelector(`[data-page="${view}"]`);
    assert.ok(page && !page.hasAttribute('hidden'), view + ' page is visible');
  }
});

test('Connections shows three separate systems and never lists the output Sheet as a source', async () => {
  const { document, settle } = boot();
  await settle();
  click(document, '.nav-item[data-view="connections"]');
  await settle();
  const groups = [...document.querySelectorAll('[data-page="connections"] .group h2')].map(h => h.textContent.trim());
  assert.deepEqual(groups, ['Research sources', 'Email history', 'Output destination']);
  const flows = [...document.querySelectorAll('[data-page="connections"] .flow')].map(f => f.textContent.trim());
  assert.deepEqual(flows, ['Reads in', 'Reads in', 'Writes out']);
  assert.doesNotMatch(document.querySelector('#source-list').textContent, /Output Sheet history/,
    'the destination must not appear in the research sources list');
});

test('every metric offers both bounds in the filters and in the campaign dialog', async () => {
  const { document, settle } = boot();
  await settle();
  for (const key of ['da', 'dr', 'spam', 'age', 'traffic']) {
    assert.ok(document.querySelector('#' + key + '-min-filter'), key + ' has a minimum filter');
    assert.ok(document.querySelector('#' + key + '-max-filter'), key + ' has a maximum filter');
  }
  const form = document.querySelector('#search-form');
  for (const name of ['daMin', 'daMax', 'drMin', 'drMax', 'spamMin', 'spamMax', 'ageMinYears', 'ageMaxYears', 'trafficMin', 'trafficMax'])
    assert.ok(form.querySelector(`[name="${name}"]`), name + ' exists in the campaign dialog');
});

test('a selected campaign gets a real progress card instead of a black box', async () => {
  const { document, ctx, settle } = boot();
  await settle();
  const select = document.querySelector('#campaign-filter');
  const option = [...select.querySelectorAll('option')].find(o => o.value);
  select.value = option.value;
  select.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  await settle();
  const card = document.querySelector('#campaign-progress');
  assert.ok(!card.hasAttribute('hidden'), 'progress card is shown for a campaign');
  assert.ok(card.querySelector('.meter.big i'), 'has a progress bar');
  assert.ok(card.querySelectorAll('.funnel > div').length >= 5, 'shows the discovery funnel');
  assert.ok(card.querySelectorAll('.chip-stat').length >= 4, 'shows the outcome breakdown');
});

test('Copy emails is gone and the results toolbar keeps only real workflow actions', async () => {
  const { document, settle } = boot();
  await settle();
  assert.equal(document.querySelector('#copy-emails'), null, 'bulk email dump removed');
  const actions = [...document.querySelectorAll('.topbar-actions button')].map(b => b.textContent.trim());
  assert.deepEqual(actions, ['Export CSV']);
  assert.ok(document.querySelector('#results .copy-mini'), 'each row can copy its own main email');
});

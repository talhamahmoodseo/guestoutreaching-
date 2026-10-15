/* Semrush discovery logic. Fixtures replicate the exact shape of two real exports:
   a Referring Domains CSV table and an Organic Competitors JSON-RPC envelope. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '../extension');
function load() {
  const ctx = vm.createContext({URL, TextDecoder, TextEncoder, Uint8Array, console});
  for (const f of ['vendor/publisher-deps.js', 'publisher-core.js', 'publisher-rules.js', 'publisher-semrush.js'])
    vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx);
  return ctx.PublisherSemrush;
}
const S = load();

const REFERRING = `"domain","backlinks_num","first_seen","last_seen","ip","country","domain_ascore","category","lost","new","is_follow"
"goodblog.com","1","2024-01-02","2026-09-01","1.1.1.1","us","34","mass_media","false","false","true"
"cityeats.com","2","2024-01-02","2026-09-01","1.1.1.2","us","29","restaurants","false","false","true"
"yelp.com","9","2024-01-02","2026-09-01","1.1.1.3","us","40","online_services","false","false","true"
"someone.wordpress.com","1","2024-01-02","2026-09-01","1.1.1.4","us","22","publishing","false","false","true"
"deadlink.com","1","2020-01-02","2021-01-01","1.1.1.5","us","31","publishing","true","false","true"
"brooklaw.edu","1","2024-01-02","2026-09-01","1.1.1.6","us","45","education","false","false","true"
"unknowncat.com","1","2024-01-02","2026-09-01","1.1.1.7","de","27","","false","true","true"
"facebook.com","4","2024-01-02","2026-09-01","1.1.1.8","us","50","online_services","false","false","true"
"shop.webnode.com","1","2024-01-02","2026-09-01","1.1.1.9","us","24","publishing","false","false","true"`;

const competitor = o => JSON.stringify(Object.assign({
  adwordsPositions: 0, commonKeywords: 20, competitionLvl: 0.02, organicPositions: 5000,
  organicTraffic: 5000, organicTrafficCost: 100, positions: 5100, serpFeaturesPositions: 100,
  serpFeaturesTraffic: 100, serpFeaturesTrafficCost: 10, traffic: 5100, trafficCost: 110}, o));
const COMPETITORS = '"jsonrpc","id","result"\n' +
  '"2.0","10","' + ('[' + [
    competitor({domain: 'realblog.com', commonKeywords: 40, organicPositions: 8000, organicTraffic: 8800}),
    competitor({domain: 'ralphlauren.com', commonKeywords: 1, organicPositions: 463140, organicTraffic: 4817761}),
    competitor({domain: 'poogansporch.com', commonKeywords: 39, organicPositions: 948, organicTraffic: 37440}),
    competitor({domain: 'tinysite.com', commonKeywords: 15, organicPositions: 100, organicTraffic: 50}),
    competitor({domain: 'citymag.com', commonKeywords: 160, organicPositions: 27513, organicTraffic: 33622})
  ].join(',') + ']').replace(/"/g, '""') + '"\n' +
  '"2.0","11","7997"\n' +
  '"2.0","10","{""code"":-32107,""message"":""Report limits exceeded""}"';

/* ---------- Format handling ---------- */
test('a Referring Domains CSV table is recognised and read', () => {
  const r = S.read(REFERRING, {seed: 'competitor.com'});
  assert.equal(r.method, 'backlinks');
  assert.equal(r.candidates.length, 9);
  const first = r.candidates[0];
  assert.equal(first.domain, 'goodblog.com');
  assert.equal(first.ascore, 34);
  assert.equal(first.category, 'mass_media');
  assert.equal(first.follow, true);
  assert.equal(first.seed, 'competitor.com');
});

test('an Organic Competitors JSON-RPC envelope is unwrapped, not read as a table', () => {
  const r = S.read(COMPETITORS);
  assert.equal(r.method, 'competitors');
  assert.equal(r.candidates.length, 5);
  const blog = r.candidates.find(c => c.domain === 'realblog.com');
  assert.equal(blog.commonKeywords, 40);
  assert.equal(blog.organicKeywords, 8000);
  assert.equal(blog.trafficPerKeyword, 1.1);
  assert.equal(r.limited, true, 'the quota errors in the same file are reported, not thrown away');
});

test('an export containing only quota errors fails with the real reason', () => {
  const only = '"jsonrpc","id","error"\n"2.0","10","{""code"":-32107,""message"":""Report limits exceeded""}"';
  assert.throws(() => S.read(only), /Report limits exceeded|report allowance/i);
});

test('a file that is not a Semrush export is refused clearly', () => {
  assert.throws(() => S.read('"name","email"\n"Bob","b@x.com"'), /does not look like a Semrush/);
});

test('duplicate domains collapse to one candidate', () => {
  const r = S.read(REFERRING + '\n"goodblog.com","3","2024-01-02","2026-09-01","1.1.1.9","us","34","mass_media","false","false","true"');
  assert.equal(r.duplicates, 1);
  assert.equal(r.candidates.filter(c => c.domain === 'goodblog.com').length, 1);
});

/* ---------- Method 1 filtering ---------- */
test('referring domains drop platforms, directories, free hosts, gov/edu and lost links', () => {
  const r = S.read(REFERRING);
  const {kept, dropped} = S.apply(r.candidates, S.DEFAULTS.backlinks, []);
  const by = Object.fromEntries(dropped.map(d => [d.domain, d.code]));
  assert.equal(by['facebook.com'], 'platform');
  assert.equal(by['yelp.com'], 'directory');
  assert.equal(by['wordpress.com'], 'platform', 'a free subdomain collapses to its parent and is caught there');
  assert.equal(by['webnode.com'], 'free_host', 'a free host outside the platform list is still rejected');
  assert.equal(by['brooklaw.edu'], 'blocked');
  assert.equal(by['deadlink.com'], 'lost');
  assert.equal(by['cityeats.com'], 'category', 'restaurants rarely publish contributions');
  assert.deepEqual([...kept.map(c => c.domain).sort()], ['goodblog.com', 'unknowncat.com']);
});

test('a blank Semrush category keeps the website rather than rejecting it', () => {
  const r = S.read(REFERRING);
  const {kept} = S.apply(r.candidates, S.DEFAULTS.backlinks, []);
  assert.ok(kept.some(c => c.domain === 'unknowncat.com'), 'uncertainty must keep the site');
});

test('every rejection carries a readable reason, never a bare code', () => {
  const r = S.read(REFERRING);
  const {dropped} = S.apply(r.candidates, S.DEFAULTS.backlinks, []);
  for (const d of dropped) {
    assert.ok(d.reason && d.reason.length > 8, d.domain + ' has no readable reason');
    assert.doesNotMatch(d.reason, /undefined|null|\[object/);
  }
});

/* ---------- Method 2 filtering ---------- */
test('competitors drop giants, one-keyword noise and brand-shaped local businesses', () => {
  const r = S.read(COMPETITORS);
  const {kept, dropped} = S.apply(r.candidates, S.DEFAULTS.competitors, []);
  const by = Object.fromEntries(dropped.map(d => [d.domain, d.code]));
  assert.equal(by['ralphlauren.com'], 'overlap', 'one shared keyword is noise');
  assert.equal(by['poogansporch.com'], 'shape', 'a restaurant earns its traffic from its own name');
  assert.equal(by['tinysite.com'], 'traffic', 'below the traffic floor');
  assert.deepEqual([...kept.map(c => c.domain).sort()], ['citymag.com', 'realblog.com']);
});

test('the traffic-per-keyword shape separates content sites from brands', () => {
  const r = S.read(COMPETITORS);
  const blog = r.candidates.find(c => c.domain === 'realblog.com');
  const venue = r.candidates.find(c => c.domain === 'poogansporch.com');
  assert.ok(blog.trafficPerKeyword < 5, 'a blog ranks for many keywords relative to traffic');
  assert.ok(venue.trafficPerKeyword > 5, 'a venue ranks for few keywords but gets brand traffic');
});

test('loosening a threshold keeps more, so the preview counts respond to settings', () => {
  const r = S.read(COMPETITORS);
  const strict = S.apply(r.candidates, S.DEFAULTS.competitors, []).kept.length;
  const loose = S.apply(r.candidates, {...S.DEFAULTS.competitors, shapeMax: null, trafficMin: null, trafficMax: null}, []).kept.length;
  assert.ok(loose > strict, 'removing filters must widen the candidate list');
});

test('your own domain blocklist is honoured', () => {
  const r = S.read(REFERRING);
  const {dropped} = S.apply(r.candidates, S.DEFAULTS.backlinks, ['goodblog.com']);
  assert.equal(dropped.find(d => d.domain === 'goodblog.com').code, 'blocked');
});

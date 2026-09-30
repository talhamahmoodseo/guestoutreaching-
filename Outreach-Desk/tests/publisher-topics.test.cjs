const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = path.join(__dirname, '../extension/publisher-topics.js');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(source, 'utf8'), context);
const Topics = context.PublisherTopics;

test('Education suggestions are curated, typed related topics', () => {
  const suggestions = Topics.suggest(' Education ');
  assert.deepEqual(Array.from(suggestions, item => item.term), [
    'Tutoring', 'Mathematics', 'Physics', 'Science', 'Online Education', 'Learning', 'Courses'
  ]);
  assert.ok(suggestions.every(item => ['close', 'broad'].includes(item.kind)));
  assert.deepEqual(Array.from(Topics.suggest('an uncatalogued niche')), []);
});

test('suggestions cover the other curated subject areas without inferring synonyms', () => {
  for (const niche of ['Health', 'Crypto', 'Tech', 'Finance', 'Travel']) {
    assert.ok(Topics.suggest(niche).length > 0, niche + ' should have curated suggestions');
  }
  assert.deepEqual(Array.from(Topics.suggest('wellness marketing')), []);
});

test('resolve keeps the main niche and selected topics only when enabled', () => {
  assert.deepEqual(
    Array.from(Topics.resolve('Education', true, ['Tutoring', ' tutoring ', 'Mathematics', 'EDUCATION'])),
    ['Education', 'Tutoring', 'Mathematics']
  );
  assert.deepEqual(Array.from(Topics.resolve('Education', false, ['Tutoring', 'Mathematics'])), ['Education']);
});

test('query toggle uses only the base niche when off and selected topics when on', () => {
  const base = Topics.queries('Education', false, ['Tutoring', 'Mathematics']);
  const expanded = Topics.queries('Education', true, ['Tutoring', 'Mathematics']);

  assert.equal(base.length, 6);
  assert.ok(base.every(query => /^Education\s/.test(query)));
  assert.ok(!base.some(query => /Tutoring|Mathematics/i.test(query)));
  assert.ok(expanded.some(query => /^Tutoring\s/.test(query)));
  assert.ok(expanded.some(query => /^Mathematics\s/.test(query)));
});

test('queries are distinct, capped at 48, and exclude education and government domains', () => {
  const selected = Array.from({ length: 24 }, (_, index) => 'Topic ' + index);
  const queries = Topics.queries('Education', true, selected);
  assert.ok(queries.length <= 48);
  assert.equal(new Set(queries.map(query => query.toLocaleLowerCase('en-US'))).size, queries.length);
  assert.ok(queries.length > 6);
  assert.ok(queries.every(query => query.includes('-site:edu -site:gov')));
});

test('input validation rejects empty, malformed, and overlong values', () => {
  assert.throws(() => Topics.suggest('  '), /must not be empty/);
  assert.throws(() => Topics.suggest(42), /must be a string/);
  assert.throws(() => Topics.resolve('x'.repeat(91)), /90 characters or fewer/);
  assert.throws(() => Topics.resolve('Education', 'yes', []), /enabled must be a boolean/);
  assert.throws(() => Topics.resolve('Education', true, 'Tutoring'), /selected must be an array/);
  assert.throws(() => Topics.resolve('Education', true, ['']), /must not be empty/);
  assert.throws(() => Topics.queries('Education', true, ['x'.repeat(81)]), /80 characters or fewer/);
});

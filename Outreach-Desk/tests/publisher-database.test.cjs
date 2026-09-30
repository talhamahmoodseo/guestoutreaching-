const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { zipSync, strToU8 } = require('fflate');

const root = path.join(__dirname, '..');
function loadSheets() {
  const context = vm.createContext({ URL, TextDecoder, TextEncoder, Uint8Array, AbortController, setTimeout, clearTimeout });
  for (const name of ['vendor/publisher-deps.js', 'publisher-core.js', 'publisher-sheets.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'extension', name), 'utf8'), context);
  }
  return context.PublisherSheets;
}
function xlsxFixture() {
  const files = {
    'xl/workbook.xml': '<workbook><sheets><sheet name="Database" r:id="r1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData>' +
      '<row r="1"><c r="A1" t="inlineStr"><is><t>Outreach Status</t></is></c><c r="B1" t="inlineStr"><is><t>Website</t></is></c><c r="C1" t="inlineStr"><is><t>Email</t></is></c></row>' +
      '<row r="2"><c r="A2" t="inlineStr"><is><t>Contacted - sent pitch</t></is></c><c r="B2" t="inlineStr"><is><t>https://publisher-a.com/write</t></is></c><c r="C2" t="inlineStr"><is><t>editor@publisher-a.com</t></is></c><c r="D2"><f>HYPERLINK("https://formula-domain.net/contact","Contact")</f><v>Contact</v></c><c r="E2" t="inlineStr"><is><t>Contact page</t></is></c></row>' +
      '<row r="3"><c r="A3" t="inlineStr"><is><t>Not contacted</t></is></c><c r="B3" t="inlineStr"><is><t>https://publisher-b.org</t></is></c><c r="C3" t="inlineStr"><is><t>writer@publisher-b.org</t></is></c></row>' +
      '<row r="4"><c r="A4" t="inlineStr"><is><t>Not started</t></is></c><c r="B4" t="inlineStr"><is><t>https://publisher-c.net</t></is></c><c r="C4" t="inlineStr"><is><t>contact@publisher-c.net</t></is></c></row>' +
      '</sheetData><hyperlinks><hyperlink ref="E2" r:id="h1"/></hyperlinks></worksheet>',
    'xl/worksheets/_rels/sheet1.xml.rels': '<Relationships><Relationship Id="h1" Target="https://hyperlink-domain.io/contact?to=editor%40hyperlink-domain.io" TargetMode="External"/></Relationships>'
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, value]) => [name, strToU8(value)])));
}

test('CSV indexes every valid email and domain, while only explicit outreach statuses are contacted', () => {
  const result = loadSheets().csv([
    'Relationship,Website,Contact email',
    'Contacted,https://alpha.com/editor,editor@alpha.com',
    'Follow-up,https://beta.org,pitch@beta.org',
    'Responded,https://gamma.net,gamma@gamma.net',
    'Negotiating,https://delta.com,team@delta.com',
    'Agreed,https://epsilon.org,write@epsilon.org',
    'Do not contact,https://zeta.net,no@zeta.net',
    'Not contacted,https://eta.com,hello@eta.com',
    'Not started,https://theta.org,hello@theta.org',
    'New,https://iota.net,hello@iota.net no-reply@iota.net'
  ].join('\r\n'));
  assert.equal(result.tabs[0].name, 'CSV');
  assert.deepEqual([...result.domains].sort(), ['alpha.com', 'beta.org', 'delta.com', 'epsilon.org', 'eta.com', 'gamma.net', 'iota.net', 'theta.org', 'zeta.net']);
  assert.equal(result.emails.length, 10);
  assert.ok(result.emails.includes('no-reply@iota.net'));
  assert.deepEqual([...result.contactedDomains].sort(), ['alpha.com', 'beta.org', 'delta.com', 'epsilon.org', 'gamma.net', 'zeta.net']);
  assert.deepEqual([...result.contactedEmails].sort(), ['editor@alpha.com', 'gamma@gamma.net', 'no@zeta.net', 'pitch@beta.org', 'team@delta.com', 'write@epsilon.org']);
});

test('XLSX indexes hidden formula and hyperlink targets and respects the recognized status column', () => {
  const result = loadSheets().xlsx(xlsxFixture());
  assert.ok(result.domains.includes('publisher-a.com'));
  assert.ok(result.domains.includes('formula-domain.net'));
  assert.ok(result.domains.includes('hyperlink-domain.io'));
  assert.ok(result.domains.includes('publisher-b.org'));
  assert.ok(result.emails.includes('editor@publisher-a.com'));
  assert.ok(result.emails.includes('writer@publisher-b.org'));
  assert.deepEqual([...result.contactedDomains].sort(), ['formula-domain.net', 'hyperlink-domain.io', 'publisher-a.com']);
  assert.deepEqual([...result.contactedEmails].sort(), ['editor@publisher-a.com']);
});

test('status detection recognizes the requested alternative header names without substring false positives', () => {
  for (const header of ['Outreach Status', 'Deal Status', 'Status']) {
    const input = `${header},Domain,Email\nFollow-up,https://contacted-${header.toLowerCase().replace(/\s/g, '')}.com,person@example.org\nNot started,https://untouched.com,second@example.org`;
    const result = loadSheets().csv(input);
    // Email company domains count at domain level: person@example.org marks example.org as contacted.
    assert.deepEqual([...result.contactedDomains].sort(), [`contacted-${header.toLowerCase().replace(/\s/g, '')}.com`, 'example.org'].sort());
    assert.ok(!result.contactedDomains.includes('untouched.com'));
  }
  assert.throws(() => loadSheets().csv('Website,Status\n"unclosed'), /unclosed quote/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'extension/publisher-export.js'), 'utf8');

function loadExport(rules) {
  const context = vm.createContext({ URL, Date });
  if (rules) context.PublisherRules = rules;
  vm.runInContext(source, context);
  return context.PublisherExport;
}

function parseCsv(sourceText) {
  const text = sourceText.replace(/^\ufeff/, '');
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\r' && text[i + 1] === '\n') {
      row.push(cell); rows.push(row); row = []; cell = ''; i++;
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const allUseful = {
  usableContacts: lead => lead.emails.filter(contact => contact.suitability === 'recommended' && !contact.suppressed && contact.override !== 'exclude')
};

test('publisher mode keeps one row per record and resolves campaign name and niche by ID', () => {
  const api = loadExport(allUseful);
  const lead = {
    campaignId: 'campaign-education',
    domain: 'example.com', website: 'https://example.com/write-for-us', bucket: 'ready',
    bestEmail: 'editor@example.com',
    emails: [
      { email: 'editor@example.com', kind: 'Editorial', suitability: 'recommended' },
      { email: 'submissions@example.com', kind: 'Submissions', suitability: 'recommended' },
      { email: 'support@example.com', kind: 'Support', suitability: 'review' },
      { email: 'SUBMISSIONS@example.com', kind: 'Submissions', suitability: 'recommended' }
    ],
    opportunities: [{ decision: 'qualified', types: ['Guest post'], url: 'https://example.com/write-for-us', title: '<b>Fresh education offer</b>' }],
    forms: ['https://example.com/contact', { url: 'https://example.com/contact' }],
    discoveries: [{ query: 'education "write for us"' }, { query: 'education "write for us"' }, { query: 'school guest post' }],
    da: '44', score: 92.7, language: 'English',
    createdAt: '2026-09-01T12:30:00Z', collectedAt: '2026-09-02T09:00:00Z',
    decisionReason: 'Verified offer', dealStatus: 'New', notes: '=HYPERLINK("https://bad.test","click"), follow up\nFriday'
  };
  const sourceText = api.csv([lead], { campaigns: [{ id: 'campaign-education', name: 'Fall education', niche: 'Education' }] });
  const rows = parseCsv(sourceText);

  assert.ok(sourceText.startsWith('\ufeff'), 'CSV has a UTF-8 BOM');
  assert.equal(rows.length, 2, 'multiple email contacts must not expand the publisher row');
  assert.deepEqual(rows[0], [
    'Campaign', 'Website', 'Domain', 'Niche', 'Language', 'DA', 'DR', 'Spam Score', 'Domain Age', 'Traffic', 'Quality Score', 'Best Email',
    'Email Type', 'Additional Emails', 'Contact Form', 'Opportunity Type', 'Opportunity Page',
    'Page Title', 'Found With Keyword(s)', 'Research Status', 'Reason', 'Publisher Terms', 'Contact History', 'First Found',
    'Last Checked', 'Outreach Status', 'Notes'
  ]);
  assert.equal(rows[1][0], 'Fall education');
  assert.equal(rows[1][3], 'Education');
  assert.equal(rows[1][5], '44');
  assert.equal(rows[1][10], '93');
  assert.equal(rows[1][11], 'editor@example.com');
  assert.equal(rows[1][12], 'Editorial');
  assert.equal(rows[1][13], 'submissions@example.com');
  assert.equal(rows[1][14], 'https://example.com/contact');
  assert.equal(rows[1][17], 'Fresh education offer');
  assert.equal(rows[1][18], 'education "write for us"; school guest post');
  assert.equal(rows[1][19], 'Ready');
  assert.equal(rows[1][23], '2026-09-01T12:30:00.000Z');
  assert.equal(rows[1][24], '2026-09-02T09:00:00.000Z');
  assert.equal(rows[1][26], "'=HYPERLINK(\"https://bad.test\",\"click\"), follow up Friday");
  assert.ok(!rows[1].some(value => /<\/?[a-z][^>]*>/i.test(value)), 'HTML tags are removed');
  assert.ok(!rows[1].some(value => value.includes('undefined')));

  const unknownLanguage = parseCsv(api.csv([{ domain: 'example.net', bucket: 'review', language: 'unknown' }]))[1];
  assert.equal(unknownLanguage[4], '');
});

test('default publisher contacts follow suitability rules; allContacts is an explicit audit export', () => {
  const lead = {
    domain: 'press.example', website: 'https://press.example', bucket: 'review', bestEmail: 'editor@press.example',
    emails: [
      { email: 'editor@press.example', kind: 'Editorial', suitability: 'recommended' },
      { email: 'general@press.example', kind: 'General contact', suitability: 'fallback' },
      { email: 'unclassified@press.example', kind: 'Unknown', suitability: 'review' },
      { email: 'suppressed@press.example', kind: 'Editorial', suitability: 'recommended', suppressed: true }
    ]
  };
  const api = loadExport();
  const regular = parseCsv(api.csv([lead]));
  const audit = parseCsv(api.csv([lead], { allContacts: true }));
  assert.equal(regular.length, 2);
  assert.equal(regular[1][13], 'general@press.example');
  assert.equal(regular[1][19], 'Low confidence');
  assert.equal(audit.length, 2);
  assert.equal(audit[1][13], 'general@press.example; unclassified@press.example; suppressed@press.example');

  const blocked = { ...lead, doNotContact: true };
  const safeBlocked = parseCsv(api.csv([blocked], { allContacts: true }));
  assert.equal(safeBlocked[1][11], '', 'audit mode never bypasses the do-not-contact primary-email guard');
});

test('contacts mode emits one row per email with contact evidence and campaign identity', () => {
  const api = loadExport();
  const lead = {
    campaignId: 'c1', website: 'https://example.org', domain: 'example.org', bucket: 'ready',
    bestEmail: 'editor@example.org', language: 'English', niche: 'Arts', notes: 'Contact notes',
    emails: [
      { email: 'editor@example.org', kind: 'Editorial', suitability: 'recommended', source: 'https://example.org/write', context: '<strong>Editor enquiries</strong>' },
      { email: 'info@example.org', kind: 'General contact', suitability: 'fallback', source: '@public inbox', context: 'Call + email' },
      { email: 'excluded@example.org', kind: 'Sales', suitability: 'review', source: 'https://example.org/ads', context: 'Not suitable' }
    ]
  };
  const rows = parseCsv(api.csv([lead], { mode: 'contacts', campaigns: [{ id: 'c1', name: 'Arts campaign', niche: 'Arts' }] }));
  assert.equal(rows.length, 3, 'default contacts mode omits unclassified contacts');
  assert.deepEqual(rows[0], [
    'Campaign', 'Website', 'Domain', 'Niche', 'Language', 'Email', 'Email Type', 'Suitability',
    'Source', 'Context', 'Research Status', 'Outreach Status', 'Notes'
  ]);
  assert.equal(rows[1][0], 'Arts campaign');
  assert.equal(rows[1][5], 'editor@example.org');
  assert.equal(rows[1][6], 'Editorial');
  assert.equal(rows[1][8], 'https://example.org/write');
  assert.equal(rows[1][9], 'Editor enquiries');
  assert.equal(rows[2][5], 'info@example.org');
  assert.equal(rows[2][8], "'@public inbox", 'formula-like contact sources are escaped');

  const audit = parseCsv(api.csv([lead], { mode: 'contacts', allContacts: true }));
  assert.equal(audit.length, 4);
  assert.equal(audit[3][5], 'excluded@example.org');
});

test('rejected publishers expose no primary contact and review statuses are labeled consistently', () => {
  const api = loadExport({ usableContacts: lead => lead.emails });
  const rows = parseCsv(api.csv([{
    domain: 'closed.example', website: 'https://closed.example', bucket: 'rejected', bestEmail: 'editor@closed.example',
    emails: [{ email: 'editor@closed.example', kind: 'Editorial', suitability: 'recommended' }]
  }]));
  assert.equal(rows[1][11], '');
  assert.equal(rows[1][13], '');
  assert.equal(rows[1][19], 'Rejected');
  assert.throws(() => api.csv([], { mode: 'invalid' }), /publishers or contacts/);
});

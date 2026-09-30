/* Development-only fixture. Production never loads this file. */
(function () {
  'use strict';

  const R = PublisherRules;
  const M = PublisherModel;
  const at = '2026-09-26T15:10:00Z';
  const params = new URL(location.href).searchParams;
  const empty = params.has('empty');
  const moz = params.has('moz');

  const campaignSpecs = [
    {
      id: 'health-2026',
      name: 'Health · Editorial outreach',
      niche: 'Health',
      researchLanguage: 'en',
      requestedDA: true,
      daMin: 35,
      daMax: 75,
      requireDA: true,
      checkDatabase: true,
      checkContacted: true,
      useGemini: true,
      senderId: 'sender-studio',
      sender: { label: 'Studio outreach', name: 'Alex Morgan', email: 'alex@northstar-studio.example' },
      tlds: ['com', 'org'],
      records: [
        { domain: 'everwell-journal.com', da: 43, kind: 'Editorial', email: 'editor@everwell-journal.com', type: 'Guest post', title: 'Write for Everwell Journal', query: 'health "write for us"' },
        { domain: 'the-nutrition-edit.com', da: 52, kind: 'Submissions', email: 'submissions@the-nutrition-edit.com', type: 'Contributor', title: 'Contribute to The Nutrition Edit', query: 'nutrition "contributor guidelines"' },
        { domain: 'mindful-living.org', da: 37, form: true, type: 'Guest post', title: 'Share a mindful living story', query: 'wellness "guest post"' },
        { domain: 'vitality-review.com', da: 22, kind: 'Advertising', email: 'advertise@vitality-review.com', type: 'Sponsored content', title: 'Partner with Vitality Review', query: 'health "sponsored content"' }
      ]
    },
    {
      id: 'home-2026',
      name: 'Home · Spaces & living',
      niche: 'Home & Garden',
      researchLanguage: 'es',
      requestedDA: false,
      daMin: 0,
      daMax: 100,
      requireDA: false,
      checkDatabase: true,
      checkContacted: false,
      useGemini: false,
      senderId: 'sender-studio',
      sender: { label: 'Studio outreach', name: 'Alex Morgan', email: 'alex@northstar-studio.example' },
      tlds: [],
      records: [
        { domain: 'modern-home-review.com', da: 28, kind: 'Editorial', email: 'editor@modern-home-review.com', type: 'Guest post', title: 'Write for Modern Home Review', query: 'hogar "escribe para nosotros"' },
        { domain: 'mindful-living.org', da: 37, kind: 'Advertising', email: 'advertise@mindful-living.org', type: 'Sponsored content', title: 'Home & lifestyle partnerships', query: 'decoración "contenido patrocinado"' },
        { domain: 'dwelling-journal.com', da: 61, form: true, type: 'Contributor', title: 'Submit a home story', query: 'interiorismo "colabora con nosotros"' },
        { domain: 'spaces-of-home.co', da: 46, rejected: true, kind: 'Editorial', email: 'editor@spaces-of-home.co', type: 'Guest post', title: 'Top 50 home blogs', query: 'hogar "guest post"' }
      ]
    },
    {
      id: 'education-2026',
      name: 'Education · Learning voices',
      niche: 'Education',
      researchLanguage: 'fr',
      requestedDA: true,
      daMin: 25,
      daMax: 60,
      requireDA: true,
      checkDatabase: false,
      checkContacted: true,
      useGemini: true,
      senderId: 'sender-research',
      sender: { label: 'Research team', name: 'Sam Lee', email: 'sam@northstar-studio.example' },
      tlds: ['org', 'net', 'edu'],
      records: [
        { domain: 'teachmore.org', da: 46, kind: 'Submissions', email: 'submissions@teachmore.org', type: 'Contributor', title: 'Contribute to Teach More', query: 'éducation "appel à contributions"' },
        { domain: 'learning-lab.net', da: 35, kind: 'Editorial', email: 'editor@learning-lab.net', type: 'Guest post', title: 'Write for Learning Lab', query: 'apprentissage "écrivez pour nous"' },
        { domain: 'mindful-living.org', da: 37, form: true, type: 'Guest post', title: 'Learning through wellbeing', query: 'éducation "proposer un article"' },
        { domain: 'classroom-review.com', da: 68, rejected: true, kind: 'Editorial', email: 'editor@classroom-review.com', type: 'Guest post', title: '100 education blogs to follow', query: 'éducation "guest post"' }
      ]
    }
  ];

  function makeLead(campaign, spec, index) {
    const r = M.blank(campaign.id + '-' + (index + 1), spec.domain, campaign.niche);
    r.createdAt = at;
    r.collectedAt = at;
    r.campaignId = campaign.id;
    r.campaignName = campaign.name;
    r.language = campaign.researchLanguage;
    r.languageConfidence = 94;
    r.da = spec.da;
    r.pa = spec.da == null ? null : Math.max(1, spec.da - 12);
    r.daSource = spec.da == null ? '' : 'Visible Google result metric';
    if (spec.da != null) { r.dr = Math.max(0, Math.min(90, spec.da + ((spec.da * 7) % 23) - 9)); r.spam = (spec.da * 3) % 17; r.age = 18 + (spec.da * 5) % 200; r.traffic = spec.da * 431 + 900; }
    if (spec.kind === 'Editorial' && !spec.rejected) r.terms = {pricing: 'free', links: 'dofollow', requirements: '1,000+ original words, one author bio link', evidence: ['We allow one dofollow link in your author bio.']};
    r.title = spec.title;
    r.query = spec.query;
    r.discoveredURL = 'https://' + spec.domain + '/' + (spec.rejected ? 'top-blogs' : spec.form ? 'contribute' : 'write-for-us');
    r.discoveries = [{
      query: spec.query,
      url: r.discoveredURL,
      title: spec.title,
      snippet: 'A preview-only publishing opportunity for interface testing.',
      at: at,
      screen: { decision: spec.rejected ? 'reject' : 'inspect', reason: spec.rejected ? 'List of other websites, not a publisher offer.' : 'Relevant page title; publisher content checked.' }
    }];
    r.opportunities = [{
      url: r.discoveredURL,
      title: spec.title,
      role: spec.type,
      types: [spec.type],
      decision: spec.rejected ? 'reject' : 'qualified',
      code: spec.rejected ? 'listicle' : 'verified_offer',
      reason: spec.rejected ? 'This page lists other websites instead of inviting submissions.' : 'A publishing route and niche evidence were found.',
      evidence: spec.rejected ? 'A synthetic listicle rejection.' : 'We welcome original ' + campaign.niche.toLowerCase() + ' articles. Send your idea to our editorial team.',
      topic: { status: spec.rejected ? 'unclear' : 'matched', strength: 'strong', terms: [campaign.niche.toLowerCase()], source: 'https://' + spec.domain + '/about' }
    }];
    r.emails = spec.email ? [R.classifyEmail({
      email: spec.email,
      source: r.discoveredURL,
      context: spec.kind === 'Advertising' ? 'Advertising and sponsored content enquiries.' : 'Send your pitch to the editorial team.'
    })] : [];
    if (spec.form) r.forms = ['https://' + spec.domain + '/contact'];
    if (spec.rejected) r.reviewDecision = 'reject';
    r.summary = 'Synthetic publisher record for interface testing; this is not a real lead.';
    r.visitedURLs = [r.discoveredURL];
    r.pagesRead = 3;
    r.history = [{ at: at, decision: spec.rejected ? 'rejected' : 'qualified', reason: 'Preview campaign evidence checked' }];
    r.dealStatus = index === 1 ? 'Contacted' : 'New';
    return M.recompute(r);
  }

  const campaignPairs = campaignSpecs.map(function (spec) {
    const campaign = Object.assign({}, spec, {
      status: 'complete',
      queries: spec.records.map(function (r) { return r.query; }),
      target: 30,
      contactGoal: 'any',
      includeForms: true,
      stats: M.stats(),
      queryStats: {},
      researchedIds: [],
      skips: [],
      events: [{ at: at, message: 'Preview campaign research completed.' }],
      createdAt: at,
      message: 'Campaign research is complete. Review the evidence and results below.'
    });
    const records = spec.records.map(function (record, index) { return makeLead(campaign, record, index); });
    campaign.researchedIds = records.map(function (r) { return r.id; });
    campaign.stats = Object.assign({}, M.stats(), {
      links: spec.records.length * 5,
      unique: spec.records.length,
      repeats: 2,
      database: spec.checkDatabase ? 1 : 0,
      contacted: spec.checkContacted ? 1 : 0,
      titleRejected: spec.records.filter(function (r) { return r.rejected; }).length,
      daRejected: spec.requestedDA ? 2 : 0,
      researched: records.length,
      ready: records.filter(function (r) { return r.bucket === 'ready'; }).length,
      form: records.filter(function (r) { return r.bucket === 'form'; }).length,
      no_email: records.filter(function (r) { return r.bucket === 'no_email'; }).length,
      review: records.filter(function (r) { return r.bucket === 'review'; }).length,
      rejected: records.filter(function (r) { return r.bucket === 'rejected'; }).length,
      searchPages: 4,
      languageRejected: 1,
      emailDuplicate: 1
    });
    campaign.queryStats = Object.fromEntries(spec.records.map(function (record) {
      return [record.query, {
        pages: 1,
        links: 5,
        rejected: record.rejected ? 2 : 1,
        queued: record.rejected ? 0 : 2,
        ready: record.rejected ? 0 : 1
      }];
    }));
    return { campaign: campaign, records: records };
  });

  const allLeads = campaignPairs.flatMap(function (item) { return item.records; });
  const campaignData = campaignPairs.map(function (item) { return item.campaign; });
  if (moz && !empty) {
    const blocked = campaignData.find(function (c) { return c.id === 'health-2026'; });
    blocked.status = 'da_blocked';
    blocked.message = 'MozBar did not provide a trustworthy DA metric for every Google result. Choose whether to continue without this filter.';
    blocked.verificationKind = 'search';
  }

  const senderProfiles = [
    { id: 'sender-studio', label: 'Studio outreach', name: 'Alex Morgan', email: 'alex@northstar-studio.example', company: 'Northstar Studio', website: 'https://northstar-studio.example', subject: 'A story idea for your readers', message: 'Hello, I would love to share a useful story with your audience.' },
    { id: 'sender-research', label: 'Research team', name: 'Sam Lee', email: 'sam@northstar-studio.example', company: 'Northstar Studio', website: 'https://northstar-studio.example', subject: 'An education article for your readers', message: 'Hello, I have an education story idea that may be useful to your readers.' }
  ];

  const state = {
    version: 3,
    leads: empty ? [] : allLeads,
    campaigns: empty ? [] : campaignData,
    activeId: empty ? null : moz ? 'health-2026' : 'home-2026',
    databases: empty ? [] : [{
      id: 'db1',
      kind: 'sheet',
      name: 'Publisher master list',
      status: 'ready',
      count: 1248,
      tabs: [
        { name: 'Health', rows: 420, domains: 402 },
        { name: 'Home & Garden', rows: 368, domains: 351 },
        { name: 'Education', rows: 460, domains: 448 }
      ],
      lastSyncedAt: at,
      url: 'https://docs.google.com/spreadsheets/d/preview-only/edit'
    }],
    senderProfiles: empty ? [] : senderProfiles,
    output: { status: 'Not connected', endpoint: '', pendingIds: [] },
    settings: {
      blocklist: ['forbes.com', 'wikipedia.org', 'medium.com'],
      excludePlatforms: true,
      researchUnclear: false,
      geminiModel: 'gemini-3.1-flash-lite',
      sender: { name: 'Alex Morgan', email: 'alex@northstar-studio.example', company: 'Northstar Studio', website: 'https://northstar-studio.example', subject: 'A story idea for your readers', message: 'Hello, I would love to share a useful story with your audience.' }
    },
    hasKey: !empty
  };

  function currentCampaign() {
    return state.campaigns.find(function (c) { return c.id === state.activeId; });
  }

  function previewEvent(campaign, message) {
    if (!campaign) return;
    campaign.events = campaign.events || [];
    campaign.events.unshift({ at: new Date().toISOString(), message: message });
  }

  state.mailAccounts = [{ id: 'acc-1', label: 'Outreach Gmail', email: 'outreach@northstar.example', endpointHint: '…_abc1/exec', status: 'Connected' }, { id: 'acc-2', label: 'Team Gmail', email: 'team@northstar.example', endpointHint: '…_xyz9/exec', status: 'Connected' }];
  state.settings.mailHistory = true; state.settings.parallel = 5;
  if (params.has('running') && state.campaigns[0]) { const c = state.campaigns[0]; state.activeId = c.id; c.status = 'running'; c.target = 25; c.message = 'Researching 4 websites at once.'; c.jobs = [{ domain: 'healthline-journal.com', url: 'https://healthline-journal.com/write-for-us', pagesRead: 2 }, { domain: 'fitmind.org', url: 'https://fitmind.org/contact', pagesRead: 1 }, { domain: 'eatwell-daily.com', url: 'https://eatwell-daily.com/', pagesRead: 0, parked: true }, { domain: 'sleepscience.net', url: 'https://sleepscience.net/about', pagesRead: 3 }]; }
  const contacted = state.leads.find(r => r.bucket === 'rejected'); if (contacted) contacted.mailHistory = [{ account: 'outreach@northstar.example', to: 'editor@' + contacted.domain, date: '2026-03-14T10:00:00Z' }];
  window.chrome = {
    storage: { onChanged: { addListener: function () {} } },
    runtime: {
      getURL: function (p) { return '../extension/' + p; },
      sendMessage: async function (m) {
        try {
          let value = true;
          if (m.type === 'PUB_GET') value = structuredClone(state);
          else if (m.type === 'PUB_TOPICS') value = PublisherTopics.suggest(m.niche);
          else if (m.type === 'PUB_QUERIES') value = {
            queries: PublisherTopics.queries(m.niche, !!m.relatedTopics, String(m.subtopics || '').split('\n').join(',').split(',').map(function (x) { return x.trim(); }).filter(Boolean)),
            source: 'Curated templates'
          };
          else if (m.type === 'PUB_UPDATE_LEAD') {
            const r = state.leads.find(function (r) { return r.id === m.id; });
            if (!r) throw Error('Preview record not found.');
            for (const key of ['notes', 'dealStatus', 'reviewDecision', 'doNotContact', 'selectedEmail']) if (m[key] !== undefined) r[key] = m[key];
            M.recompute(r);
          } else if (m.type === 'PUB_EMAIL_OVERRIDE') {
            const r = state.leads.find(function (r) { return r.id === m.id; });
            if (!r) throw Error('Preview record not found.');
            const email = r.emails.find(function (e) { return e.email === m.email; });
            if (email) email.override = m.value;
            M.recompute(r);
          } else if (m.type === 'PUB_SETTINGS') {
            state.settings = Object.assign({}, state.settings, {
              sender: m.sender,
              blocklist: String(m.blocklist || '').split('\n'),
              excludePlatforms: m.excludePlatforms,
              researchUnclear: m.researchUnclear,
              geminiModel: m.geminiModel || state.settings.geminiModel
            });
            state.hasKey = !!(m.apiKey || state.hasKey) && !m.clearKey;
          } else if (m.type === 'PUB_SENDER_SAVE') {
            const sender = m.sender || {};
            const profile = {
              id: 'sender-' + Math.random().toString(36).slice(2, 9),
              label: sender.label || 'Sender profile',
              name: sender.name || '',
              email: sender.email || '',
              company: sender.company || '',
              website: sender.website || '',
              subject: sender.subject || '',
              message: sender.message || ''
            };
            state.senderProfiles.push(profile);
            value = { id: profile.id };
          } else if (m.type === 'PUB_SENDER_DELETE') {
            state.senderProfiles = state.senderProfiles.filter(function (p) { return p.id !== m.id; });
          } else if (m.type === 'PUB_OUTPUT_SETTINGS') {
            state.output = Object.assign({}, state.output, {
              endpoint: String(m.endpoint || ''),
              status: 'Connected · preview only',
              pendingIds: state.output.pendingIds || []
            });
            value = { status: state.output.status };
          } else if (m.type === 'PUB_OUTPUT_SYNC') {
            state.output.status = 'Synced · preview only';
            state.output.pendingIds = [];
            value = { status: state.output.status };
          } else if (m.type === 'PUB_OUTPUT_DISCONNECT') {
            state.output = { status: 'Not connected', endpoint: '', pendingIds: [] };
          } else if (m.type === 'PUB_DA_TEST') {
            value = { reason: 'Preview check complete: MozBar metrics are available for the sample results.' };
          } else if (m.type === 'PUB_DA_CONTINUE') {
            const campaign = currentCampaign();
            if (campaign) {
              campaign.daBypass = true;
              campaign.status = 'running';
              campaign.message = 'Continuing without DA filtering in the preview.';
              previewEvent(campaign, 'Continued without the unavailable DA filter.');
            }
          } else if (m.type === 'PUB_STOP') {
            const campaign = currentCampaign();
            if (campaign) {
              campaign.status = 'stopped';
              campaign.message = 'Search stopped in the preview. Saved findings remain available.';
              previewEvent(campaign, 'Search stopped; preview findings were retained.');
            }
          } else if (m.type === 'PUB_RESUME' || m.type === 'PUB_PAUSE') {
            const campaign = state.campaigns.find(function (c) { return c.id === m.campaignId; }) || currentCampaign();
            if (campaign) {
              campaign.status = m.type === 'PUB_PAUSE' ? 'paused' : 'running';
              campaign.message = m.type === 'PUB_PAUSE' ? 'Campaign paused in the preview.' : 'Campaign resumed in the preview.';
              previewEvent(campaign, campaign.message);
            }
          } else if (m.type === 'PUB_AI_TEST') {
            value = { ok: true, model: m.model || state.settings.geminiModel };
          } else if (m.type === 'PUB_BACKUP') value = state;
          else return { ok: false, error: 'Development preview only. Install the extension to run research.' };

          return { ok: true, value: value };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      }
    },
    tabs: { create: async function () {} }
  };
})();

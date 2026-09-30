/* Spreadsheet-safe campaign and contact exports. */
(function (g) {
  'use strict';

  const PUBLISHER_COLUMNS = [
    'Campaign', 'Website', 'Domain', 'Niche', 'Language', 'DA', 'DR', 'Spam Score', 'Domain Age', 'Traffic', 'Quality Score',
    'Best Email', 'Email Type', 'Additional Emails', 'Contact Form', 'Opportunity Type',
    'Opportunity Page', 'Page Title', 'Found With Keyword(s)', 'Research Status',
    'Reason', 'Publisher Terms', 'Contact History', 'First Found', 'Last Checked', 'Outreach Status', 'Notes'
  ];
  const CONTACT_COLUMNS = [
    'Campaign', 'Website', 'Domain', 'Niche', 'Language', 'Email', 'Email Type',
    'Suitability', 'Source', 'Context', 'Research Status', 'Outreach Status', 'Notes'
  ];

  function clean(value) {
    if (value === null || value === undefined || typeof value === 'object' || typeof value === 'function') return '';
    let text = String(value);
    if (typeof text.normalize === 'function') text = text.normalize('NFKC');
    return text
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;|&#0*160;|&#x0*a0;/gi, ' ')
      .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\ufeff]/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  function firstText(...values) {
    for (const value of values) {
      const text = clean(value);
      if (text) return text;
    }
    return '';
  }

  function list(value) {
    if (Array.isArray(value)) return value;
    return value === null || value === undefined ? [] : [value];
  }

  function itemText(value, keys) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return clean(value);
    for (const key of keys) {
      const text = clean(value[key]);
      if (text) return text;
    }
    return '';
  }

  function contactField(contact, keys) {
    return contact && typeof contact === 'object' && !Array.isArray(contact) ? itemText(contact, keys) : '';
  }

  function language(lead) {
    const value = firstText(lead.language, lead.lang);
    return /^(?:unknown|und|n\/?a)$/i.test(value) ? '' : value;
  }

  function uniqueText(values, map) {
    const seen = new Set(), result = [];
    for (const value of values) {
      const text = clean(map ? map(value) : value);
      const key = text.toLocaleLowerCase();
      if (text && !seen.has(key)) {
        seen.add(key);
        result.push(text);
      }
    }
    return result;
  }

  function email(value) {
    const candidate = clean(value).toLowerCase();
    return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(candidate) ? candidate : '';
  }

  function contactEmail(contact) {
    return email(typeof contact === 'string' ? contact : contact && contact.email);
  }

  function isRejected(lead) {
    if (lead.doNotContact || lead.reviewDecision === 'reject') return true;
    const status = clean(lead.bucket || lead.status).toLowerCase().replace(/[ _-]+/g, ' ');
    return ['rejected', 'reject', 'do not contact'].includes(status);
  }

  function statusLabel(lead) {
    if (isRejected(lead)) return 'Rejected';
    const status = clean(lead.bucket || lead.status || lead.researchStatus).toLowerCase().replace(/[ _-]+/g, ' ');
    if (['ready', 'email'].includes(status)) return 'Ready';
    if (['form', 'form only'].includes(status)) return 'Form only';
    if (['no email', 'no useful email'].includes(status)) return 'No email';
    if (status === 'unchecked') return 'Not checked';
    if (['review', 'low confidence', 'uncertain'].includes(status)) return 'Low confidence';
    return firstText(lead.bucket, lead.status, lead.researchStatus);
  }

  function isoDate(...values) {
    for (const value of values) {
      if (value === null || value === undefined || value === '') continue;
      const date = new Date(value);
      if (Number.isFinite(date.getTime())) return date.toISOString();
    }
    return '';
  }

  function termsText(t) {
    if (!t || typeof t !== 'object') return '';
    return [t.pricing === 'paid' ? 'Paid placement' : t.pricing === 'free' ? 'Free contribution' : '',
      ({dofollow: 'Dofollow links', nofollow: 'Nofollow links', none: 'No links allowed'})[t.links] || '', clean(t.requirements)].filter(Boolean).join('; ');
  }
  function integerMetric(...values) {
    for (const value of values) {
      if (value === null || value === undefined || value === '') continue;
      const number = Number(value);
      if (Number.isFinite(number) && number >= 0 && number <= 100) return String(Math.round(number));
    }
    return '';
  }

  function domainOf(lead) {
    const fromLead = firstText(lead.domain);
    if (fromLead) return fromLead.replace(/^https?:\/\//i, '').replace(/\/$/, '').replace(/^www\./i, '');
    const website = firstText(lead.website, lead.discoveredURL);
    try { return new URL(/^https?:\/\//i.test(website) ? website : 'https://' + website).hostname.replace(/^www\./i, ''); }
    catch (_) { return ''; }
  }

  function campaignFor(lead, campaigns) {
    const campaignId = firstText(lead.campaignId, lead.campaign?.id);
    const campaign = campaigns.find(item => item && campaignId && firstText(item.id, item.campaignId) === campaignId) || null;
    const name = firstText(
      lead.campaignName, lead.campaign?.name, lead.campaign?.title,
      campaign?.campaignName, campaign?.name, campaign?.title, campaign?.niche
    );
    const niche = firstText(lead.niche, lead.campaignNiche, lead.campaign?.niche, campaign?.niche);
    return { name, niche };
  }

  function opportunities(lead) {
    return list(lead.opportunities).filter(item => item && typeof item === 'object' && !item.recheckPending);
  }

  function chosenOpportunity(lead, offers) {
    return offers.find(item => item.decision === 'qualified') || offers[0] || {};
  }

  function opportunityTypes(offers) {
    return uniqueText(offers.flatMap(item => [
      ...list(item.types), item.role
    ]));
  }

  function formList(lead) {
    const values = [
      ...list(lead.forms), ...list(lead.contactForms), lead.contactForm
    ];
    return uniqueText(values, item => itemText(item, ['url', 'href', 'value']));
  }

  function keywords(lead) {
    const values = list(lead.discoveries).map(item => itemText(item, ['query', 'keyword', 'text']));
    values.push(...list(lead.keywords), lead.query, lead.foundWithKeyword);
    return uniqueText(values);
  }

  function ownUsableContacts(lead) {
    const offers = opportunities(lead);
    const types = opportunityTypes(offers);
    const guest = types.some(type => ['guest post', 'contributor'].includes(type.toLowerCase()));
    const sponsor = types.some(type => type.toLowerCase() === 'sponsored content');
    return list(lead.emails).filter(contact => {
      if (!contact || typeof contact !== 'object' || !contactEmail(contact)) return false;
      if (contact.recheckPending || contact.suppressed || contact.override === 'exclude') return false;
      if (contact.override === 'include') return true;
      if (!['recommended', 'fallback'].includes(contact.suitability)) return false;
      if (!guest && !sponsor) return true;
      if (contact.kind === 'General contact') return true;
      if (guest && ['Editorial', 'Submissions'].includes(contact.kind)) return true;
      return sponsor && ['Advertising', 'Partnerships'].includes(contact.kind);
    });
  }

  function usefulContacts(lead, allContacts) {
    if (allContacts) return list(lead.emails).filter(contact => contactEmail(contact));
    if (isRejected(lead)) return [];
    const rules = g.PublisherRules;
    if (rules && typeof rules.usableContacts === 'function') {
      try {
        const contacts = rules.usableContacts(lead);
        if (Array.isArray(contacts)) return contacts.filter(contact => contactEmail(contact));
      } catch (_) { /* A partial or older rules module falls back to the local suitability filter. */ }
    }
    return ownUsableContacts(lead);
  }

  function safePrimaryEmail(lead) {
    return isRejected(lead) ? '' : email(lead.bestEmail);
  }

  function publisherRow(lead, campaigns, allContacts) {
    const campaign = campaignFor(lead, campaigns);
    const offers = opportunities(lead);
    const opportunity = chosenOpportunity(lead, offers);
    const primaryEmail = safePrimaryEmail(lead);
    const contacts = usefulContacts(lead, allContacts);
    const primaryContact = contacts.find(contact => contactEmail(contact) === primaryEmail) ||
      list(lead.emails).find(contact => contactEmail(contact) === primaryEmail) || {};
    const additionalEmails = uniqueText(contacts.map(contactEmail).filter(address => address && address !== primaryEmail));
    return [
      campaign.name,
      firstText(lead.website, lead.discoveredURL, lead.domain),
      domainOf(lead),
      campaign.niche,
      language(lead),
      integerMetric(lead.da, lead.domainAuthority),
      integerMetric(lead.dr),
      integerMetric(lead.spam) === '' ? '' : integerMetric(lead.spam) + '%',
      Number.isInteger(lead.age) ? Math.floor(lead.age / 12) + 'y ' + (lead.age % 12) + 'm' : '',
      Number.isInteger(lead.traffic) ? String(lead.traffic) : '',
      integerMetric(lead.qualityScore, lead.score),
      primaryEmail,
      contactField(primaryContact, ['kind', 'emailType', 'type']),
      additionalEmails.join('; '),
      formList(lead).join('; '),
      opportunityTypes(offers).join('; '),
      firstText(opportunity.url, opportunity.page, lead.opportunityPage, lead.contributionURL),
      firstText(opportunity.title, opportunity.htmlTitle, lead.pageTitle, lead.title),
      keywords(lead).join('; '),
      statusLabel(lead),
      firstText(lead.decisionReason, lead.screenReason, lead.stopReason, opportunity.reason),
      termsText(lead.terms),
      list(lead.mailHistory).map(h => clean('Emailed ' + (h.to || '') + ' from ' + (h.account || '') + (h.date ? ' on ' + String(h.date).slice(0, 10) : ''))).join('; '),
      isoDate(lead.createdAt, lead.firstSeen),
      isoDate(lead.collectedAt, lead.lastChecked, opportunity.checkedAt),
      firstText(lead.dealStatus, lead.outreachStatus),
      firstText(lead.notes)
    ];
  }

  function contactRows(lead, campaigns, allContacts) {
    const campaign = campaignFor(lead, campaigns);
    const primaryEmail = safePrimaryEmail(lead);
    const contacts = usefulContacts(lead, allContacts).slice();
    if (primaryEmail && !contacts.some(contact => contactEmail(contact) === primaryEmail)) {
      contacts.unshift({ email: primaryEmail, kind: firstText(lead.bestEmailType, lead.emailType) });
    }
    const seen = new Set();
    const base = [
      campaign.name,
      firstText(lead.website, lead.discoveredURL, lead.domain),
      domainOf(lead),
      campaign.niche,
      language(lead)
    ];
    return contacts.flatMap(contact => {
      const address = contactEmail(contact);
      if (!address || seen.has(address)) return [];
      seen.add(address);
      return [[
        ...base,
        address,
        contactField(contact, ['kind', 'emailType', 'type']),
        contactField(contact, ['suitability']),
        contactField(contact, ['source']),
        contactField(contact, ['context']),
        statusLabel(lead),
        firstText(lead.dealStatus, lead.outreachStatus),
        firstText(lead.notes)
      ]];
    });
  }

  function csvCell(value) {
    let text = clean(value);
    if (/^[\s\ufeff]*[=+\-@]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function csv(records, options) {
    if (!Array.isArray(records)) throw new TypeError('Publisher export records must be an array.');
    const opts = options && typeof options === 'object' ? options : {};
    const mode = opts.mode || 'publishers';
    if (mode !== 'publishers' && mode !== 'contacts') throw new TypeError('Export mode must be publishers or contacts.');
    const campaigns = Array.isArray(opts.campaigns) ? opts.campaigns : [];
    const allContacts = opts.allContacts === true;
    const header = mode === 'contacts' ? CONTACT_COLUMNS : PUBLISHER_COLUMNS;
    const rows = [];
    for (const lead of records) {
      if (!lead || typeof lead !== 'object' || Array.isArray(lead)) continue;
      if (mode === 'contacts') rows.push(...contactRows(lead, campaigns, allContacts));
      else rows.push(publisherRow(lead, campaigns, allContacts));
    }
    return '\ufeff' + [header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
  }

  g.PublisherExport = Object.freeze({ csv });
})(globalThis);

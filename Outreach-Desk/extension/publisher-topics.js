/* Curated related topics and query templates for the standalone publisher extension. */
(function (g) {
  'use strict';

  const MAX_NICHE_LENGTH = 90;
  const MAX_TERM_LENGTH = 80;
  const MAX_SELECTED_TERMS = 24;
  const MAX_QUERY_TERMS = 8;

  // Each key is an explicitly curated niche label. There is no synonym expansion.
  const catalog = {
    education: [
      ['Tutoring', 'close'],
      ['Mathematics', 'broad'],
      ['Physics', 'broad'],
      ['Science', 'broad'],
      ['Online Education', 'close'],
      ['Learning', 'close'],
      ['Courses', 'close']
    ],
    health: [
      ['Medicine', 'close'],
      ['Healthcare', 'close'],
      ['Wellness', 'close'],
      ['Nutrition', 'close'],
      ['Fitness', 'broad'],
      ['Mental Health', 'close'],
      ['Public Health', 'broad']
    ],
    healthcare: [
      ['Medicine', 'close'],
      ['Health', 'close'],
      ['Wellness', 'close'],
      ['Nutrition', 'broad'],
      ['Mental Health', 'close'],
      ['Public Health', 'broad']
    ],
    crypto: [
      ['Blockchain', 'close'],
      ['Bitcoin', 'close'],
      ['Ethereum', 'close'],
      ['Decentralized Finance', 'broad'],
      ['Web3', 'broad'],
      ['Digital Assets', 'broad']
    ],
    cryptocurrency: [
      ['Blockchain', 'close'],
      ['Bitcoin', 'close'],
      ['Ethereum', 'close'],
      ['Decentralized Finance', 'broad'],
      ['Web3', 'broad'],
      ['Digital Assets', 'broad']
    ],
    tech: [
      ['Software', 'close'],
      ['Cybersecurity', 'close'],
      ['Artificial Intelligence', 'close'],
      ['Cloud Computing', 'broad'],
      ['Gadgets', 'broad'],
      ['Computing', 'close']
    ],
    technology: [
      ['Software', 'close'],
      ['Cybersecurity', 'close'],
      ['Artificial Intelligence', 'close'],
      ['Cloud Computing', 'broad'],
      ['Gadgets', 'broad'],
      ['Computing', 'close']
    ],
    finance: [
      ['Personal Finance', 'close'],
      ['Investing', 'close'],
      ['Banking', 'close'],
      ['Insurance', 'close'],
      ['Fintech', 'broad'],
      ['Economics', 'broad']
    ],
    travel: [
      ['Adventure Travel', 'close'],
      ['Travel Planning', 'close'],
      ['Destinations', 'close'],
      ['Sustainable Travel', 'broad'],
      ['Hospitality', 'broad'],
      ['Tourism', 'broad']
    ],
    business: [
      ['Entrepreneurship', 'close'],
      ['Marketing', 'close'],
      ['Small Business', 'close'],
      ['Management', 'broad'],
      ['Leadership', 'broad']
    ],
    home: [
      ['Home Improvement', 'close'],
      ['Interior Design', 'close'],
      ['Renovation', 'close'],
      ['Construction', 'broad'],
      ['Gardening', 'broad']
    ],
    food: [
      ['Cooking', 'close'],
      ['Recipes', 'close'],
      ['Nutrition', 'broad'],
      ['Restaurants', 'broad'],
      ['Food Culture', 'broad']
    ],
    parenting: [
      ['Child Development', 'close'],
      ['Family Life', 'close'],
      ['Pregnancy', 'broad'],
      ['Education', 'broad'],
      ['Childcare', 'close']
    ]
  };

  const intents = [
    '"write for us"',
    '"guest post guidelines"',
    '"submit a guest post"',
    '"contributor guidelines"',
    '"sponsored content"',
    '"advertise with us"'
  ];

  function term(value, label, maxLength) {
    if (typeof value !== 'string') throw new TypeError(label + ' must be a string.');
    const clean = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!clean) throw new TypeError(label + ' must not be empty.');
    if (clean.length > maxLength) throw new RangeError(label + ' must be ' + maxLength + ' characters or fewer.');
    return clean;
  }

  function key(value) {
    return value.toLocaleLowerCase('en-US');
  }

  function suggest(niche) {
    const clean = term(niche, 'niche', MAX_NICHE_LENGTH);
    const records = catalog[key(clean).replace(/\s+/g, ' ')];
    return records ? records.map(([related, kind]) => ({ term: related, kind })) : [];
  }

  function resolve(niche, enabled = false, selected = []) {
    const main = term(niche, 'niche', MAX_NICHE_LENGTH);
    if (typeof enabled !== 'boolean') throw new TypeError('enabled must be a boolean.');
    if (!Array.isArray(selected)) throw new TypeError('selected must be an array of strings.');

    const result = [main];
    const seen = new Set([key(main)]);
    if (!enabled) return result;

    for (const value of selected.slice(0, MAX_SELECTED_TERMS)) {
      const clean = term(value, 'selected topic', MAX_TERM_LENGTH);
      const normalized = key(clean);
      if (!seen.has(normalized)) {
        seen.add(normalized);
        result.push(clean);
      }
    }
    return result;
  }

  function queries(niche, enabled = false, selected = []) {
    const terms = resolve(niche, enabled, selected).slice(0, MAX_QUERY_TERMS);
    const output = [];
    const seen = new Set();
    for (const topic of terms) {
      for (const intent of intents) {
        const query = topic + ' ' + intent + ' -site:edu -site:gov';
        const normalized = key(query);
        if (!seen.has(normalized)) {
          seen.add(normalized);
          output.push(query);
        }
        if (output.length === 48) return output;
      }
    }
    return output;
  }

  g.PublisherTopics = { suggest, resolve, queries };
})(globalThis);

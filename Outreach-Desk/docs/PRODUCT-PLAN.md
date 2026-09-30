# Outreach Desk 0.6 architecture and completed workflow

The Chrome extension owns local campaign state, research jobs and results. Public Sheets supply duplicate/contact-history indexes. The optional Apps Script destination receives campaign-scoped result rows. Gemini is optional and does not control navigation, send outreach, or invent contact addresses.

| Problem | Solution | Implemented function |
| --- | --- | --- |
| Mixed campaign requirements and results | Store campaign identity on each result and snapshot criteria | Campaign selector, isolated reports, campaign-scoped output keys |
| Moz unavailable | Explicit continue/stop choice; retain queue and current search data | Moz dialog, DA exception in report, resumable stop |
| Too many manual decisions | Rank usable contacts and evidence; reject firm exclusions | Quality score and ready/form/no-email/rejected categories |
| Irrelevant results | Screen title/domain first; inspect actual publisher evidence | Platform/listicle/topic/closed-route checks and optional Gemini |
| Database/contact repetition | Normalize domains/emails across tabs and explicit outreach statuses | Independent per-campaign duplicate and contacted toggles |
| Wrong language | Use text, metadata and optionally grounded AI evidence | Campaign language gate, visible unknown language |
| Messy exports | Stable publisher rows, separate email audit format | CSV modes with clean columns and source attribution |
| Broken output panel | Dedicated responsive full-width card | Output setup/status/retry/disconnect controls |
| Different sending identities | Capture chosen profile on the campaign | Multiple local sender profiles and form drafts |

Each research step persists progress. Current jobs retain pending pages, visited URLs, elapsed research time, findings and sources. Stop preserves work for resume. Partial failures retain findings and move on; challenges wait for the user. Search finishes at the qualified contact target or after available pages/queries are exhausted.

New campaign → refresh enabled databases → Google result extraction → title/domain/DA screening → eligible publisher pages → contact extraction → language/contact-history checks → optional AI → scored result → campaign report → optional output sync/export.

The main table prioritizes website/page, best contact and type, score, DA, language, keyword and status. Evidence, secondary addresses, exclusion reasons, notes and history remain in the detail drawer. CSV and Sheet outputs retain campaign identity. JSON backups retain stored research but omit keys and output secrets.

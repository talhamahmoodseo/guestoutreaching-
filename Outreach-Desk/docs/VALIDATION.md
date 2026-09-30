# Validation: Outreach Desk 0.11.0

0.11: 145 Node tests pass, including a regression test proving a hung Sheet request no longer blocks other commands. Real-Chromium run with an Apps Script that fails twice on purpose: the campaign rode through it and completed; the queue count showed 4 waiting; clicking "Research 4 waiting" drained the queue to 0 with every waiting website researched (7 ready, 3 rejected, no unchecked left); no "Not checked" tab; auto and manual Sheet export both sent clean rows.


0.10: 142 Node tests pass. Real-Chromium run: two Google pages where page 2 repeats a page-1 domain under another URL (never reopened); 9 ready and 3 rejected, none marked No email without being opened; automatic Sheet export sent clean rows while manual Send to Sheet still worked; metrics recheck filled one site from the toolbar, one from the Google `site:` fallback, and marked the third Missing.


0.9: 136 Node tests pass. Real-Chromium end-to-end run (`tests/e2e-chromium.py`): 10-result Google page with late-loading badges, sitelinks and a People-also-ask block; all 9 badge results read correctly, the badge-less site kept with metrics missing; contact-form Turnstile site researched and ready; full-page challenge skipped as "Verification / CAPTCHA could not be completed" while the campaign completed; guest-post list and DR-below-range rejected; Send to Sheet via the dashboard sent 7 clean rows; metrics recheck read the site toolbar (DA 71, DR 76) and re-sent that row; reason filter and Delete worked.


Checked 29 September 2026.

## Automated

130 Node tests pass (`npm test`). 0.8 adds: challenge retry then skip, self-clearing challenges, embedded reCAPTCHA not treated as a block, sitelink-safe metric assignment, on-site toolbar reading that ignores page content, missing metrics never rejecting, clean Sheet rows matched by domain + campaign with status/notes kept, manual Send to Sheet, delete scoped to one campaign, and batched metrics recheck. Earlier coverage: RankSEO-style metric badges and conflict handling, DR/Spam/Age filters with skip/keep for missing values, parallel waves keeping results separate, parallel stop/resume and worker restart, domain-level Sheet history, sent-mail pre-checks with account evidence, pause when an account fails, per-campaign account choice, bulk status, Gemini terms grounding, Apps Script URL-only mode, history tabs and exact-domain sent matching.

## Real Chromium

The unpacked extension was loaded in Chromium. The service worker booted, the dashboard loaded without console errors, a manual-URL campaign completed, and a 4-site parallel campaign ran against live websites: three completed while one hit a bot check and was parked, then the campaign moved to "Needs verification". Leads were stored in per-campaign keys.

0.8 live run: 6 live sites, 5 in parallel; a real bot check on one site was retried, then skipped as "Verification / CAPTCHA could not be completed" while the campaign completed; metrics recheck opened sites in batches; delete removed one row.

## Not validated here

- RankSEO badges on your real Google results. The reader expects normal page text; if the badges are inside a closed shadow container they cannot be read and the campaign shows the "Metrics not visible" choice.
- Your real Apps Script deployment and Gmail search results (tested with a simulated Apps Script and Gmail).
- Gemini with your key (mocked responses).

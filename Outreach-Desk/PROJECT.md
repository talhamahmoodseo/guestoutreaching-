# Outreach Desk — Complete Project Handoff

**Version:** 0.13.0
**Type:** Chrome extension (Manifest V3), no server, no build step, no framework
**Owner:** Talha Mahmood, freelance SEO / link builder (Faisalabad, Pakistan)
**Repo:** `chromeoutreaching` (this folder is `Outreach-Desk/`)
**Audience of this document:** an AI or developer taking over the project cold.

**Read `docs/PRODUCT-STRUCTURE.md` before changing any screen.** From 0.12 it decides where
everything belongs: the four sections, the three kinds of connection, the one health model,
the one progress calculation and the rule for where a new feature goes. The product spent
0.6-0.11 growing feature by feature without that, which is what made it feel unplanned.

---

## 0a. STATE AS OF 0.12.1 (start here)

| | |
| --- | --- |
| Works | `npm ci && npm test` -> **160 tests pass**. The extension loads unpacked and runs. |
| Last shipped | 0.13.0, which added Semrush discovery. The research engine is deliberately unchanged since 0.11. |
| Owner's last verdict | The engine is "mostly fine"; the product around it was "unplanned, cheap, confusing". 0.12 answered that. |
| **Not verified** | **Nobody has opened 0.12.x in a real browser.** It was built in a sandbox that cannot launch Chrome. See Section 11. |
| Next most useful thing | Get the owner (or a machine with a GUI) to run `tests/e2e-chromium.py`, then a real campaign. |

**What 0.12 changed, in one line each:**

- `docs/PRODUCT-STRUCTURE.md` now decides where everything belongs. Read it before touching a screen.
- Four sections: Results, Campaigns, Connections, Settings.
- Connections split into three systems by data direction: research sources (in), email history (in), output destination (out).
- One connection health model and **one retry policy** (`PublisherMail.attempt`) - this fixed the campaigns that stopped mid-run.
- Google Sheet sources name, check and refresh themselves.
- Every metric filter has both bounds; missing metrics are backfilled automatically when a campaign ends.
- A real campaign progress model, calculated once and reused everywhere.
- Unreachable addresses retry on `www.`/`http` before a website is rejected, and no raw browser errors reach the UI.
- `publisher.css` consolidated; the appended "polish pass" of overrides is gone.
- `tests/publisher-dashboard.test.cjs` renders the real dashboard headlessly.

**The three jobs still open** are in Section 12. Nothing else is known-broken.

**Semrush (0.13)** adds discovery only. It writes no state until the user approves a candidate
list, then calls the ordinary New campaign dialog. If you are tempted to give it its own results
table or its own dedupe, read `docs/PRODUCT-STRUCTURE.md` section 2a first — the answer is no.

---

## 0. READ THIS FIRST

The owner is **not a technical person**. Explain things in plain English. He judges the tool by whether it *works when he clicks it*, not by test counts.

He has reported the same problems repeatedly across versions. Before writing any code, read **Section 12 (Open problems)** and **Section 13 (How to reproduce his setup)**. Several "bugs" turned out to be:

- The **old background engine still running** because Chrome was not reloaded after replacing files. The extension now shows a red banner when the engine version and the dashboard version differ. Check that banner before debugging anything.
- **Test interference** — debug probes that themselves triggered the action being tested.
- **One hung network call freezing the whole extension** (fixed in 0.11, see Section 8).

**Do not trust a passing unit test as proof a feature works.** Every user-visible feature must be verified by driving the real extension in a real browser. A harness for that exists: `tests/e2e-chromium.py` (Section 11).

---

## 1. What the product does

It is a **guest-post prospecting tool**. It does research only. It never sends email and never submits forms.

The job it replaces: manually googling `fashion "write for us"`, opening each result, checking whether the site really accepts contributions, finding the editor's email, checking DA/DR/Spam/Age with an SEO extension, checking whether you already contacted them, and pasting it all into a Google Sheet.

**What it does NOT do, by deliberate decision:**

| Not done | Why |
| --- | --- |
| Send emails | The owner has a separate bulk sender. Deliverability risk. |
| Submit contact forms automatically | Gets IPs flagged. It only *pre-fills* a form for manual review. |
| Solve CAPTCHAs | Skips or pauses instead. |
| Charts / analytics dashboards | Explicitly rejected as noise. They don't find extra sites. |
| Use AI to write pitches | Belongs in the sending tool, not the research tool. |

---

## 2. Architecture in one picture

```
┌─────────────────┐   chrome.runtime.sendMessage   ┌──────────────────────────┐
│ Dashboard       │ ─────────────────────────────► │ Service worker           │
│ publisher.html  │ ◄───────────────────────────── │ publisher-worker.js      │
│ publisher-ui.js │        {ok, value|error}       │ = THE ENGINE             │
└─────────────────┘                                │                          │
┌─────────────────┐                                │ owns ALL state           │
│ Side panel      │ ─────────────────────────────► │ owns ALL storage writes  │
│ publisher-panel │                                │ owns ALL tabs            │
└─────────────────┘                                └───────────┬──────────────┘
                                                               │ chrome.scripting
                                                               ▼
                                            ┌──────────────────────────────────┐
                                            │ Background tabs (Google + sites) │
                                            │ publisher-collector.js injected  │
                                            └──────────────────────────────────┘
                                                               │ fetch
                                                               ▼
                                            ┌──────────────────────────────────┐
                                            │ User's own Apps Script web apps  │
                                            │ (Output Sheet + Gmail accounts)  │
                                            └──────────────────────────────────┘
```

**The single most important rule:** the UI never writes to storage and never opens tabs. It sends a message and re-reads state. All mutations happen in the worker, serialized. If you break this rule you will reintroduce the split-state bugs that plagued 0.7 to 0.10.

---

## 3. Files, in the order you should read them

| File | Lines | What it is |
| --- | --- | --- |
| `extension/publisher-worker.js` | 414 | **The engine.** Campaign loop, state, storage, all commands. Read this first. Dense, one statement per line by design. |
| `extension/publisher-rules.js` | 169 | Pure decision logic: screening, email classification, bucket decision, quality score. **No I/O.** Easiest place to change behaviour safely. |
| `extension/publisher-collector.js` | 52 | Injected into pages. Extracts results/emails/evidence, detects CAPTCHA pages. |
| `extension/publisher-da.js` | 207 | Reads DA/DR/Spam/Age badges from Google results and from the on-site toolbar. |
| `extension/publisher-model.js` | 46 | Lead shape (`blank`), `recompute`, `mergePage`, `tally`, `migrate`. |
| `extension/publisher-ui.js` | 551 | Dashboard logic. Render + event delegation. |
| `extension/publisher.html` / `.css` | 318 / 368 | Dashboard markup and the whole design system. |
| `extension/publisher-panel.*` | ~150 | Side panel. Same design tokens as the dashboard. |
| `extension/publisher-mail.js` | 146 | Apps Script transport: ping, Sheet history, sent-mail check, cache, **and the single retry policy every call shares (`attempt`)**. |
| `extension/publisher-output.js` | 119 | Builds the clean Sheet row and posts it. |
| `extension/publisher-ai.js` | 294 | Gemini call + strict validation of its answer. |
| `extension/publisher-export.js` | 299 | CSV export. |
| `extension/publisher-sheets.js` | 102 | Parses CSV/XLSX and Apps Script history tabs. |
| `extension/publisher-topics.js` | 182 | Niche → related topics and query suggestions. |
| `sheets-apps-script/Code.gs` | 299 | The script the user deploys. Sheet writes + history + Gmail sent check. |
| `sheets-apps-script/SETUP.md` | — | User-facing setup steps. Keep in sync with `Code.gs`. |
| `tests/*.test.cjs` | — | 158 Node tests, `npm test`. |
| `tests/publisher-dashboard.test.cjs` | — | Renders the real dashboard in a headless DOM. Catches broken screens that logic tests cannot. |
| `docs/PRODUCT-STRUCTURE.md` | — | **The information architecture.** Read before touching any screen. |
| `extension/publisher-semrush.js` | 180 | Semrush export parsing and filtering. Pure logic, no I/O. Thresholds are measured, not guessed. |
| `docs/SEMRUSH-PLAN.md` | — | How both Semrush methods were researched, with the real-export measurements behind every default. |
| `tests/e2e-chromium.py` | — | Real-browser end-to-end test. **Use this.** |

Load order matters: the HTML loads deps → core → rules → da → topics → model → sheets → output → language → export → ui. The worker `importScripts` the same set plus `mail`.

---

## 4. The campaign pipeline, step by step

This is the heart of the product. A campaign is a state machine driven by `tick()` in the worker, which is re-entered by a timer and a 30-second alarm.

### Phase 1 — `sync` (check history sources)
For each connected source (Output Sheet, public Google Sheets, uploaded files):
- The Output Sheet is verified through `verifyOutput()` → `reachable()`, which **retries 3 times with backoff** before declaring a problem, then writes the result back to `s.output.status`.
- If a source genuinely fails, the campaign stops with `status:'database_blocked'`. It deliberately does **not** continue, because treating an already-contacted domain as new is the worst possible outcome for the user's business.

### Phase 2 — `search` (one Google page at a time)
1. Opens `https://www.google.com/search?q=<query>` in a background tab.
2. `PublisherCollector.search()` extracts organic results (skips ads, People-also-ask, sitelink-only entries).
3. **Metric polling:** the SEO extension (RankSEO) injects its badges *after* page load. The engine re-reads the page up to 8 times, 1.5s apart, until the count of results-with-metrics stops growing. This was a real bug source: reading too early returned 6 of 10 results.
4. `PublisherDA.assign(results, heads)` attaches badges to results. It matches by **DOM containment first, then page order**, which is what makes results with sitelinks keep their own metrics instead of shifting them onto the next result.
5. If the campaign uses metric filters and the *first* Google page shows no metrics at all, the campaign pauses with `status:'da_blocked'` and offers "Continue without metric filters".
6. `addResults()` runs the initial screening (Section 5) and queues survivors into `c.pending`.

**Sequential rule:** the next Google page is only loaded when `c.pending` is empty **and** no jobs are running. This was introduced deliberately because interleaving searching with parallel research made the state unpredictable.

### Phase 3 — `research` (5 websites in parallel)
- Up to `c.parallel` jobs (default 5, max 8), each with its own background tab, all grouped into one collapsed Chrome tab group titled "Outreach Desk".
- Every job step: navigate → inject collector → `scan()` → merge into the lead → decide whether to keep crawling (contact/about/write-for-us pages, max `c.pageLimit`, max `c.budget` seconds).
- **Page I/O runs in parallel; every state mutation is applied serially afterwards.** Never mutate shared state inside the parallel block.
- Before a site is considered ready: sent-mail history check for any new email domains, then one Gemini call, then an MX check.

### Phase 4 — finish
When `tally() >= c.target`, the campaign completes. **Anything left in `c.pending` stays queued** and is shown in the UI as "N in queue" with a **Research N waiting** button (`PUB_RESEARCH_QUEUE`), which drains the queue without opening new Google pages.

---

## 5. Filtering and rejection — the most sensitive area

The owner has pushed back on over-aggressive rejection **three separate times**. His rule:

> Reject only on strong evidence. When uncertain, keep the site.

### Two-stage filtering

**Stage 1 — screening from the Google result** (`R.screen`, before any tab opens).
Rejects only on strong signals:
- platform/community hosts (github.io, wordpress.com, medium.com, reddit, forums)
- guest-post directories and "top 50 blogs that accept guest posts" listicles
- link sellers / outreach services
- domain blocklist, TLD filter
- a **reliable** metric outside the campaign range
- wrong niche in the title

Anything relevant but unclear returns `decision:'inspect'` → **the site is opened and researched**. It is never rejected for "no clear advertising signal". That phrasing was removed after the owner objected to it by name.

**Stage 2 — history check** (`historyIndex`, `checkContacts`):
- **Contacted before = domain level.** If `john@site.com` appears anywhere in history, all of `site.com` is excluded. This is what the owner asked for explicitly.
- **Already in your sources = original rule.** A site is only rejected when *every* email found is already in a source. One new email keeps the site.
- Sources: Output Sheet outreach statuses, extra Sheet tabs, uploaded CSV/XLSX, in-app relationship statuses, and Gmail sent mail.

### Unreachable addresses (0.12.1)

Chrome will not inject into its own network-error page and reports it as *"Frame with ID 0 is
showing error page"*. That string was reaching the Rejected tab verbatim, and was frequently a
false rejection: the website was live, just served only on `www.` or only over plain `http`.

`openPage()` in the worker now retries the address once (for a blip), then tries the alternates
from `addressVariants()`, and only then gives up. `unreachable()` translates every failure in
that path into a sentence a person can act on, and the final message describes the *original*
address rather than whatever the last alternate said. Two tests cover it, including one asserting
that no browser internals can reach `decisionReason`.

**Do not "simplify" this back into a single navigate+collect call.** The retry loop is bounded by
`j.triedAddresses` (once per job) and by the job's time budget.

### Result buckets

| Bucket | Means | Visible in UI? |
| --- | --- | --- |
| `ready` | Opened, researched, has at least one usable email | Yes |
| `form` | Opened, no email, has a contact form | Yes |
| `no_email` | **Opened and read**, genuinely no email found | Yes |
| `rejected` | Filtered out, or opened but unreadable | Yes |
| `unchecked` | Passed filters, **not opened yet** — still in the queue | **No.** Shown only as a queue count. |

`unchecked` exists so that a site can never be labelled "No email" before it was actually opened. `record.attempted` is what separates "still queued" from "we tried and the page would not load" (the latter becomes `rejected` with its reason).

### Email classification
Any email found on the site is **kept**. The quality score handles ranking. Only two categories are excluded outright: automated no-reply addresses, and third-party/author addresses belonging to another domain. Support, info, sales and similar are kept with a low score. The owner explicitly does not want the tool deciding what counts as a "useful" email.

---

## 6. SEO metrics (DA / DR / Spam / Domain Age / Traffic)

The user runs a third-party extension called **RankSEO** which draws badges next to Google results and a toolbar on individual sites.

**Two sources, in order:**
1. **Google result badges** — read during the campaign by `PublisherDA.assign()`.
2. **On-site toolbar** — read by `PublisherDA.readSite()` during **Recheck metrics**. It only reads badges inside an element that looks like a toolbar (contains "RankSEO"/"Moz" text, or is `position: fixed/sticky`), so numbers inside page content (e.g. a table in a guest-post listicle) are never mistaken for metrics.
3. **Fallback** — `site:domain` on Google, reading the badge from that single result.

**Rules the owner insisted on:**
- A missing metric is shown as **Missing** (red) with the recheck date, never silently blank.
- A missing metric **never rejects a website** unless the campaign was explicitly set to "Skip the website" for missing metrics.
- Conflicting values for the same metric within one result are dropped rather than guessed.

**Known hard limit:** if RankSEO ever renders its toolbar inside its own extension iframe or a closed shadow root, Chrome will not let this extension read it. The code detects this and reports it as a diagnostic note instead of failing silently.

---

## 7. Google Sheets and email history (the user's own Apps Script)

There is **no server**. The user deploys `sheets-apps-script/Code.gs` as a Web App from their own Google account. One script does three jobs:

1. **Output** — writes selected results to an `Outreach` tab. Clean columns only: Date, Campaign, Domain, Website, Best Email, All Emails, Contact Page, Language, DA, DR, Spam Score, Domain Age, Outreach Status, Notes. Rows are matched by **domain + campaign**, so re-sending or a metrics recheck updates the row rather than duplicating it. The user's own Outreach Status, Notes and any extra columns are never overwritten.
2. **History** — returns every tab so contacted domains are skipped. `Outreach`/`Useful`/`Rejected` count as history only via their Outreach Status; every other tab counts entirely as history. Tabs starting with `_` are ignored.
3. **Sent mail** — searches that Gmail account's Sent folder and returns only `{sent, date, to}`. No email content ever leaves Gmail. Scope is `gmail.readonly`.

**Why Apps Script instead of Gmail OAuth:** a proper OAuth app needs Google verification for restricted Gmail scopes; without it, tokens expire every 7 days per account. Apps Script needs no Cloud project, no verification, and no re-login. IMAP/app-passwords were rejected because Chrome extensions cannot open IMAP connections at all.

**Export modes:** `manual` (default — select rows, click Send to Sheet) or `auto` (qualifying results sent as found). Both use the same clean row builder.

---

## 7a. Connection health — one model, one retry policy (0.12)

Every connection — a research source, a mailbox, the output Sheet — carries the same record:

```
status: new | checking | ready | degraded | error
lastOkAt, error (the real message, verbatim), failures (consecutive)
```

Helpers `healthOk` / `healthFail` / `healthReset` in the worker are the only things that write it,
so the Connections screen and a running campaign cannot disagree.

**The retry policy lives in exactly one place: `PublisherMail.attempt`.** Before 0.12 there were
three hand-rolled loops and one path (`check`, `history`) with no retry at all, which is what made
a campaign report a working connection as broken. Two specific traps to not reintroduce:

1. **Do not treat HTTP 4xx as permanent.** Apps Script returns 404 transiently while a deployment
   propagates. The old `reachable()` broke out of its retry loop on `/HTTP 4/`, so the one error
   the owner actually hit was the one never retried. Only *semantic* failures are permanent — see
   the `PERMANENT` regex in `publisher-mail.js`.
2. **The worker must pass `RETRY` (which carries `wait: sleep`) into every mail call.** The test
   harness replaces the worker's `sleep` with a fake clock; a retry that calls `setTimeout`
   directly hangs the tests forever.

## 8. The reliability fixes in 0.11 — do not undo these

A single flaw caused a whole family of symptoms the owner reported as separate bugs (buttons doing nothing, campaigns stopping quietly, settings saying "Connected" while a campaign said "not connected"):

**Every command ran through one queue with no time limit.** One hung network call froze everything behind it, silently.

Three changes:

1. **Watchdog.** `serial()` wraps every queued operation in a 90-second limit. A stuck operation rejects with a clear message instead of blocking the queue forever.
2. **Sheet sync is off the queue.** `syncOutput()` performs its network call outside the lock and applies the result in a short queued operation, guarded by a `syncing` flag.
3. **One source of truth for connections.** The settings panel and the campaign both call `reachable()` (3 attempts with backoff, with a list of errors that should not be retried). The answer is written back to state, so the two views cannot disagree. On load, a stored "Connected" with no saved Apps Script URL is corrected (this happens after restoring a backup, which deliberately excludes URLs and keys).

Also: campaigns remember the **email address** of their accounts (`mailAccountLabels`), not just the internal id, so removing and re-adding an account does not break existing campaigns.

**Version guard:** `PUB_GET` returns the manifest version as `engine`. The dashboard and side panel show a red banner if it differs from their own version. This catches the "you forgot to reload the extension" situation, which wasted several debugging rounds.

---

## 9. State and storage

| Key | Contents |
| --- | --- |
| `publisherDesk` | Campaigns, settings, sources, output status. Leads are **not** here. |
| `publisherLeads:<campaignId>` | One key per campaign. Only changed chunks are rewritten. |
| `publisherOutputConfig` | Apps Script URL + optional secret. Excluded from backups. |
| `publisherMailAccounts` | Connected Gmail accounts. Excluded from backups. |
| `publisherGeminiKey` | API key. Excluded from backups. |
| `publisherMailCache` | Sent-mail results. Positive matches kept forever, negatives 14 days. |

The worker keeps an in-memory `cache` of `publisherDesk`, dropped whenever a command fails, so a failed operation cannot leave stale state behind.

### Campaign object — key fields
`id, name, niche, queries[], manual, target, contactGoal, parallel, maxPages, budget, pageLimit, researchLanguage, subtopics, relatedTopics, tlds[], daMin, daMax, drMin, spamMax, ageMinMonths, trafficMin, missingMetric('keep'|'skip'), onVerification('skip'|'pause'), checkDatabase, checkContacted, checkMail, mailAccountIds[], mailAccountLabels[], useGemini, status, phase, queryIndex, pageNumber, pending[], jobs[], tabPool[], opened[], seen[], researchedIds[], attempts{}, stats{}, skips[], events[], queryStats{}`

`opened[]` is the strict per-campaign deduplication list: once a domain is queued or opened it is never opened again, whatever keyword or Google page finds it later.

### Lead object — key fields
`id, domain, website, niche, campaignId, campaignName, bucket, decisionReason, hardReject{code,reason}, score, scoreReasons[], emails[], bestEmail, forms[], contactPages[], opportunities[], discoveries[], visitedURLs[], attempted, da, dr, spam, age, traffic, metricSource, metricsStatus('found'|'missing'), metricsCheckedAt, mailHistory[], terms{}, language, dealStatus, doNotContact, notes, sheetSentAt, collectedAt, history[]`

### Commands (40)
`PUB_GET` is the only one that bypasses the serial queue (it is read-only and polled every 4s).

Campaign: `PUB_START PUB_PAUSE PUB_RESUME PUB_STOP PUB_SKIP PUB_RESEARCH_QUEUE PUB_DA_CONTINUE PUB_DA_TEST PUB_QUERIES PUB_TOPICS PUB_OPEN_TAB PUB_RECHECK`
Results: `PUB_UPDATE_LEAD PUB_EMAIL_OVERRIDE PUB_BULK PUB_DELETE PUB_PREFILL PUB_RECHECK_METRICS PUB_METRICS_STOP`
Sheet/mail: `PUB_OUTPUT_SETTINGS PUB_OUTPUT_SYNC PUB_OUTPUT_DISCONNECT PUB_SEND_SHEET PUB_SHEET_MODE PUB_MAIL_ADD PUB_MAIL_REMOVE PUB_MAIL_TEST PUB_MAIL_TOGGLE`
Sources: `PUB_ADD_DB PUB_SYNC_DB PUB_RENAME_DB PUB_DELETE_DB PUB_IMPORT_DB`
Settings: `PUB_SETTINGS PUB_SENDER_SAVE PUB_SENDER_DELETE PUB_AI_TEST PUB_BACKUP PUB_RESTORE`

---

## 10. Gemini usage

Optional. Runs **once per promising website**, not per page, and is rate limited (~4.2s between calls). It:
- confirms the site matches the niche,
- classifies unclear mailboxes,
- extracts publisher terms (free vs paid, dofollow/nofollow, submission requirements).

Every claim must be backed by a **literal quote from the page**; unquoted claims are discarded. Gemini can never reject a site that already has a verified publisher offer. After 4 rate-limit errors it disables itself for that campaign and research continues locally.

---

## 11. Testing

```bash
npm ci
npm test                                   # 145 Node tests, ~3s
node tests/prepare-publisher-preview.cjs   # builds a UI preview with fake data
python3 tests/e2e-chromium.py              # real Chromium, real extension
```

`tests/e2e-chromium.py` is the important one. It loads the **unpacked extension** into Chromium, maps every hostname to a local TLS server (`--host-resolver-rules`), and serves:
- a fake Google results page with **late-loading** RankSEO badges, sitelinks and a People-also-ask block,
- a second Google page that repeats a domain from page one (dedup test),
- fake websites including one with a contact-form Turnstile, one with a real full-page Cloudflare challenge, one guest-post listicle, one with an on-site toolbar,
- a fake Apps Script that can be told to fail on demand (retry test).

It then **drives the real dashboard buttons** and asserts on engine state.

**Lesson learned the hard way:** when adding probes to this harness, never let a probe click or invoke the thing you are testing. A debug probe that clicked a button before the test clicked it cost an entire debugging round.

---

## 12. Open problems — start here

### A. The 0.11 "same issue" — IDENTIFIED AND FIXED IN 0.12

He supplied a screenshot: "Email check failed", with `infoseodoctors@gmail.com could not be
checked: Apps Script returned HTTP 404`, on a campaign that had been working. Root cause was two
bugs, both now fixed and regression-tested (see 7a): the campaign-time calls had no retry, and
HTTP 404 was classified as permanent. **Awaiting his confirmation on his own machine.**

Still check the red version banner first on any new report — it remains the most common cause of
a false bug report.

### B. Phase 1 reliability work — 2 of 3 items done
Done in 0.11: per-operation watchdog, sheet sync off the queue.
Done in 0.12: one retry policy across every Apps Script call, one connection health model.
**Still to do:**
- **Per-campaign queues.** There is still one global queue for state mutations. One slow campaign operation still delays unrelated commands (it can no longer freeze them permanently, but it can delay them up to 90s).
- **Durable job list.** Chrome can shut down the MV3 service worker at any time. In-flight research resumes from the last save, but a job interrupted mid-step loses that step. A persisted job queue with explicit status transitions would remove this class of bug entirely.

### C. Architecture decision — pending owner's choice
He asked whether to move to a web app. The recommendation given: **hybrid, phased.**
- Metric reading and page extraction **must** stay in the browser extension — no server can read RankSEO's badges or use his Google session.
- Campaign state, history and results would be more reliable in a real database behind a small web app, once volumes reach tens of thousands of sites.
- Advice was to finish Phase 1 first, because rebuilding now would carry the same fragile queue design into a larger system.

He has not chosen yet.

### D. Never verified against the real world
- RankSEO's on-site toolbar has only been tested against a reconstruction of his screenshot, never his live extension.
- His actual Apps Script deployment and real Gmail search results.
- Gemini with his real key.

---

## 13. Reproducing the owner's setup

1. Load `extension/` unpacked in `chrome://extensions` with Developer mode on.
2. Install the RankSEO extension and sign in, so badges appear on Google results.
3. Create a Google Sheet → Extensions → Apps Script → paste `sheets-apps-script/Code.gs` → enable `appsscript.json` in Project Settings and paste that too → Deploy as Web App (Execute as: Me, Access: Anyone) → copy the `/exec` URL into Sources & history.
4. Optionally add extra Gmail accounts with the same script deployed standalone.
5. Optionally add a Gemini API key in Settings.
6. Run a campaign: niche `fashion`, keyword `fashion "write for us"`, DR min 20, target 20.

---

## 14. Working agreements with the owner

- **Plain English.** No jargon. He will say when something is unclear.
- **Short summaries.** He is on a limited plan and does not want long progress narration.
- **Do not rebuild working parts.** Fix what is broken.
- **Always bump the version** in `extension/manifest.json` and `package.json` and tell him to click Reload. Version mismatch has already caused false bug reports.
- **Deliver a ZIP of the whole project**, not loose files.
- When something cannot be done (an API limit, a Chrome restriction), say so plainly rather than building a fragile workaround. He has said this explicitly.
- He values **accuracy above automation**. If a check cannot be done reliably, it is better to pause the campaign than to guess.

---

## 15. Version history (short)

| Version | Main change |
| --- | --- |
| 0.6 | Original working version: research, email collection, MozBar DA, Sheet output. |
| 0.7 | Redesigned dashboard, parallel research, RankSEO metrics, domain-level history, sent-mail checks via Apps Script. |
| 0.8 | Strict CAPTCHA detection, metrics recheck, softer rejection, clean Sheet export, bulk actions, delete. |
| 0.9 | Contact-form CAPTCHAs separated from page challenges; missing-metric option restored; sequential keyword processing; engine version banner. |
| 0.10 | "No email" only after opening; strict per-campaign dedup; automatic Sheet export; metrics recheck with Google fallback. |
| 0.11 | Queue watchdog, sheet sync off the queue, single source of truth for connections, queued sites no longer shown as results. |
| 0.13 | Semrush discovery: two methods, own dashboard, measured filters, both export formats. Pipeline untouched. |
| 0.12.1 | Unreachable addresses retried on www/http before rejecting; browser error text replaced with plain English. |
| 0.12 | Product structure defined and implemented: four sections, Connections split into three systems, one connection health model and one retry policy (fixes the transient-404 campaign stops), self-managing Sheet sources, symmetric metric filters, automatic metric backfill, campaign progress, consolidated stylesheet, headless dashboard tests. |

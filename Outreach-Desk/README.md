# Outreach Desk 0.13: guest-post research

A standalone Chrome extension for finding publisher contacts, organising opportunities by
campaign, and checking what you already have. It does research only. It never sends email
and never submits a form — sending and negotiation stay with you.

## Install or upgrade

1. Back up first: **Settings → Download backup**. Stop any running campaign.
2. Unzip `Outreach-Desk-v0.13.zip` into a permanent folder.
3. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select
   **Outreach-Desk/extension** (the folder containing `manifest.json`).
4. Open the extension icon → **Open research workspace**.
5. **Upgrading?** Replace the files inside your *existing* extension folder and click **Reload**.
   That keeps the same Chrome identity and your local data. Loading from a new folder creates a
   separate extension with separate storage; use **Restore backup** if that happens.

No build step and no npm install are needed to use it. Keep Chrome open while research runs.
Data is local to your Chrome profile — back it up periodically.

> If the dashboard shows a red banner about the engine version, the old background engine is
> still running. Reload the extension in `chrome://extensions` before reporting anything else.

## How the product is organised

Four sections, each with one purpose. `docs/PRODUCT-STRUCTURE.md` is the rulebook that decides
where anything new belongs.

| Section | What it is for |
| --- | --- |
| **Results** | Every website the research produced. Status tabs (Ready, Form only, No email, Rejected) are views of one list, so your filters survive switching between them. |
| **Campaigns** | Create a campaign, watch its progress, read its keyword performance and skip reasons. |
| **Semrush** | A second way to find websites: turn a competitor or seed blog into candidates. See below. |
| **Connections** | Everything outside the extension — see below. |
| **Settings** | Defaults that apply to every campaign, plus Gemini, sender profiles and backups. |

## Semrush research

A second discovery method, with its own screen, feeding the same pipeline.

**Method 1 — competitor backlinks.** Export a competitor's **Referring Domains** from Backlink
Analytics, drop the file in, and the tool removes platforms, directories, forums, free hosts,
gov/edu and the Semrush categories that never publish contributions.

**Method 2 — organic competitors.** Export the **Competitors** report for a seed blog. Filtering
is by shared keywords (the strongest signal), a traffic band that removes national media, and
**visits per keyword** — a measure that separates content sites from local businesses, because a
restaurant earns most of its traffic from its own name on very few keywords.

Both read Semrush's plain CSV export *and* the raw API response format. Nothing is saved while
you tune the filters: you see a live count and a preview of exactly what is being removed and
why, and only when you approve does it become a campaign. From there it is the ordinary
pipeline — your history checks, opening each site, qualifying it, finding emails, the Sheet.

The default thresholds are not guesses: they were measured against real exports. See
`docs/SEMRUSH-PLAN.md`.

## Connections: three systems that never mix

The rule is the direction the data travels.

1. **Research sources** — *reads in.* Public Google Sheet links and uploaded CSV/XLSX lists you
   already own. Checked before a website is opened so you never research the same domain twice.
   Read-only: the tool never writes here. Paste a Sheet link and it names itself from the
   workbook, checks itself, refreshes itself when stale and reports its own health — no manual
   refreshing.
2. **Email history** — *reads in.* Your Gmail accounts, each running your own Apps Script. Only
   `{sent, date, to}` comes back; no email content ever leaves Gmail. One contacted address
   excludes the whole domain.
3. **Output destination** — *writes out.* The single Sheet results are written to, plus whether
   that happens **manually** (select rows → Send to Sheet) or **automatically** (qualifying
   results go as they are found). Rows match on domain + campaign, so re-sending updates a row
   instead of duplicating it, and your own Status and Notes columns are never overwritten.

If an enabled source genuinely cannot be read, research **stops** rather than treat an
already-contacted domain as new.

## Campaign workflow

1. **Connections:** add your sources, mailboxes and output Sheet.
2. **New campaign:** name it, choose a niche, language, sender profile, target and limits.
3. Pick related topics or leave them off. Generate and edit keywords. Gemini can expand topics
   when enabled; curated queries work without any API key.
4. Set metric filters. **Every metric takes both a lowest and a highest value** — DA, DR, Spam,
   Domain age and Traffic. A missing metric never rejects a website unless you choose "Skip".
5. Start. The campaign follows Google's pagination up to your limit, researches five websites at
   a time, and stops at your target or when the results run out.

While it runs you always see the phase, a progress bar against the target, the funnel
(found → screened → skipped as known → researched → still queued), the outcome breakdown and
which websites are open right now. The same numbers appear in the sidebar, the Campaigns page
and the side panel, because they are calculated once.

## Connection reliability

Apps Script returns HTTP 404, 429 and 5xx transiently — while a deployment propagates, under
Google's load, and sometimes for no visible reason. Every call now retries with backoff, and
only errors that cannot fix themselves (wrong secret, wrong script, authorisation revoked) give
up early. A connection reports `Connected`, `Reconnecting` or `Error` with the real message, and
the Connections screen and a running campaign read the same record, so they cannot disagree.

## Metrics

DA/DR/Spam/Age/Traffic are read from your SEO extension's badges on Google results, and from its
on-site toolbar during a recheck. Badges that never loaded during the search are **filled in
automatically when the campaign finishes** — you no longer have to spot the blank rows and
recheck them by hand. A recheck you start yourself always takes over the automatic one.

Missing metrics show as red **Missing** with the date, never as a silent blank, and conflicting
values inside one result are dropped rather than guessed.

## When a website will not open

If the browser cannot load a website at all, the address is retried once, then tried as `www.`
and as plain `http` before the site is given up on — a live website served only on `www.` is no
longer thrown away. If every address genuinely fails it is rejected with a reason in plain
English, never with a browser error code.

## Results and exports

Filter by status, email type, opportunity, niche, score, language, TLD, keyword, metric range and
recency. Open a row for evidence, every contact, sources, notes, history and relationship state.
Copy a website's main email straight from its row.

CSV exports one row per website (or one row per email in audit mode), respecting the visible
filters and your selection. For a formatted, writable database, deploy the script in
`sheets-apps-script/SETUP.md` in a Sheet you own and connect it as your output destination.

## Optional Gemini

Save your own key and use **Test connection**. Runs once per promising website to confirm the
niche, classify unclear mailboxes and read the publisher's terms. Every claim must quote the
page; unquoted claims are discarded. It can never invent a contact, and research continues with
local scoring if it fails. Free-tier terms may let Google use requests to improve products — do
not enable it for sensitive material. Keys and script URLs are stored separately and are
excluded from backups.

## Validation and limits

174 automated tests pass, including a headless render of the real dashboard, regression tests
proving a transient Apps Script 404 no longer breaks a running campaign, and tests proving an
unreachable address is retried on `www.`/`http` before a website is rejected. See
`docs/VALIDATION.md`.

Your own SEO extension, Google session, Gemini key and Apps Script deployment still need testing
on your machine — Google and Moz layouts, provider quotas and website behaviour all change.
Published emails are not delivery-verified. This is a testable release, not a promise of
complete coverage.

Developer workflow: `npm ci`, `npm test`, `npm run preview:fixtures`, `npm run dev`.
Runtime dependencies are already bundled in `extension/vendor`.

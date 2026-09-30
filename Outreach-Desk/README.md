# Outreach Desk 0.7: guest-post research

A standalone Chrome extension for finding publisher contacts, organizing opportunities by campaign, and checking existing Google Sheets. Separate from Agency Scout. Email sending and negotiation stay with you.

## Install or upgrade

1. Back up the old extension first: **Preferences → Download backup**. Stop any active campaign.
2. Unzip `Outreach-Desk-v0.7.zip` into a permanent folder.
3. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select **Outreach-Desk/extension** (the folder containing `manifest.json`).
4. Open the extension icon → **Open research workspace**.
5. For an existing unpacked installation, replace the files inside its existing extension directory and click **Reload** to preserve its Chrome identity and local data. A new directory/extension identity starts with separate storage; use **Restore publisher backup** to import your data.

No build step or npm installation is needed. Keep Chrome open while research runs. Data is local to your Chrome profile. Back it up periodically.

## What's new in 0.7

See `docs/RELEASE-NOTES.md`. In short: new dashboard, 5 websites researched at once, DA/DR/Spam/Age/Traffic from your SEO extension, domain-level history, an Output Sheet that doubles as history, and sent-mail checks across several Gmail accounts. Setup for the Sheet and Gmail accounts: `sheets-apps-script/SETUP.md`.

## Campaign workflow

1. **Databases:** add public, viewable Google Sheet links or import CSV/XLSX. All accessible workbook tabs are indexed. These are read-only sources. Use a separate Sheet for automatic output.
2. **Preferences:** optionally save sender profiles, a Gemini key, and your own domain blocklist.
3. **New search:** name the campaign; choose a niche, research language, sender profile, target, and time/page limits.
4. Select suggested related topics, or leave Related Topics off for the main niche only. Generate and edit keywords. Optional Gemini expands related topics when enabled. Curated queries work without an API key.
5. Independently enable **Check existing databases** and **Skip already contacted**. If an enabled Sheet fails to refresh, research waits; it does not silently ignore your database.
6. Optionally choose a DA range and allowed domain extensions. DA is read from MozBar's visible Google result overlay. This requires Google search mode; manually supplied URLs cannot use DA filtering.
7. Start. The tool follows available Google pagination up to your limit, checks candidate pages and contact pages, and stops at your target or when available results end.

Blocked publisher sites are skipped with findings retained. Verification requires you to open the indicated tab and complete it, then Resume. Verification waiting time does not consume the site's research budget. The tool does not bypass challenges.

## Moz fallback and resume

If Moz metrics cannot be read reliably, choose **Continue without Moz** or **Stop campaign**. Continuing disables DA filtering for that campaign and records the exception beside the originally requested range. Stop preserves the current page, pending queue and search position. Select the stopped campaign and click **Resume campaign** to continue. Complete reports remain available; use a new campaign for new searches.

## Campaign reports and quality scores

The campaign selector switches between an overall view and each campaign's own results, counts, keywords and requirements. The same domain can belong to two campaigns without either overwriting the other's DA decision. Global do-not-contact flags and enabled contacted-history checks still apply.

Obvious listicles, directories, platforms, wrong-niche titles and explicit closed contribution routes are screened out. A usable published contact normally goes to **Ready for outreach** unless there is a firm exclusion. Ready does **not** mean guest posting was confirmed: the details and 0–100 evidence score explain the strength of that opportunity. Editorial/submission contacts rank above advertising and general contacts; first-party customer-support addresses are a low-score fallback. Feedback, billing, jobs, legal, automated and clearly third-party contacts remain excluded by default.

Language checks combine page text and declared HTML language. Clear mismatches are rejected for that campaign. Unknown language is retained and shown as Unknown; short, multilingual or incorrectly labeled pages can remain uncertain. Local contribution rules primarily understand English wording; other-language research benefits from Gemini and still needs your spot checks.

Filter by email status, email type, opportunity, niche, score, DA range, TLD(s), language and recently checked date. Search domains, titles and emails. Open a row for evidence, all contacts, sources, notes, history and relationship status. Rechecking a publisher creates a separate report so the original campaign remains unchanged.

## Existing/contacted checks

Domains and emails are normalized across source tabs. Recognized status columns include Outreach Status, Relationship, Deal Status and Status. Explicit Contacted, Follow-up, Responded, Negotiating, Agreed and Do not contact values populate the contacted index; New and Not contacted do not. Your locally saved contacted relationship states also inform later campaigns. Ambiguous custom statuses should be standardized in your source Sheet.

Sender profiles are selectable names, addresses and draft text. They **do not authenticate mailboxes or read sent mail**. Contact history comes from your Sheets and recorded relationship statuses. Contact-form preparation is an explicit action and never submits a form automatically.

## Clean exports and output Sheet

CSV defaults to one row per publisher per campaign, with stable columns for campaign, website, niche, language, DA, score, best email/type, other emails, contact form, opportunity, keyword, dates and outreach status. Contact audit mode uses one row per email with source/context. Exports respect the visible filters and selected rows. UTF-8, proper CSV quoting and formula escaping keep cells clean; CSV itself does not store visual formatting.

For a formatted writable database, follow **sheets-apps-script/SETUP.md**. Deploy the included script in a separate Sheet that you own, then save its Web App URL and secret in **Preferences → Automatic output Sheet**. Campaign-scoped records go into Useful/Rejected tabs. Manual outreach status and notes are preserved on updates. Failed output sync keeps local records and queues retries without stopping research. A public view link alone cannot grant write access.

The new Apps Script upgrades recognized v0.5 output headers by appending its additional columns. Back up your workbook before replacing the script. Historical combined rows cannot be retrospectively split into campaigns that were never recorded.

## Optional Gemini

Save your own Gemini API key and use **Test Gemini connection**. The model is configurable; the bundled default is `gemini-3.1-flash-lite`. Account eligibility and free quotas depend on Google. Research continues with local scoring on API failure; the campaign report records the fallback.

When enabled, Gemini receives the niche and limited public page evidence plus published email context. It cannot add invented contacts: email classifications are restricted to addresses already extracted, and accepted assessments require literal page evidence. A high-confidence irrelevant finding may reject the site. Gemini can still make mistakes. Its free-tier data terms may permit Google to use requests to improve products; do not enable it for sensitive material. Keys and output secrets stay in separate local storage and are excluded from backups.

## Validation and limits

0.7 notes: metric filters need your SEO extension (or MozBar) visible on Google. Sent-mail checks need the Apps Script deployed from each Gmail account.


See **docs/VALIDATION.md**. Automated tests and synthetic browser fixtures pass. Your actual MozBar installation, Google session, Gemini credentials and Apps Script deployment need testing on your computer. Google/Moz layouts, provider quotas and website behavior can change. Published emails are not delivery-verified. This is a testable release, not a promise of complete coverage or perfect accuracy.

Developer workflow: `npm ci`, `npm test`, `npm run preview:fixtures`, `npm run dev`. Production runtime dependencies are already bundled in `extension/vendor`.

# Outreach Desk 0.12.1

After replacing the files, click **Reload** on Outreach Desk in `chrome://extensions`.

## "Access incomplete: Frame with ID 0 is showing error page"

That line in the Rejected tab was Chrome's own wording, passed straight through. It means the
browser never loaded the page at all, so the extension had nothing to read. Two problems with it:

- **It was often wrong.** A website that only answers on `www.` (or only over plain `http`) failed
  on the first spelling of its address and was rejected as unreachable, even though it was live.
- **It was unreadable.** "Frame with ID 0" is browser plumbing, not something you can act on.

Now an address that fails is retried once for a blip, then tried as `www.` and as plain `http`
before the website is given up on. Those sites are researched normally instead of being thrown
away. If every address genuinely fails, the reason is written in words: *"The website could not be
opened: nothing loaded in the browser. The address may no longer exist, or the server refused the
connection."* Raw browser errors no longer reach the results at all, and a test asserts it.

Other technical messages from the same path ("Page does not allow extraction", timeouts, a closed
research tab) are now plain English too.

# Outreach Desk 0.12.0

After replacing the files, click **Reload** on Outreach Desk in `chrome://extensions`.

0.12 is a structure release. The research engine is deliberately unchanged: it still searches,
screens, opens websites and finds emails exactly as it did. What changed is the product around
it, which had grown feature by feature without a plan. `docs/PRODUCT-STRUCTURE.md` now decides
where anything belongs, and everything below follows from it.

## The connection bug that made the tool feel unreliable

A campaign could report "Email check failed" or a disconnected Sheet minutes after both had
worked. Two causes, both fixed:

- **The calls made during a campaign had no retry at all.** Only the settings-panel health check
  retried. The sent-mail lookup and the Sheet history read gave up on the first failure, so a
  single transient Apps Script hiccup stopped the run.
- **HTTP 404 was treated as permanent** and skipped the retries that did exist — and 404 is
  exactly what Apps Script returns transiently while a deployment propagates.

Now every Apps Script call shares one retry policy with backoff, and only errors that cannot fix
themselves (wrong secret, wrong script, authorisation revoked) give up early. Regression tests
cover both paths.

## One health model for every connection

Research sources, mailboxes and the output Sheet all carry the same record: status, when it last
worked, the real error message and a consecutive-failure count. `Reconnecting` now exists for a
connection that failed once but is still retrying, so a blip no longer reads as "broken". The
Connections screen and a running campaign read the same record and cannot disagree.

## Connections split into three systems

The old "Sources & history" mixed a destination, read-only lists and a Gmail toggle in one place.
It is now three groups on one page, separated by the direction data travels:

- **Research sources** (reads in) — public Sheets and uploaded files. The output Sheet no longer
  appears in this list; it is a destination, and its history role is stated as a property of it.
- **Email history** (reads in) — your Gmail accounts. Using the output Sheet's Google account for
  sent-mail checks is now an explicit offer here, not a checkbox hidden in the output panel.
- **Output destination** (writes out) — the Sheet, plus a clear manual/automatic choice.

## Google Sheet sources manage themselves

Paste a link and the source names itself from the workbook, checks itself straight away,
refreshes when it goes stale and reports its own health. A name you set yourself is never
overwritten. No manual refreshing.

## Complete, symmetric metric filters

Every metric now takes both a lowest and a highest value — DA, DR, Spam, Domain age and Traffic —
in the campaign dialog and in the results filters, with matching validation and campaign-report
wording. No more DA having two ends while DR had one.

## Metrics fill themselves in

Badges that never rendered during the search used to leave roughly 15–20 blank rows per 100
websites for you to notice and recheck by hand. A finished campaign now backfills them
automatically using the same recheck engine. A recheck you start yourself takes over the
automatic one instead of being refused. Badge polling during the search also waits longer before
concluding the SEO extension has finished.

## Campaign progress instead of a black box

A running campaign always shows its phase (checking sources, searching Google, researching), a
progress bar against the target, the funnel — found, screened out, skipped as already known,
researched, still queued — the outcome breakdown, and which websites are open right now. The
sidebar, the Campaigns page and the side panel all use the same calculation, so the numbers
cannot drift apart.

## Dashboard actions and design

**Copy emails** is gone: a bulk clipboard dump is not an outreach workflow, and your sender takes
its list from the CSV or the Sheet. Each row can copy its own main email instead. The toolbar
keeps Export CSV; the selection bar keeps Send to Sheet, Recheck metrics, Set status and Delete.

The stylesheet was consolidated — the old "polish pass" of overrides appended to the end is gone,
folded into the rules themselves, on one spacing scale, with the side panel on the same tokens.

## Testing

158 automated tests, up from 145. New: a headless render of the real dashboard (four sections,
the three connection groups, the progress card, both metric bounds), transient-404 regressions for
both the sent-mail and Sheet-history paths, symmetric metric-bound filtering, and the automatic
metric backfill.

# Outreach Desk 0.11.0

After replacing the files, click **Reload** on Outreach Desk in `chrome://extensions`.

## The bug behind several of the repeated problems

Every command ran through a single queue in the background engine, with no time limit. One slow or hung network call (a Sheet sync, an Apps Script request) froze *everything* behind it: buttons did nothing with no error, campaigns stopped quietly, and settings showed one state while a campaign showed another. Fixed three ways:

- Every queued operation now has a hard 90-second limit. A stuck operation fails with a clear message instead of freezing the extension.
- Sheet syncing now happens outside the queue. Its network call can no longer block campaigns or buttons.
- Connection state has one source of truth: the campaign and the settings panel use the same checker, transient failures retry three times before reporting a problem, and the answer is written back so the two can never disagree.

## Also fixed

- **Connections stay consistent.** Removing and re-adding an email account no longer breaks existing campaigns (they now follow the address, not the internal id). Restoring a backup no longer leaves a "Connected" label with no saved Apps Script URL; it says plainly that the URL must be pasted again.
- **"Not checked" is gone as a result category.** Websites that passed the filters but have not been opened yet are shown as a queue count with a **Research N waiting** button, not as results. A website that was opened but could not be read is Rejected with its reason. Only genuinely researched websites can be No email.
- Researching the waiting queue opens no new Google pages: it works through exactly the websites that already passed the filters.

# Outreach Desk 0.10.0

After replacing the files, click **Reload** on Outreach Desk in `chrome://extensions`.

- **No email is decided only after opening the site.** New results start as *Not checked*. A site becomes *No email* only after its pages were read and no email was found. Sites that could not be opened stay *Not checked* with the reason. Existing unresearched rows are corrected on load.
- **No more "useful email" filtering.** Any email found on the site is kept (support, info, sales and so on get a low score). Only automated no-reply and third-party/author addresses are excluded. The tab is now just *No email*.
- **One research per domain per campaign.** Once a domain is queued or opened, later keywords, Google pages or batches never open it again (www and non-www count as the same domain).
- **Sheet export mode** (Sources & history > Output Sheet): *Manual only* or *Automatic*. Automatic sends qualifying results (per the campaign's "counts as ready" setting) with the clean columns only. Manual selection keeps working in both modes.
- **Metrics recheck completed:** the site toolbar is read until values stop changing (so late DR/Spam/Age are not missed); if the toolbar gives nothing, Google `site:domain` is searched and the SEO extension's badge is read. Sites with no values from either source are marked **Missing** (red) with the recheck date, instead of staying blank.

# Outreach Desk 0.9.0

**Important:** after replacing the files, open `chrome://extensions` and click the **Reload** icon on Outreach Desk. If you loaded the new folder as a separate extension, remove the old one. The "Unknown publisher action" error came from the old background engine still running: the new engine handles Send to Sheet. The dashboard and side panel now show a red warning whenever the engine is older than the dashboard.

- **Contact-form CAPTCHAs no longer count as verification.** A Turnstile/reCAPTCHA/hCaptcha inside a contact form used the same frame address as a full-page Cloudflare challenge, so contact pages were flagged. Now only page-level challenges count, judged on the text outside forms. Real challenges are retried for about 9 seconds, then follow the campaign setting (skip and continue by default, or pause).
- **Missing-metrics option is back** on the campaign form: keep the website with metrics marked missing (default) or skip it. A reliable value outside your range always rejects.
- **Rejection closer to your original version:** contacted-before is domain level as you asked, but "already in your sources" is back to the original rule (reject only when every email is already there). Unclear Google results are researched, not rejected. Gemini can no longer reject a site that has a verified publisher offer. Emails are excluded only when their domain does not exist.
- **One Google page at a time:** the engine finishes the websites from one search page (5 in parallel) before loading the next page or keyword. Simpler and more predictable.
- **Rejected tab reasons:** Verification / CAPTCHA, Already contacted / in your sources, Irrelevant platform, Directory / list, Metric requirement, Irrelevant website, Not a publisher opportunity, No usable contact, Rejected by you, Other.
- **Metrics recheck** now explains itself when nothing can be read (for example when the SEO toolbar is drawn inside the other extension's own frame, which Chrome does not let us read).
- Tested end to end in real Chromium (`tests/e2e-chromium.py`).

# Outreach Desk 0.8.0

Fixes from live testing.

- **Verification detection**: only real challenge pages count (Cloudflare/DDoS-Guard/PerimeterX pages, Google "unusual traffic", challenge titles on near-empty pages). A reCAPTCHA on a normal contact form, slow pages and redirects no longer count. Challenges are re-read for about 9 seconds because many clear by themselves.
- **New campaign option**: when a CAPTCHA does not clear, *Skip it and continue* (default) or *Pause for me to review*. Skipped sites appear in Rejected as "Verification / CAPTCHA could not be completed".
- **Metrics reading**: badges are matched to results by page position, so results with sitelinks no longer lose their metrics or shift them to the next result. The Google page is re-read until the SEO extension finishes filling badges. The "metrics not visible" pause now happens only if the first Google page shows no metrics at all.
- **Missing metrics never reject**: unknown DA/DR/Spam/Age are kept as unknown. Only a reliable value outside your range rejects.
- **Recheck metrics**: select results (or filter "Only results with missing DA or DR", then Select all) and click Recheck metrics. Websites open 5 at a time and the RankSEO toolbar on the site is read. Values update locally and in the Sheet for rows you already sent.
- **Softer rejection**: unclear Google results are researched instead of rejected; informational articles no longer reject a whole site; a niche check on the page title only applies to the homepage. Lists of guest-post sites, platforms, sellers, closed offers, wrong niche/language, metric ranges and contact history still reject.
- **Tab filters**: Rejected has a reason filter (verification, contacted before, in your sources, metrics, not a publisher, wrong niche, language, closed, unavailable, rejected by you) and hides metric filters.
- **Clean Sheet**: one `Outreach` tab with only outreach columns. Nothing is sent automatically; select results and click **Send to Sheet**.
- **Selection and bulk actions**: select one, several, or all results in the view, then Send to Sheet, Recheck metrics, Set status or Delete. Delete removes only the selected rows of that campaign.
- **Side panel rebuilt** on the dashboard design: campaign progress, sites being researched with Open/Skip, metrics recheck progress, latest ready contacts with Copy, and history check status. Dashboard layout polished.

## Upgrade

Replace the extension files and click Reload on `chrome://extensions`. Paste the new `Code.gs` into your Apps Script and deploy a new version.

# Outreach Desk 0.7.0

- **Redesigned dashboard**: sidebar navigation with live campaign progress, results table with sortable DA, DR, Spam, Age and Traffic columns, status tabs, metric filter panel, bulk actions, side drawer for details, four-step campaign form, and dedicated Sources & history and Settings pages.
- **Parallel research**: 5 websites at once by default (1 to 8). Verification pages pause only the affected website.
- **New SEO metrics**: reads RankSEO-style badges (DA, PA, DR, Spam, Age, TR) with MozBar as fallback. Campaign filters for DA range, minimum DR, maximum Spam, minimum domain age and minimum traffic, with a choice for missing values.
- **Domain-level contact history**: one contacted email excludes the whole domain.
- **Output Sheet rebuilt**: URL-only setup (secret optional), faster batched writes, new metric and terms columns, and the Sheet now works as history (outreach statuses plus any extra tabs).
- **Sent-mail history**: connect multiple Gmail accounts through the same script, global on/off, per-campaign account choice, clear evidence of which account and date, and a pause if an account cannot be checked.
- **Gemini**: once per promising website, rate limited, and now reads publisher terms (free or paid, link policy, requirements) when it can quote them.
- **MX check**: emails whose domain has no mail server are excluded.
- **Duplicate campaign**, **CSV columns** for DR, Spam, Age, Traffic, Publisher Terms and Contact History, and faster storage for large campaigns.

## Upgrade notes

Download a backup first (Settings > Backup). Replace the files in your existing extension folder and click Reload on `chrome://extensions` so your data stays. Chrome may ask to allow "tab groups". Old campaigns and leads migrate automatically.

Replace the Apps Script with the new `Code.gs` **and** add `appsscript.json`, then deploy a new version (see `sheets-apps-script/SETUP.md`). Existing Output Sheet rows, statuses and notes are kept; new columns are appended.

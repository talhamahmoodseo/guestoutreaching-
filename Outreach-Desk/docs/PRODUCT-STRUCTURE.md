# Outreach Desk — Product Structure

**This document decides where things belong.** Every screen, button and setting in the
product must have one obvious home, chosen by the rules below. If a new feature does not
fit any section here, the section list is wrong and must be changed deliberately — not
worked around by adding another button somewhere convenient.

Written for 0.12. Supersedes the ad-hoc layout of 0.6–0.11.

---

## 1. What the product is

A **research tool**. It finds guest-post opportunities, proves they are real, and hands
them to you with a contact. It does not send email and does not submit forms.

Everything in the product serves one of four jobs:

| Job | The question it answers |
| --- | --- |
| **Set up** | What am I researching, and what counts as a win? |
| **Run** | What is happening right now, and how far along is it? |
| **Review** | Which websites did I get, and are they any good? |
| **Deliver** | How do these leave the tool and reach my outreach? |

A section that does not clearly serve one of these does not belong in the product.

---

## 2. The four sections

The sidebar has exactly four destinations, in this order. This is the whole product.

**Results comes first and is the default view**, because reviewing is what you do most: a
campaign is started once and reviewed for days. Campaigns sits second because you visit it to
start or inspect a run, not to work.

### Results — *review*
Every website the research produced, for one campaign or all of them.

Owns: the results table, the status tabs, filters, search, selection, bulk actions, the
detail drawer for a single website.

**Status tabs are views of one dataset, not separate sections.** Ready, Form only, No
email and Rejected are the same list filtered by outcome. They stay tabs because you move
between them constantly while reviewing, and splitting them into sidebar items would mean
losing your filters and your place each time you switched. `unchecked` is never a tab —
those sites have not been opened yet and are reported as a queue count instead.

### Campaigns — *set up and run*
Create a campaign, watch it run, see its history.

Owns: the campaign list, campaign progress, per-campaign criteria, keyword performance,
skip reasons, the activity log, Duplicate, Pause/Resume/Stop.

Does **not** own: individual websites. A campaign is a *job*; its output lives in Results.

### Connections — *deliver, and know who you already contacted*
Everything that talks to something outside the extension. Three separate systems that
happen to share a page. See section 3.

### Settings — *how the tool behaves*
Research defaults, Gemini, sender profiles, contact-form defaults, backup and restore.

Owns things that are **true across all campaigns**. A value that belongs to one campaign
belongs in the campaign dialog, not here.

---

## 3. Connections: three systems, never mixed

This is where the old product was most confused. The Output Sheet was listed as a research
source. The Gmail toggle lived inside the Output Sheet panel. One pasted URL could be
three different things at once and the screen did not say which.

The fix is to name the three systems and keep them apart. Each has a **different direction
of data flow**, and that is the rule that decides where something goes.

### A. Research sources — data comes **in**
Read-only lists you already own, checked *before* a website is researched so you never
re-research or re-contact a domain.

Contains: public Google Sheet links, uploaded CSV/XLSX files.

Rules:
- Read-only. The tool never writes here.
- If an enabled source cannot be read, research **stops**. Treating an already-contacted
  domain as new is the worst outcome, so guessing is never acceptable.
- Each source manages itself: it detects its own name, refreshes when stale, and reports
  its own health. You never have to remember to refresh it.

### B. Email history — data comes **in**
Your Gmail accounts, each running your own Apps Script, used to check whether you already
emailed a domain.

Contains: connected Gmail accounts, each with its own health.

Rules:
- Only `{sent, date, to}` ever comes back. No email content leaves Gmail.
- Contacted is judged at **domain level**: one contacted address excludes the whole domain.
- An account that fails transiently is retried. An account that is genuinely broken pauses
  the campaign and says why — it never silently passes old contacts through as new.

### C. Output destination — data goes **out**
The one Sheet the tool writes results to.

Contains: the Output Sheet connection, and the export mode (manual or automatic).

Rules:
- This is a **destination**, not a source. It never appears in the research sources list.
- Its extra tabs *do* feed history, but that is a stated side effect of the same Sheet, shown
  as a property of the destination — not a second entry pretending to be a source.
- Its Google account *may* also serve as an email-history account. If you choose that, it
  appears in **Email history** as its own account. It is not a checkbox hidden in the
  output panel.

### The test for "where does this go?"
> Does data come in, or go out?
> In, from a list I own → **Research sources**.
> In, from my mailbox → **Email history**.
> Out → **Output destination**.

---

## 4. Connection health — one model for all three

Every connection, regardless of type, has the same health record and the same lifecycle.
There is exactly one implementation; no connection type gets its own bespoke logic.

```
status:      connected | checking | degraded | error | not_connected
lastOkAt:    when it last genuinely worked
lastError:   the real message, verbatim — never "something went wrong"
failures:    consecutive failures since the last success
```

Rules that follow from this:

1. **Every network call retries.** Not just the ones that happen to be on a settings
   screen. A transient HTTP 404/500 from Apps Script must never look like a broken
   connection — this was the single biggest reliability complaint in 0.11.
2. **One success resets the record.** `failures` goes to zero, `status` goes to connected.
3. **`degraded` exists.** A connection that failed once but has not exhausted its retries is
   degraded, not broken. The campaign keeps going and the UI says so quietly.
4. **`error` requires exhausted retries**, and always carries the real reason.
5. **The settings view and the campaign read the same record.** They cannot disagree, because
   there is only one. A campaign saying "not connected" while the panel says "Connected" is
   a structural bug, not a display bug.

---

## 5. Campaign progress — the campaign is never a black box

A running campaign always answers these, everywhere it is shown:

- **Phase** — checking sources / searching Google / researching websites / finishing
- **Progress** — a percentage against the target, plus the raw counts behind it
- **Funnel** — discovered → screened out → queued → researched → ready
- **Outcome so far** — ready, form only, no email, rejected, still pending
- **Right now** — which websites are open, and which need you

The same numbers appear in the sidebar run box, the Campaigns page and the side panel.
They are computed in one place so they cannot drift apart.

---

## 6. Metric filters — complete and symmetric

The filter model is one rule applied to every metric, so nothing is half-built:

| Metric | Bounds | Notes |
| --- | --- | --- |
| DA | min + max | authority window |
| DR | min + max | authority window |
| Spam | min + max | usually only max matters, both offered for consistency |
| Domain age | min + max | in years |
| Traffic | min + max | monthly visits |

Rules:
- Every metric offers **both bounds** in both places it appears: the campaign dialog and
  the results filters. No metric gets only one side.
- A **missing** metric never rejects a website unless the campaign explicitly chose "skip".
- A **reliable** value outside the range always rejects.
- Conflicting values for the same metric inside one search result are dropped, never guessed.
- The campaign report states the requested window verbatim, including any bypass.

---

## 7. Dashboard actions — earn your place

An action appears in the results toolbar only if it is part of real outreach work on
**many** results at once. Anything that acts on one website belongs in that website's row
or detail drawer.

| Action | Where | Why |
| --- | --- | --- |
| Export CSV | toolbar | delivers the whole view |
| Send to Sheet | selection bar | delivers the selection |
| Recheck metrics | selection bar | fixes the selection |
| Set status / Delete | selection bar | manages the selection |
| Copy main email | row + drawer | acts on one website |

Removed: **Copy emails** — a bulk email dump is not an outreach workflow. Sending happens
in your sender, and it gets its list from the CSV or the Sheet, not the clipboard.

---

## 8. Rules for future changes

1. **Name the section first.** If a change does not fit a section, fix the structure.
2. **One home per concept.** No setting appears in two places.
3. **Campaign-scoped values live on the campaign.** Global values live in Settings.
4. **The engine owns state; the UI only sends messages and re-reads.** Never mutate state
   from the dashboard. This is what kept 0.7–0.10 broken.
5. **One implementation per idea.** One health model, one progress calculation, one row
   builder. Duplicates drift.
6. **Never invent certainty.** If something cannot be checked reliably, pause and say so
   rather than guessing. Accuracy beats automation.

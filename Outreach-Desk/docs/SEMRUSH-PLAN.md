# Semrush research — implementation plan

**Status:** proposal for review. Nothing is built yet.
**Updated** with findings from real exports of **both** methods — Sections 11 and 12, which
supersede the guesswork in Sections 2, 4 and 5.
**Date:** October 2026, against Outreach Desk 0.12.1.

Two new discovery methods based on Semrush, each with its own dashboard, both feeding the
existing research pipeline (history check → open site → qualify → find email → Sheet).

---

## 1. Read this first: three findings that shape everything

### 1.1 The Semrush API is out of reach

I checked the official pricing. The Analytics API is **not included in any normal plan**:

- It requires the **Advanced/Business tier, about $549/month**.
- That tier includes **zero API units**. Units are a **separate recurring add-on**, sold in
  2M–20M packages (roughly $50 per 1M by third-party estimates).
- Referring domains cost **40 units per row**. One competitor with 2,000 referring domains =
  **80,000 units** for a single pull.

So the clean, supported, robust integration is priced out of this project. I am not going to
plan around it as the main route. The plan below keeps an adapter seam so it can be slotted in
later if that ever changes.

### 1.2 Your access link is a group-buy proxy, and that matters technically

`nazsm1.1clkaccess.store` is not Semrush. It is a reseller that proxies one shared Semrush
account to many people and rewrites the pages on the way through. Consequences for us:

- **The HTML is not Semrush's HTML.** Class names, URLs and script behaviour are rewritten by
  the proxy. Any code that reads the page by CSS selector is reading *their* rewrite, which can
  change without notice — this is why "some links work and others don't".
- **Export is often disabled** on group-buy accounts, because export is the thing resellers
  restrict first.
- **I could not log in to inspect it.** Entering credentials to authenticate is outside what I
  can do, so everything below is designed from Semrush's own documentation plus what you tell
  me. I will need screenshots (Section 8).

### 1.3 Semrush's terms forbid both scraping and account sharing

Stating this once, plainly, because it affects which design is sensible — not to lecture you.

Semrush's ToS prohibit automated access ("robots, spiders, scrapers") without written approval,
and prohibit sharing one login between people. Group-buy services are explicitly against their
rules and accounts using them do get suspended.

**What that means for the build:** the more the tool behaves like a robot inside Semrush
(scrolling tables, clicking through pages, firing requests), the higher the chance the shared
account gets killed — and it is not your account, so you lose access with no warning and no
recourse. A design that reads a file **you** exported carries none of that risk.

That is why the plan below makes **file import the primary path** and live page-reading an
optional convenience, rather than the other way round. Your call either way; I have built the
plan so you can choose per method.

---

## 2. What Semrush actually gives us

Confirmed from Semrush's documentation.

### Method 1 — Backlink Analytics

Two tabs matter:

| Tab | One row = | Columns available |
| --- | --- | --- |
| **Backlinks** | one link | Authority Score, source page title + URL, external links, internal links, anchor text, link type (text/image/form/frame), attributes (nofollow/sponsored/UGC), target URL, link status, first seen, last seen |
| **Referring Domains** | one domain | Domain Authority Score, domain, backlinks count, domain trust score, IP, country, first seen, last seen |

**Filters in the UI:** quick filters for Link Status (active/new/lost) and Attributes
(follow/nofollow/sponsored/UGC); advanced filters for referring domain, link type, anchor text,
IP, zones (TLD), lost issues, sitewide backlinks, authority score, toxicity score and category.

**Export:** CSV or Excel, above the table, and **export respects the filters you applied**. Row
count is capped by plan.

**Important:** for your workflow, **Referring Domains is the right tab**, not Backlinks. You
want one row per website, not one row per link. Please confirm which you currently use — it
changes the import schema.

### Method 2 — Organic Research → Competitors

One row per competing domain. The documented UI columns are Domain, Competition Level, Common
Keywords, SE Keywords, Traffic and Costs — but **the real export carries 13 fields, not 6**. See
Section 11 for the actual schema, which is what we will build against.

Competition Level is computed from each domain's keyword count and the overlap between them —
it is a similarity score, not a quality score. A high score means "ranks for the same things",
which is exactly the signal you want, but says nothing about whether they accept guest posts.
In the real export it turned out to be **almost useless as a filter** (Section 11.3).

---

## 3. Where this lives in the product

Your rule: a separate dashboard, no mixing with Google Search Operators. The existing structure
rule (`PRODUCT-STRUCTURE.md`): one home per concept, never duplicate a working system.

Both are satisfied by separating **discovery** and sharing **everything after it**:

```
DISCOVERY (different per method)        PIPELINE (identical, already built)
┌──────────────────────────┐
│ Google Search Operators  │──┐
├──────────────────────────┤  │   ┌──────────────────────────────────────┐
│ Semrush: competitor      │  ├──▶│ history check (sources + sent mail)  │
│ backlinks                │  │   │ open the website                      │
├──────────────────────────┤  │   │ qualify against your requirements     │
│ Semrush: organic         │──┘   │ find + classify emails                │
│ competitors              │      │ score, bucket, Sheet export           │
└──────────────────────────┘      └──────────────────────────────────────┘
```

**Concretely:**

- A new sidebar section, **Semrush**, with two tabs: *Competitor backlinks* and *Organic
  competitors*. This is your separate dashboard — seed entry, import, filter tuning, and a
  **candidate preview** before anything enters the pipeline.
- A campaign gains one new field: `source: 'google' | 'semrush_backlinks' | 'semrush_competitors'`.
- **Results stays one place**, with a Source column and a Source filter. One database, one
  dedupe, one Sheet. Splitting results would mean two databases that disagree about who you
  already contacted — the exact problem the tool exists to prevent.

The engine change is small and surgical: the campaign state machine's Phase 2 (`search`) becomes
pluggable. Phases 1, 3 and 4 are untouched. **No existing behaviour changes.**

---

## 4. Method 1 workflow — competitor backlinks

```
1  You enter one or more competitor domains (or paste a Semrush export)
2  Candidates arrive as a list of referring domains
3  Automatic filtering          ← the part that replaces your manual cleanup
4  Candidate preview            ← you approve / reject before anything opens
5  Dedupe against your database ← existing historyIndex(), unchanged
6  Research queue               ← existing engine, unchanged
7  Ready / Form / No email / Rejected, Sheet export
```

### Step 3 — the filters that replace your manual cleanup

> **Superseded by Section 12.** The design below was written before seeing a real Referring
> Domains export. Measured against your actual 949-row export, these pattern rules remove only
> **10 domains**, because your Semrush-side filters already remove that whole class of junk
> before export. Section 12 has what actually works. The rules below are kept because they still
> matter as a safety net and for anyone exporting without your filter preset.

This is the real work. Everything is a deterministic rule with a stated reason, so every
rejection is explainable — same principle as the existing screening.

**A. Link-type exclusions** (pattern match on source URL, anchor and title)

| Excluded | Detected by |
| --- | --- |
| Profile links | `/author/`, `/user/`, `/users/`, `/profile/`, `/member(s)/`, `/u/`, `/people/` |
| Comment links | `#comment`, `/comment-page-`, `?replytocom=`, `/disqus` |
| Forum links | `/forum/`, `/thread/`, `/topic/`, `viewtopic.php`, `showthread.php` |
| Directories & citations | curated host list (Yelp, Yellow Pages, BBB, Crunchbase, Manta, Foursquare, Trustpilot, Clutch …) plus `/listing/`, `/directory/`, `/business/` |
| Press-release syndication | PRNewswire, EIN Presswire, OpenPR, Issuewire … |
| Free Web 2.0 / likely PBN | blogspot, wordpress.com, weebly, wixsite, medium, substack subdomains |
| Platforms & social | **reuse the existing `R.platform()` list** — already battle-tested |
| Government / education | **reuse the existing `C.excluded()`** — already excludes .gov/.edu/.ac.uk |

**B. Attribute filters** — optional toggles: dofollow only, exclude sponsored, exclude UGC.

**C. Sitewide links** — footers and blogroll links are not editorial placements. Excluded when
Semrush flags sitewide, or when the source page has an unusually high external-link count.

**D. "Remove larger websites"** — this is already solved. 0.12 gave every metric both bounds,
so a **DR ceiling** and a **traffic ceiling** express "not the big media sites" directly. No new
mechanism needed; the Semrush campaign form reuses the same metric controls.

**E. Collapse to one row per domain** — if you export the Backlinks tab rather than Referring
Domains, the tool collapses to unique registrable domains, keeping the best-scoring example link
as evidence.

**F. PBN heuristics** — honest limitation: a PBN cannot be detected reliably from an export.
What *is* detectable and worth flagging rather than auto-rejecting: very low authority combined
with very high outbound link counts, thin TLDs, and referring domains whose first-seen dates all
cluster on the same day. I propose these **lower the score and get a warning label**, not an
automatic rejection — consistent with your standing rule that uncertainty should keep the site.

### Step 4 — candidate preview

Before a single tab opens, you see the candidate list with: domain, authority, how many of your
filters it passed, why anything was excluded, and whether it is already in your database. You
bulk-approve or reject. **Nothing is researched until you say so**, so a bad filter setting costs
you nothing but a glance.

---

## 5. Method 2 workflow — organic competitors

Same shape, simpler filtering, one addition.

```
1  You enter a seed blog (or paste the Competitors export)
2  Candidates = competing domains + Com. Level, Common Keywords, SE Keywords, Traffic
3  Filtering (thresholds below are measured against your real export, Section 11):
     - MINIMUM COMMON KEYWORDS - the strongest signal by far. Everything with 1-2 shared
       keywords is pure noise (Ralph Lauren, cancer.gov, TripAdvisor).
     - TRAFFIC BAND, not a floor, to exclude dead sites and media companies alike
     - CONTENT SHAPE (traffic per keyword) - separates blogs from local businesses
     - exclude platforms, marketplaces, aggregators (reuse R.platform + list)
     - NOT Competition Level: it does not discriminate in practice
4  Candidate preview
5  Dedupe → research queue → existing pipeline
```

**The addition worth having: expansion.** Each competitor you find is itself a valid seed. With a
depth limit (say 2) and a cap on total candidates, one seed blog can map a whole niche
neighbourhood. This is the single biggest multiplier in either method, and it is cheap to build
once the single-seed flow works — but it multiplies Semrush requests, so it belongs behind an
explicit "expand" control with a visible budget, not on by default.

---

## 6. Technical approach — three phases, in build order

### Phase 1 — Import what you export (**recommended first; build this one**)

You apply your filters in Semrush, click Export, drop the CSV/XLSX into the Semrush dashboard.

- **Works today.** The tool already has a CSV parser and an XLSX parser
  (`publisher-sheets.js`) and an import flow. Reuse both.
- **No ToS scraping. No ban risk** to the shared account.
- **Works regardless** of whether you use the proxy or a real login.
- Column mapping is auto-detected from headers, with a manual mapping screen as a fallback, so a
  Semrush column rename does not break it.
- Effort: small. Risk: low. This alone removes the whole manual cleanup stage, which is the part
  you said takes the time.

### Phase 2 — Read the report from a tab you already have open (optional convenience)

A collector like the existing Google one, injected into a Semrush report tab **you** opened and
logged into, reading the visible table.

- Removes the export/import step.
- **Fragile by nature:** Semrush's tables are virtualised — only the rows currently on screen
  exist in the page — so reading everything means programmatic scrolling, which is exactly the
  behaviour that triggers bot detection and gets shared accounts suspended.
- Against the proxy, selectors are reading a rewritten page and may break at any time.
- Mitigation if you want it: read only what is already on screen, never auto-scroll or
  auto-paginate, and treat it as "grab this page" rather than "harvest this report". That keeps
  it closer to a clipboard than a crawler.
- **My recommendation: do not build this until Phase 1 is in daily use** and you can say whether
  the export step is actually a problem worth this risk.

### Phase 3 — Official API adapter (only if the economics ever change)

Design the discovery layer as an interface with three implementations (`import`, `page`, `api`)
so this is a drop-in later. Endpoints would be `backlinks_refdomains` (40 units/row) and
`domain_organic_organic` (40 units/row). Not worth building now.

---

## 7. Dedupe — no new mechanism

Semrush candidates go through **exactly the same checks**, in the same order, as Google results:

1. Domain-level contacted check (one contacted address excludes the whole domain)
2. Already-in-your-sources check
3. Per-campaign "opened once" rule
4. Global do-not-contact flags

Plus one Semrush-specific addition: **cross-seed dedupe**. Two competitors usually share
referring domains, so the dashboard shows "found via 3 of your 5 seeds" — overlap is a quality
signal worth surfacing, not just noise to remove.

Each lead records **how it was found** (`source`, seed domain, and for Method 1 the example link
URL and anchor) so the Sheet and CSV can tell you where a prospect came from.

---

## 8. What I need from you before building

The single most useful thing: **one real export of each report**, even with the domains
scrambled. It pins the exact column headers, which is the only part I genuinely cannot guess.

1. ~~Referring Domains export~~ — **received and analysed, see Section 12.**
2. ~~Organic Competitors export~~ — **received and analysed, see Section 11.**
3. **Your category calls.** Section 12.3 splits Semrush's 73 categories into publishers vs local
   business. Tell me any you would move, especially `online_services` (116 domains, the largest
   single group and genuinely ambiguous).
4. **Does the Export button work**, or are these files captured from network traffic? It changes
   how robust the importer can be, not whether it works.
4. **Screenshot of your filter panel** in Backlink Analytics with your usual settings applied —
   I want to copy your real rules, not invent plausible ones.
5. **Does Export work on your account?** Click it once and tell me. If the group-buy account
   blocks export, Phase 1 is dead and we have to talk about Phase 2 or a real subscription.
6. A list of any sites you **always** reject on sight, and any you always keep. Those become the
   starting blocklist and allowlist.

---

## 11. Confirmed from your real exports

Three files were supplied. Two were not usable; the third was, and it changes the plan for the
better.

### 11.1 What each file actually was

| File | Verdict |
| --- | --- |
| `semrush-api-export-530.csv` | **Not backlinks.** 530 rows of *Backlink Audit project* metadata (projectId, folderId, toxicCount, recrawl settings) for 48 unrelated domains under one shared `userId`. `backlinksCount` was `0` on every row — no link data was ever collected. Wrong tool: Backlink **Audit** audits your own site; Backlink **Analytics** is the one that profiles any domain. |
| `semrush-api-export-20.csv` | **No data.** 20 repeats of `{"code":-32107,"message":"Report limits exceeded"}` — the shared account had exhausted its report allowance. |
| `semrush-api-export-4.csv` | **Real Organic Competitors data.** 100 competitor rows. Usable. |

**So we still need a Referring Domains export for Method 1.** Everything below applies to
Method 2 only.

### 11.2 The real export format (important — it is not a normal CSV table)

The file is a **JSON-RPC envelope**, not a spreadsheet. Three CSV columns — `jsonrpc`, `id`,
`result` — and the entire payload is a JSON array crammed into one `result` cell. A second row
carries the total count.

```
"jsonrpc","id","result"
"2.0","10","[{...100 competitor objects...}]"
"2.0","11","7997"                      <- total competitors available
"2.0","10","{""code"":-32107,...}"      <- and more limit errors in the same file
```

Each competitor object has **13 fields**:

```json
{ "domain": "charlestonmoms.com", "commonKeywords": 40, "competitionLvl": 0.01,
  "organicPositions": 8043, "organicTraffic": 8793, "organicTrafficCost": 5827,
  "positions": 8540, "adwordsPositions": 0, "traffic": 10259, "trafficCost": 6528,
  "serpFeaturesPositions": 497, "serpFeaturesTraffic": 1466, "serpFeaturesTrafficCost": 701 }
```

Two consequences:

- **The importer must detect and unwrap this envelope**, not just read columns. Easy to do, but
  it has to be deliberate. It should also accept a plain Semrush UI CSV, so either kind of
  export works.
- **This format is richer than the UI table** (13 fields vs 6), which gives us better filters
  than we would have had from the screen.

### 11.3 Filter thresholds, measured against your data

Starting set: 100 competitors of a Charleston city/lifestyle seed.

**Common Keywords is the signal. Competition Level is not.**
`competitionLvl` ranged only 0 to 0.06 across all 100 rows — too compressed to separate anything,
and note it is a **0-1 fraction**, so a UI "6%" is `0.06`. Meanwhile `commonKeywords` ranged 1 to
516 with a median of 15. **22 rows had exactly 1 shared keyword**, and they are exactly the
garbage: `ralphlauren.com`, `cancer.gov`, `ratemyprofessors.com`, `rallyhouse.com`,
`tripadvisor.ca`, `rfc-editor.org`, `fisdogpark.wordpress.com`.

**A traffic band removes the giants.** Nine domains exceeded 200k organic traffic — national
media and retailers that will never take a guest post.

**New discovery: filter on content shape.** A blog ranks for many keywords relative to its
traffic. A restaurant or venue gets most of its traffic from its own brand name on few keywords.
Dividing `organicTraffic / organicPositions` separates them cleanly:

| Shape | Example | Keywords | Traffic | Traffic per keyword |
| --- | --- | --- | --- | --- |
| Content site | charlestonmoms.com | 8,043 | 8,793 | **1.1** |
| Content site | mountpleasantmagazine.com | 5,811 | 3,749 | **0.7** |
| Local business | poogansporch.com | 948 | 37,440 | **39.5** |
| Local business | highcottoncharleston.com | 439 | 20,490 | **46.7** |

A ceiling of about **5 traffic per keyword** drops restaurants, breweries, music halls and
wedding venues while keeping every blog and magazine.

**The cascade, on your real data:**

```
100 competitors returned
 ->  47  after commonKeywords >= 10 and organicTraffic between 1k and 60k
 ->  33  after traffic-per-keyword <= 5
```

The 33 survivors are the right kind of site — charlestonguru, charlestoncitypaper, charlestonmag,
charlestondaily, charlestonmoms, mountpleasantmagazine, travelerofcharleston, fashiongtonpost.
The 14 dropped at the last step were all restaurants and venues.

**Two thirds of the manual cleanup disappears with three numeric rules.** The remaining third is
what your existing engine already does: open the site and look for a contribution route.

These numbers become the **defaults**, every one adjustable per campaign, with a live count of
what each rule removes.

### 11.4 What this proves about access

- **Export partially works.** The same file contains both a successful 100-row result and
  "Report limits exceeded" errors. The shared account is rate-limited, not dead.
- **100 of 7,997 returned.** Getting the rest means repeated paginated calls against an account
  that is already hitting limits — so expect to work from the first page, or from several
  different seeds, rather than exhausting one report.
- **This is captured network traffic, not the Export button.** Worth one test: open the
  Competitors report and press Export. If a normal CSV downloads, the importer gets simpler and
  more stable. If it is blocked, the envelope format above is what we build for.

---

## 12. Method 1 measured against your real export

949 referring domains, exported as a **plain CSV table** this time (not the JSON-RPC envelope
Method 2 produced), with 11 columns:

```
domain, backlinks_num, first_seen, last_seen, ip, country,
domain_ascore, category, lost, new, is_follow
```

### 12.1 Your Semrush filters are already doing most of the work

The export tells me exactly what you set before exporting, because every row agrees:

| Field | Every row | Meaning |
| --- | --- | --- |
| `is_follow` | `true` | you filtered to dofollow only |
| `lost` | `false` | active links only |
| `domain_ascore` | 20 to 50 | you applied an Authority Score **range**, not a floor |
| `backlinks_num` | median 1, max 8 | no sitewide/blogroll links survive that range |

**Treat this as your preset** and have the tool state it on screen, so an export made with
different settings is obvious rather than silently producing different results.

### 12.2 I was wrong about what needs filtering

My original design (Section 4) targeted profile links, comment links, directories, forums, PBNs
and platforms. Run against your real export, the entire set of those rules removes **10 domains
out of 949**:

```
platform hosts ......  0
directories/citations  0
forums ..............  1
gov / edu ...........  9
free subdomains .....  0
```

The reason is simple: **Authority Score 20–50 already excludes them.** Platforms and big
directories sit at 80–100; spam and dead PBNs sit below 20. Your range filter cuts both ends off
before the file is ever written.

So the automated cleanup I proposed solves a problem you had already solved. Worth saying
plainly rather than shipping rules that look busy and do nothing.

### 12.3 What is actually left to filter

Looking at what survives, the real noise is **businesses that will never publish a guest post** —
restaurants, hotels, estate agents, builders, retailers. Semrush hands us a usable lever here: a
`category` field, with 73 distinct values in your file.

```
Likely publishers (media, publishing, travel, lifestyle, IT, marketing …)   420  (44%)
Likely local business (hospitality, real estate, retail, restaurants …)     257  (27%)
Unclassified / ambiguous                                                    272  (29%)
```

The three biggest single categories are `online_services` (116), blank (95) and `hospitality` (86).

**Proposal:** a category allow/deny list, pre-filled with the split above and fully editable,
shown as a live count ("excluding 257 of 949"). Blank categories are **kept**, consistent with
the standing rule that uncertainty keeps the site.

Applying pattern rules plus a business-category deny list:

```
949 referring domains
 -> 939  after pattern rules (platforms, forums, gov/edu)
 -> 685  after excluding local-business categories      (28% removed)
```

### 12.4 The honest conclusion for Method 1

Semrush cannot tell us whether a site accepts contributions. `category` narrows it; only opening
the site proves it — and that is exactly what your engine already does well.

So **Method 1's value is not clever filtering. It is volume plus deduplication**: turning one
competitor into ~685 pre-qualified candidates, automatically stripped of everything you have
already contacted, fed to the existing pipeline overnight.

For scale: 685 sites at the default 75s budget, 5 at a time, is roughly **3 hours** of unattended
running — and far less after your database removes the ones you already know. That is the right
order of magnitude for an overnight job, and it is the single biggest argument for building this.

---

## 9. Honest limitations

- **Semrush data is a crawl, not truth.** Links shown may be lost; first/last-seen dates lag.
- **A referring domain is not a guest-post opportunity.** Semrush narrows the field; only opening
  the site proves it — which your existing engine already does well. Expect the same ratio of
  ready-to-rejected you see from Google.
- **Group-buy accounts can disappear mid-run.** Whatever we build must save progress and fail
  with a clear message, like the Apps Script connections now do.
- **PBN detection is a heuristic, not a verdict.** See 4F.
- **Export row caps** depend on plan and may be low or absent on a shared account.
- **If you ever get a real Semrush subscription**, Phase 2 becomes much safer and Phase 3 becomes
  possible. Worth factoring into the decision.

---

## 10. Recommendation

Build **Phase 1 for both methods**: import, filter, preview, dedupe, hand to the existing
pipeline, under a new **Semrush** section with two tabs.

It removes the manual cleanup — the part that actually costs you time — it carries no risk to
your Semrush access, it works with the account you have today, and it reuses the entire research
and qualification engine without touching it.

Decide on Phase 2 after you have used Phase 1 for a week and can say whether exporting a file is
genuinely worse than risking the account.

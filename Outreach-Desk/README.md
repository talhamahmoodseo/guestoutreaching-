# Outreach Desk 0.12

A Chrome extension for researching publisher contacts and organizing outreach by campaign. The existing research collector and contact extraction remain intact; this release reorganizes the workflow around them.

## Install or upgrade

1. In the existing extension, open **Settings → Download backup** and stop active research.
2. Replace files in the existing unpacked extension directory with the new **Outreach-Desk/extension** files, then choose **Reload** at chrome://extensions. Keeping the same directory preserves its identity and local data.
3. For a first installation, enable **Developer mode**, choose **Load unpacked**, and select **Outreach-Desk/extension**, the directory containing manifest.json.
4. Open the extension icon, then **Dashboard**.

No build or package installation is required to use the extension. Keep Chrome open during research and background recovery. Data stays in your Chrome profile. Installing in a different directory can create separate storage; restore your backup if needed.

## Workspace

| Page | Purpose |
| --- | --- |
| Campaigns | Start, pause, resume and review campaigns, keyword performance and activity |
| Research results | Review Ready, Form only, No email and Rejected results; inspect evidence |
| Research sources | Public read-only Google Sheets and imported XLSX/CSV history |
| Email history | Independently connected Gmail accounts and their health |
| Export destinations | Writable output Sheet, manual/automatic delivery and pending exports |
| Settings | Research defaults, missing-metric recovery, sender profiles, optional Gemini and backups |

The product architecture and migration policy are documented in docs/PRODUCT-STRUCTURE.md.

## Research workflow

Connect reference lists in **Research sources**. Public Sheets detect their names, index workbook tabs automatically, refresh before a campaign when older than 15 minutes, and refresh hourly while idle. Uploaded files are snapshots. Explicit Contacted, Follow-up, Responded, Negotiating, Agreed, Declined and Do not contact statuses inform contact history.

Connect each sending mailbox separately in **Email history**, using the included Apps Script. New campaigns can choose which connected accounts to check. Sender profiles only supply form draft details; they do not authenticate mailboxes. Sent-mail checks return matched addresses and dates, not message bodies.

Start a campaign with its niche, keywords or website list, language, target and optional criteria. DA, DR, spam, domain age and traffic each support minimum and maximum bounds. Campaign metric screening uses visible SEO-extension badges on Google, so manual URL lists cannot use those screening filters. Missing metrics follow the campaign's keep/skip setting.

Progress shows discovered sites, sites whose pages were actually read, Ready, Rejected, No email, Form only and Pending. The percentage measures processing of the websites discovered so far; discovery may increase the denominator. The outreach target is shown separately. Reaching it can leave a saved queue that **Research waiting** will drain.

Review results and inspect evidence. **Copy main email** requires one selected result. **Export CSV** uses the selected rows or current filtered view. **Send to Sheet** queues selected researched results and delivers them in the background.

## Connections and exports

Follow sheets-apps-script/SETUP.md. New output destinations never become research sources or Gmail connections automatically. Enable **Also use this destination as contact history** only when that is intended. Existing installations retain their previous output-history behavior through migration; they can turn it off on the destination page.

Manual delivery is the default. Automatic mode sends newly qualifying Ready results, including Form only results when the campaign counts them toward its target. Existing sent results stay synchronized after edits or metric recovery. Delivery jobs survive worker restarts and transient failures. Deliver or explicitly discard pending jobs before switching or disconnecting the destination.

Network timeouts, HTTP 404/429 and server failures retry with bounded backoff. Configuration and the last verified time remain saved. Authentication and malformed response errors show **Needs attention** with the reason. History-dependent research waits when checks cannot be verified; it does not silently treat unknown contacts as new. Transiently blocked campaigns retry automatically. Connection probes and hourly source refreshes run while research is idle.

## Metrics recovery

By default, after a campaign finishes, the extension makes one recovery pass for missing metrics on researched, non-rejected sites. It merges partial toolbar values and tries Google result badges for gaps. Disable this under **Settings → Research** if desired. Manual **Recheck metrics** remains available on selected results. Recovery is queued durably; unreadable values remain explicit and are never invented.

Browser isolation can prevent reading another extension's private frame or closed shadow tree. Google verification, provider availability and your actual SEO-extension installation can still leave missing values. Ready denotes an outreach contact opportunity; inspect evidence and metric filters before exporting.

## Optional Gemini, backups and limits

Gemini is optional. It receives limited public page evidence and published contacts; local research continues on API failure. It cannot add unobserved email addresses. Your key and output secret remain separate from backups. Backups omit the output URL and delivery queue; reconnect destinations and Gmail in a new Chrome profile. Public source URLs and research evidence are included.

Research does not send emails, submit contact forms or bypass verification. Published contacts are not delivery-verified. Your actual Gmail, Sheets, Gemini credentials and SEO extension need testing in your Chrome profile.

## Development

Install the existing package-lock dependencies with npm ci, then run npm test. Use npm run preview:fixtures and npm run dev for the synthetic dashboard preview. The production vendor bundle is already included. The optional tests/e2e-product.cjs smoke test uses Playwright and an extension-capable Chromium browser. Validation details are in docs/VALIDATION.md.

# Outreach Desk 0.12 product structure

The existing collector, publisher relevance rules, email extraction, navigation and campaign identity remain the research engine. This release restructures its surrounding workflow.

| Area | Purpose | Primary action |
| --- | --- | --- |
| Campaigns | Goals, criteria, progress and history | New campaign, resume, review results |
| Research results | Review campaign findings by Ready, Form only, No email, Rejected | Copy main email, CSV, send selected rows |
| Research sources | Public Sheets and uploaded lists for duplicate/contact checks | Connect once; refresh automatically |
| Email history | Explicitly selected sent-mail accounts, health and recovery | Connect or test account |
| Export destinations | Writable output, manual/automatic mode, durable delivery queue | Connect destination, retry delivery |
| Settings | Research defaults, sender profiles, AI and backups | Save preferences |

Output does not become a research source implicitly. Existing output-history integrations are migrated to a separate explicit setting on the destination, preserving the user's previous behavior. Gmail accounts remain independent of their output destination.

Connection configuration and health are separate. Transient failures preserve credentials, cached data and last success, retry with bounded backoff, and show the actual reason. An unverified history lookup cannot count as not contacted. Public sources refresh after connection, before a campaign when stale, and periodically while idle. Failed refreshes retain the prior index but block history-dependent research until verified.

Exports are durable jobs. Manual exports enqueue selected rows before delivery; automatic exports enqueue qualifying results. A restart must not discard unsent rows. Pending exports are scoped to the saved destination and do not block research.

Progress separates target attainment from processing: discovered, actually researched, Ready, rejected, No email, form only, and pending. Processing percentage is relative to discovered websites and can change as discovery continues; reaching a contact target can leave a saved queue.

DA, DR, spam, age and traffic each have optional minimum and maximum bounds, matching campaign and result filtering. Missing values stay explicit. Rechecks merge partial metrics and keep in-flight work durable through worker restarts.

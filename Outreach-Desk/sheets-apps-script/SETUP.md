# Apps Script setup (Output Sheet, history and sent-mail checks)

One script does three jobs:

1. **Output Sheet**: results you select and click **Send to Sheet** go into an `Outreach` tab with clean columns: Date, Campaign, Domain, Website, Best Email, All Emails, Contact Page, Language, DA, DR, Spam Score, Domain Age, Outreach Status, Notes. Rows match by domain + campaign, so sending again or rechecking metrics updates the row instead of duplicating it. Your Outreach Status, Notes and any columns you add are never overwritten.
2. **History**: rows in `Outreach` (and older `Useful`/`Rejected` tabs) you mark Contacted, Follow-up, Responded, Negotiating, Agreed, Declined or Do not contact are skipped in future campaigns, at domain level. Any extra tab you add to the Sheet (old outreach lists, IMPORTRANGE copies) also counts as history. Tabs starting with `_` are ignored.
3. **Sent mail**: answers "did I already email this domain?" from the Gmail account that deployed the script. It returns only yes/no, the date and the matched address.

## Output Sheet (do this once)

1. Create a new Google Sheet. Open **Extensions > Apps Script**.
2. Replace `Code.gs` with this folder's `Code.gs`.
3. Open **Project Settings**, tick **Show "appsscript.json" manifest file**, go back to the editor and replace `appsscript.json` with this folder's file. This limits the script to *this Sheet only* and *read-only Gmail*.
4. **Deploy > New deployment > Web app**. Execute as: **Me**. Who has access: **Anyone**. Click Deploy and approve the permissions. Google shows "Google hasn't verified this app" because it is your own script: choose Advanced, then Go to (project name).
5. Copy the URL ending in `/exec`. In Outreach Desk open **Sources & history > Output Sheet**, paste it and click **Connect and test**. Keep "Also check this Google account's sent mail" ticked if you send outreach from this Gmail.

## Extra Gmail accounts

For each other account you send outreach from: sign in to that account, open script.google.com, **New project**, paste the same `Code.gs` and `appsscript.json`, deploy as a Web app (Me, Anyone) and add the URL under **Sources & history > Email accounts**.

## Upgrading from 0.7

Paste the new `Code.gs` and deploy a new version. A new `Outreach` tab is created on the first send. Old `Useful`/`Rejected` tabs stay and still count as history by their status; delete them if you no longer need them.

## Updating the script later

Paste the new code, then **Deploy > Manage deployments > Edit (pencil) > Version: New version > Deploy**. The URL stays the same.

## About the secret

The `/exec` URL is a long private address, so no secret is needed for normal use. If you ever share the URL (for example in a screenshot), set `const SECRET = 'something-long'` at the top of `Code.gs`, redeploy, and paste the same secret in the extension.

## Troubleshooting

- **"returned a Google sign-in page"**: the deployment access is not "Anyone". Edit the deployment and change it.
- **"not inside a Sheet"**: you deployed a standalone project as the Output Sheet. Use Extensions > Apps Script from inside the Sheet.
- **Workspace accounts**: an administrator can block "Anyone" deployments or Gmail access for scripts. Use a personal Gmail for the script if that happens.
- Gmail search quotas are generous for this use. Results are cached for 14 days (positive matches forever), so the same domain is not searched twice.

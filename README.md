# AMP — Personal Space

AMP is a browser-based personal dashboard for Property, Discipline, Life Admin and Goals. The existing design and modules are retained. This source adds a tax planning calculator inside **Property → Tools & records → UK tax calculator** and strengthens backup and restore. Optional profile and property photos personalise Home and Property without changing the existing palette or icons. Discipline gains consistency badges, editable badge points and weekly/monthly reviews.

This profile/photo update builds on the published tax release of `parash-AMP/my-first-app` at commit `bf5f7619d3376e4ae13ad0f8f3958516fc537d1d`. It is source code only: no personal records, exported backups, email contents or document attachments are bundled.

## Profile and property photos

Use the **Your profile** button beside Backup & privacy, or **Make it yours** on Home, to add an optional display name, a status of up to 160 characters and a profile photo. Photos save immediately; **Save profile** applies the name and status. On a property detail page, choose **Add photo**, **Change photo** or **Remove photo**. Each property has one photo, also shown as a thumbnail in the portfolio list. No theme/icon customisation is added, and existing habit checkmarks, goals, admin and tax calculations are retained. The separate Discipline rewards layer is described below.

Profile metadata uses the optional `amp-profile-v1` localStorage key; compressed photos are Blob records in the existing `amp-documents` IndexedDB database, upgraded additively to version 2 with a `photos` store. Existing document records are retained. Startup does not rewrite the original app/property/tax keys. A new photo is prepared and saved before changing its reference; failure retains the previous image. Profile writes guard against stale edits from another tab. Close older AMP tabs if they block the storage upgrade.

JPEG, PNG and WebP uploads are accepted up to 25 MB, plus iPhone HEIC/HEIF when the browser can decode them. Images are resized to at most 512px for avatars and 1600px for property photos, rasterised to JPEG without retaining original image metadata, and limited to 350 KB/1.5 MB respectively. The app accepts no SVG photos. Unsupported images and insufficient storage produce an error without replacing the saved image.

Photos are private browser data, included in complete exports. They are not published to GitHub or synced to another device. **Add missing details** preserves the current profile and photos. A full v3 restore replaces them; full v1/v2 restores preserve them because those older files have no photo section.

## Consistency badges and reviews

Each habit earns a consistency badge after seven consecutive checked calendar dates. A continuing streak earns another badge at 14, 21 days and onward. Separate streaks can earn further seven-day blocks. Dates already used by an earned badge cannot be reused after editing old checkmarks. Future and invalid dates do not earn rewards. Earlier qualifying history is recognised when loading the app, without rewriting its checkmarks.

Badges remain earned after a streak breaks, a habit is renamed or a habit is removed. Your profile lists recent badges and a status level: **one level for each different habit with an earned badge**. Repeating the same habit's badge adds points without adding another status level. New awards have a small unlock celebration; loading historical awards does not replay old celebrations.

**Points are earned only when a badge unlocks**, not for daily check-ins. In Discipline's review, select **Set points** for a task to choose a whole number from 0 to 1,000; the default is 10. Every weekly and monthly review prices each badge using that task's **current** allocation. Changing a value mid-month therefore recalculates earlier badges too. No frozen points ledger or cash rewards are involved.

Review weeks run Monday–Sunday; months are calendar months. Choose a date in the desired period and select **Show review**. Counts use the badge's earned date, up to today. Existing habit data remains under its original key; badge history and optional point allocations are separate under `amp-achievements-v1` and included in complete backups. Removed habits retain their badge names and points for reviews.

## Tax calculator

The calculator covers an England taxpayer's employment income and sole-owned ordinary UK residential rentals, using verified tax-year rules for **2020/21–2026/27**. Each year has separate saved settings. Future years must be added with verified rules before use.

It combines taxable employment pay, PAYE Income Tax already deducted, rental receipts, reviewed allowable costs, eligible residential finance-cost relief, carried-forward property losses and unused finance costs. Eligible relief-at-source pension contributions and Gift Aid can be entered. The January estimate separates the balancing amount from the first next-year payment on account; July shows the second instalment. Previous payments on account reduce the balance without changing the next instalments' calculation base.

- Enter actual taxable employment pay from a P60 or supported records; no personal pay figure is shipped in the code. Do not include National Insurance in PAYE tax deducted.
- Recorded transactions are filtered by UK tax-year dates, 6 April–5 April. Review each record's tax treatment and eligible amount before relying on the result. Reviews are stored separately; the source transaction stays unchanged. Changed source records require a fresh review.
- Scheduled monthly rent is not assumed to have been received. An annual rental-receipts total can replace reviewed income records. An annual eligible finance-cost total can replace finance-cost records, preventing double counting.
- Mortgage capital repayments, personal costs and capital improvements are not running-expense deductions. The full mortgage payment must not be entered as eligible interest.
- The £1,000 travel figure is an editable **what-if estimate**, excluded from the main calculation. Enter only evidenced eligible additional travel that is not already recorded as an expense. Do not combine mileage and actual vehicle running costs for the same vehicle.
- An unfinished year's rental records are to date while employment input is annual. The result is not an automatic full-year forecast.
- Missing PAYE, unreviewed records or incomplete scope checks prevent the headline January/July estimate from being presented as ready. If imported payroll evidence indicates student-loan deductions and the repayment plan is unconfirmed, an explicit review flag blocks the complete January payment even when the scope check is ticked. Unresolved source-review flags also prevent the headline complete January result from being treated as ready. The calculator still covers Income Tax only.

This is a planning estimate using pennies; HMRC's return-box rounding can differ. It is not a submitted tax return or an HMRC-approved computation. Other income, student loans, Child Benefit charges, disposals, joint/company ownership, foreign matters, special allowances, pension allowance charges and Gift Aid shortfalls are outside this calculator's scope. Leave the scope confirmation unticked when they apply.

Official references are linked in the app and in `tax-engine.js`, including [Income Tax rates](https://www.gov.uk/government/publications/rates-and-allowances-income-tax/income-tax-rates-and-allowances-current-and-past), [rental income and expenses](https://www.gov.uk/guidance/income-tax-when-you-rent-out-a-property-working-out-your-rental-income), [residential finance-cost relief](https://www.gov.uk/guidance/changes-to-tax-relief-for-residential-landlords-how-its-worked-out-including-case-studies), [payments on account](https://www.gov.uk/understand-self-assessment-bill/payments-on-account), and [property-business travel](https://www.gov.uk/hmrc-internal-manuals/property-income-manual/pim2220).

## Existing records and migration

Existing records remain under their original localStorage keys:

- `amp-personal-space-v1`: habits, check-ins, goals and Life Admin cases.
- `property-manager-v1`: properties and transactions.
- `amp-tax-v1`: separate versioned tax settings.
- `amp-profile-v1`: optional profile name, status and photo references; photos are separate IndexedDB Blobs.
- `amp-achievements-v1`: earned habit badges and optional point allocations.

Saving tax settings does not rewrite the original two keys. The first tax save retains their exact original raw contents under `amp-before-tax-v1`. This small local recovery snapshot does not contain attached documents and is not a substitute for a complete exported backup. Loading and ordinary saves preserve unknown fields. Ordinary saving is blocked if existing stored records cannot be read, and a failed two-key save attempts to restore their previous values.

There is no automatic migration between devices, browser profiles or website origins. Existing records are expected to remain available only when the updated app opens at the **same existing app address in the same browser/profile**. A desktop preview has separate browser storage from an iPhone.

## Add missing details from a private backup

After the live code is updated, use **Backup & privacy → Add missing details from private backup** for an assistant-enriched backup. This additive import is the recommended way to bring selected document findings into an iPhone that may have newer activity than the exported backup.

The importer matches existing property IDs and fills only missing supported details, such as address, lender, rate, fixed-rate end date and document references, plus missing tax settings. It does not replace newer habit check-ins, goals, Life Admin cases, transactions, balances or mortgage payments. It does not recreate properties that have since been deleted. Existing populated values are retained; uncertain document information still needs review. Imported mortgage rate evidence does not start or alter a mortgage projection until the user explicitly saves projection settings. Unresolved payroll evidence has a separate review confirmation before the source-review block can be cleared.

Export a fresh complete backup on the original device first, then review the additive import and verify the new details. An enriched backup contains private records and evidence: keep it separate from the source repository. Additive import is different from full restore below.

## Full backup and restore

Use **Backup & privacy → Export everything** before an update and keep that file in a safe location.

- New complete exports use `amp-backup-v3` and include all modules, transactions, tax settings, locally attached documents, profile details, compressed photos, earned badges and point allocations. Export stops if documents cannot be read; it does not silently omit them.
- The updated importer accepts older **AMP-wide `amp-backup-v1`** files, v2 files and new v3 files. A v1 full restore has no tax settings, so it restores an empty tax section. Full v1/v2 restores keep the current profile, photos and badges; v3 restores replace supplied profile/photo sections and badge data. Earlier v3 files without a badge section also preserve current badges. The full-restore action explicitly replaces all ordinary records; choose the separate additive import for an enriched backup when current device activity must be preserved.
- Old property-only exports are not AMP-wide v1 files and are not directly supported by this importer.
- Restore validates records and decodes every attachment/photo before any replacement. It stores a complete pre-restore snapshot, including native document/photo Blobs, in the separate `amp-backup-recovery` IndexedDB database. Documents and photos are replaced together in one completed transaction. The older `amp-before-restore-v1` recovery remains downloadable as a fallback.
- If the complete recovery copy cannot fit, restore refuses to replace current data. For ordinary restore failures, it attempts to roll localStorage back. The recovery copy can be downloaded from Backup & privacy.
- localStorage and IndexedDB cannot be committed as one transaction. A browser/device crash between stages is still a risk; keep the exported backup. Browser storage can be cleared or evicted and is not encrypted.
- Older AMP code does not understand v3 exports or the upgraded photo store. Keep earlier backups and use this compatible app version to export/restore profiles and photos; rolling back older source does not convert the newer database.

## Safe rollout and rollback

1. Export a complete backup from the existing live app on the device that holds the records. Keep it separate from this source.
2. Review/test the source and its migration using a private copy of that backup. Check properties, transactions, habit history, goals, cases and attachments.
3. Obtain approval for the live change. Updating the production branch may automatically trigger GitHub Pages; this source archive does not deploy itself.
4. Deploy all source assets together at the existing app address. Do not change the origin or clear the device's browser data. Close other AMP tabs during restore/update checks.
5. Verify record counts and key records on the original device. To add assistant-reviewed document findings, use **Add missing details from private backup** after the new code is live. Do not use full restore solely to add those details, because an older snapshot could replace newer phone activity.
6. Verify imported details, add missing tax inputs and review costs before relying on tax figures.
7. Keep the pre-update code revision and the original backup. To roll code back, restore the previous source revision at the same address. Separate tax/profile/achievement keys can remain retained; a compatible database reader is still needed for version 2 documents/photos. If data restoration is needed, use a compatible backup with the appropriate app version and verify it before replacing current records.

## Privacy and connectivity

The app has no analytics, cloud database, AI API or Gmail integration. It does not send entered records to GitHub, HMRC or an AI service. External reference links open only when selected. Browser records stay on the current device; the offline service worker caches app assets. Do not commit personal backups, documents, email evidence, credentials or tax figures to a public repository.

Evidence can be reviewed separately by an assistant and added through the additive private-backup importer. The app can display generic tax evidence references and property document references, including lender/rate details when present in local records. Confirmed annual figures may fill empty inputs; payslip snapshots, mortgage offers and uncertain costs remain references rather than assumed full-year receipts or deductions. These private evidence records belong only in browser storage and private backups, never in this source package.

There is no Gmail sync, Gmail API connection or document-extraction service in the runtime app. Any assistant-assisted email review happens outside the app with the user’s authorization; using the additive private-backup importer is the separate step that brings selected records into this device’s local app data.

## Run and verify

No application dependencies or build step are required. Serve the folder with a local static server, for example `python3 -m http.server 8765`, and open its local address. Opening `index.html` directly does not exercise service-worker/offline behaviour.

Use Node.js 20 or newer for the verification suite:

```sh
node --test tests/*.test.cjs
```

The suite uses synthetic fixtures only; 143 tests pass in this packaged layout. It covers tax bands and allowances, losses, finance relief, pension/Gift Aid effects, payments on account, date filtering, separate-year settings, exact legacy-record preservation, corrupt/quota failures, complete backup validation, profile/photo preservation, failed/concurrent uploads, consistency awards, badge-only points and retroactive reviews, v1/v2 compatibility and restore rollback. A real-device backup/export/restore check is still needed; the automated IndexedDB tests use a transactional stub.

## Files

`index.html`, `styles.css` and `app.js` provide the existing app shell and modules. `tax-engine.js` contains the pure tax calculations; `tax-ui.js` provides the Property tax screen; `backup.js` validates and restores complete backups; `enrichment.js` adds supported missing details without full replacement. `manifest.json`, the icons and `sw.js` support installation and offline assets. `tests/` contains public-safe synthetic verification fixtures.

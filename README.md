# AMP — Personal Space

AMP is a browser-based personal dashboard for Property, Discipline, Life Admin and Goals. The existing design and modules are retained. This source adds a tax planning calculator inside **Property → Tools & records → UK tax calculator** and strengthens backup and restore.

This draft is based on `parash-AMP/my-first-app` at commit `935e6720049ffe467658749b7fccd0b828cd45ac`. It is source code only: no personal records, exported backups, email contents or document attachments are bundled.

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
- `amp-tax-v1`: new, separate versioned tax settings.

Saving tax settings does not rewrite the original two keys. The first tax save retains their exact original raw contents under `amp-before-tax-v1`. This small local recovery snapshot does not contain attached documents and is not a substitute for a complete exported backup. Loading and ordinary saves preserve unknown fields. Ordinary saving is blocked if existing stored records cannot be read, and a failed two-key save attempts to restore their previous values.

There is no automatic migration between devices, browser profiles or website origins. Existing records are expected to remain available only when the updated app opens at the **same existing app address in the same browser/profile**. A desktop preview has separate browser storage from an iPhone.

## Add missing details from a private backup

After the live code is updated, use **Backup & privacy → Add missing details from private backup** for an assistant-enriched backup. This additive import is the recommended way to bring selected document findings into an iPhone that may have newer activity than the exported backup.

The importer matches existing property IDs and fills only missing supported details, such as address, lender, rate, fixed-rate end date and document references, plus missing tax settings. It does not replace newer habit check-ins, goals, Life Admin cases, transactions, balances or mortgage payments. It does not recreate properties that have since been deleted. Existing populated values are retained; uncertain document information still needs review. Imported mortgage rate evidence does not start or alter a mortgage projection until the user explicitly saves projection settings. Unresolved payroll evidence has a separate review confirmation before the source-review block can be cleared.

Export a fresh complete backup on the original device first, then review the additive import and verify the new details. An enriched backup contains private records and evidence: keep it separate from the source repository. Additive import is different from full restore below.

## Full backup and restore

Use **Backup & privacy → Export everything** before an update and keep that file in a safe location.

- New complete exports use `amp-backup-v2` and include all modules, transactions, tax settings and locally attached documents. Export stops if documents cannot be read; it does not silently omit them.
- The updated importer accepts older **AMP-wide `amp-backup-v1`** files and new v2 files. A v1 full restore has no tax settings, so it restores an empty tax section. The full-restore action explicitly replaces all records; choose the separate additive import for an enriched backup when current device activity must be preserved.
- Old property-only exports are not AMP-wide v1 files and are not directly supported by this importer.
- Restore validates records and decodes every attachment before any replacement. It stores a complete pre-restore recovery copy under `amp-before-restore-v1`, then restores document records in one completed IndexedDB transaction.
- If the complete recovery copy cannot fit, restore refuses to replace current data. For ordinary restore failures, it attempts to roll localStorage back. The recovery copy can be downloaded from Backup & privacy.
- localStorage and IndexedDB cannot be committed as one transaction. A browser/device crash between stages is still a risk; keep the exported backup. Browser storage can be cleared or evicted and is not encrypted.
- Older AMP code does not understand v2 exports. Retain the original v1 backup as well as a new export until the update is verified.

## Safe rollout and rollback

1. Export a complete backup from the existing live app on the device that holds the records. Keep it separate from this source.
2. Review/test the source and its migration using a private copy of that backup. Check properties, transactions, habit history, goals, cases and attachments.
3. Obtain approval for the live change. Updating the production branch may automatically trigger GitHub Pages; this source archive does not deploy itself.
4. Deploy all source assets together at the existing app address. Do not change the origin or clear the device's browser data. Close other AMP tabs during restore/update checks.
5. Verify record counts and key records on the original device. To add assistant-reviewed document findings, use **Add missing details from private backup** after the new code is live. Do not use full restore solely to add those details, because an older snapshot could replace newer phone activity.
6. Verify imported details, add missing tax inputs and review costs before relying on tax figures.
7. Keep the pre-update code revision and the original backup. To roll code back, restore the previous source revision at the same address. New tax keys can remain ignored by older code. If data restoration is needed, use a compatible backup with the appropriate app version and verify it before replacing current records.

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

The suite uses synthetic fixtures only; 54 tests pass in this packaged layout. It covers tax bands and allowances, losses, finance relief, pension/Gift Aid effects, payments on account, date filtering, separate-year settings, exact legacy-record preservation, corrupt/quota failures, complete backup validation and restore rollback. A real-device backup/export/restore check is still needed; the automated IndexedDB tests use a transactional stub.

## Files

`index.html`, `styles.css` and `app.js` provide the existing app shell and modules. `tax-engine.js` contains the pure tax calculations; `tax-ui.js` provides the Property tax screen; `backup.js` validates and restores complete backups; `enrichment.js` adds supported missing details without full replacement. `manifest.json`, the icons and `sw.js` support installation and offline assets. `tests/` contains public-safe synthetic verification fixtures.

# AMP — Personal Space

A polished, mobile-first personal web app with four connected modules:

1. **Property** — property values, rent, mortgage payments, optional mortgage/valuation projections, income and expenses, linked admin cases.
2. **Discipline** — month-first habit calendar with Week, Month, 6 Months, Year views; default Gym, Portfolio, Journal and <4h screen time, all editable; endless daily check-ins.
3. **Life Admin** — cases, follow-ups, waiting room, chronological updates, property links, document attachments, calendar-event export, resolved archive.
4. **Goals** — user-created goals and checkpoints, animated percentage progress, reorder/edit/delete steps, optional target dates and archive.

The dashboard shows summaries from each module. The app is entirely front-end: no third-party libraries, analytics, database server or external login.

## Install into your existing GitHub repository

Your existing repository is `parash-AMP/my-first-app`. GitHub integration access was read-only during creation, so these files have **not** yet been committed to your repository.

1. Back up your existing live Property app first using its **Export backup** function, and keep that JSON somewhere safe.
2. Download `AMP-Personal-Space.zip` and extract it in the iPhone Files app (tap the zip). The extracted folder contains all the app files, including `index.html`, `app.js`, `styles.css`, `manifest.json`, `sw.js`, and icons.
3. Open [your repository](https://github.com/parash-AMP/my-first-app) in Safari on your iPhone. On the `main` branch, choose **Add file → Upload files** (GitHub's mobile layout may require desktop website mode).
4. Upload **the files inside** the extracted `amp-app` folder to the **root** of the repository, not the folder itself. Approve replacing `index.html` if prompted, then commit the changes.
5. In the repository, check **Settings → Pages**. Use **Deploy from a branch**, select `main` and `/ (root)` if not already selected. Wait for GitHub to publish.
6. Visit the Pages address from Safari, then select **Share → Add to Home Screen → Add**. Open the AMP icon to launch it in standalone mode.

### Important: preserve your existing Property data

This app uses the **exact same browser storage key** (`property-manager-v1`) and property record structure as your previous GitHub Pages Property app. Existing data should be recognized **if AMP opens at the same GitHub Pages origin in the same iPhone browser profile**. No automatic migration is possible across different website origins, devices, or wiped browser storage.

The original property's features are reimplemented in the integrated view; it isn't embedded as the old page. For safety, export an existing backup **before replacing `index.html`**. The old property-only JSON backup cannot be imported with the new **AMP-wide** importer directly. If existing data is missing after deployment, restore the original `index.html` from GitHub history, import your original property backup there, then redeploy AMP from the same origin; or seek help converting the backup to AMP format. Do not delete your only backup.

### Privacy & data durability

- Your records are saved **locally in the browser** using localStorage; documents use IndexedDB. They are not sent to GitHub or a server.
- The repository may be public. **Never add your real data, documents, bank details or exported backups to it.**
- Browser storage is **not encrypted**; anyone with access to the unlocked browser profile may be able to read it. Use device access protection, and avoid highly sensitive documents unless you understand this limitation.
- iOS clearing website data, switching device/browser/origin, or site storage eviction can erase records. Export AMP backups after changes; backup files include sensitive records and should be secured.
- Calendar reminders are **not push notifications**. Life Admin can export an `.ics` calendar event to import into your calendar. Real calendar sync and notifications require extra setup or an integration.
- Any balance or valuation projection is an estimate. No lender feed or live house-price API is connected.
- AMP is an installable web app, not an App Store binary. It can use its offline cache after a successful first load; available offline behaviours can vary by iOS version.

## Files

`index.html` is the main shell, `styles.css` the responsive interface, `app.js` the app, `manifest.json` and icons enable Add to Home Screen, and `sw.js` caches the offline shell.

# Privacy

MOSS is **local-first**. Your data is stored in a SQLite database on your own computer. There is no MOSS account and no MOSS server — we never receive your data.

## What stays on your machine

Everything you enter or import: budgets and transactions, food logs, calendar events, news items, profile names, and all preferences. By default it lives under your OS application-support directory, and it is readable only by your user account. **Settings → Privacy & data** shows the exact folder, opens it in Finder/Explorer, and lets you move it to any folder you choose (an external drive, a synced folder — your call). MOSS never deletes the old copy until the new one is verified.

## What leaves your machine

MOSS makes outbound network requests **only** for the features below. Most exist only when you add the integration; the two built-in ones (dashboard sun & UV, update check) are marked:

| Feature | Connects to | Sends | Receives |
|---------|-------------|-------|----------|
| **News** | The RSS feed URLs you choose; publishers' image hosts; Google's favicon service | A normal HTTP request for the feed; the outlet's domain name (favicon lookups only — never what you read) | Headlines, summaries, links, article images, small outlet icons |
| **Calendar (Google)** | Google OAuth + Calendar API | Your OAuth authorization | Read-only calendar events |
| **Calendar (.ics URL)** | The URL you paste | An HTTP request | Calendar events |
| **Nutrition lookup** | USDA FoodData Central / Open Food Facts | The search term or barcode | Food + nutrient data |
| **Investments (optional)** | A public quotes endpoint | The ticker symbols you add | Price quotes |
| **Inbox (mail)** | Your mail provider (Gmail OAuth, or the IMAP/SMTP servers you configure) | Your OAuth authorization or app password; mail you deliberately compose and send | Your own mailbox contents |
| **Fonts (install time)** | Fontshare CDN | A download request during `npm install` | The Cabinet Grotesk font files (not your data; skipped when offline) |
| **Dashboard sun & UV (built-in)** | Open-Meteo | Your approximate coordinates (a generic default if you deny location) | UV index forecast |
| **App update check (built-in)** | GitHub Releases API | A version-check request (no personal data) | Latest release info |
| **Smart parsing model (one-time, consented)** | A pinned model-host URL | A download request (no personal data) | The local AI model file (~2.7GB, SHA-256-verified). Nothing you type is ever sent — parsing runs on-device |

If you add no feeds, accounts, or lookups, the only outbound requests are the dashboard's UV forecast and the update check — neither carries your records.

## Credentials

OAuth tokens and API keys are stored in your operating system's secure storage (Electron `safeStorage` — Keychain on macOS, DPAPI on Windows), never in the SQLite database or in plain text. MOSS does not log secrets.

MOSS ships with its own Google *app* credential so Google sign-in works out of the box. That credential identifies the MOSS app to Google — it is not a user secret, contains nothing about you, and cannot access anyone's data. Your personal Google tokens are created only when you sign in, and they live only in your OS keychain.

## No telemetry

MOSS ships with **no analytics and no telemetry**. If any optional telemetry is ever added, it will be opt-in with clear disclosure.

## Your control

- **See it:** Settings → Privacy & data shows where your data lives, per-profile sizes, and the local-AI model location. "Show in Finder" opens the folder.
- **Move it:** "Move data folder…" relocates everything to a folder you pick. MOSS copies, verifies the copy, then removes the old one — never the other way around.
- **Export / backup:** the SQLite file path is shown in Settings; copy it to back up.
- **Delete:** quit MOSS and delete the data folder shown in Settings (plus the application-support directory) to remove all data. Uninstalling the app alone does not delete your data.

## Not advice

MOSS helps you organize information. It is **not** financial, medical, tax, or legal advice. You own your data and your decisions.

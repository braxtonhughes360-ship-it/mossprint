# Privacy

MOSS is **local-first**. Your data is stored in a SQLite database on your own computer. There is no MOSS account and no MOSS server — we never receive your data.

## What stays on your machine

Everything you enter or import: budgets and transactions, food logs, calendar events, news items, profile names, and all preferences. It lives under your OS application-support directory (see the README) and is readable only by your user account.

## What leaves your machine (only when you enable it)

MOSS makes outbound network requests **only** for integrations you explicitly add:

| Feature | Connects to | Sends | Receives |
|---------|-------------|-------|----------|
| **News** | The RSS feed URLs you choose | A normal HTTP request for the feed | Headlines, summaries, links |
| **Calendar (Google)** | Google OAuth + Calendar API | Your OAuth authorization | Read-only calendar events |
| **Calendar (.ics URL)** | The URL you paste | An HTTP request | Calendar events |
| **Nutrition lookup** | USDA FoodData Central / Open Food Facts | The search term or barcode | Food + nutrient data |
| **Investments (optional)** | A public quotes endpoint | The ticker symbols you add | Price quotes |
| **Inbox (mail)** | Your mail provider (Gmail OAuth, or the IMAP/SMTP servers you configure) | Your OAuth authorization or app password; mail you deliberately compose and send | Your own mailbox contents |
| **Fonts (install time)** | Fontshare CDN | A download request during `npm install` | The Cabinet Grotesk font files (not your data; skipped when offline) |

If you add no feeds, accounts, or lookups, MOSS makes no outbound requests for your data.

## Credentials

OAuth tokens and API keys are stored in your operating system's secure storage (Electron `safeStorage` — Keychain on macOS, DPAPI on Windows), never in the SQLite database or in plain text. MOSS does not log secrets.

## No telemetry

MOSS ships with **no analytics and no telemetry**. If any optional telemetry is ever added, it will be opt-in with clear disclosure.

## Your control

- **Export / backup:** the SQLite file path is shown in Settings; copy it to back up.
- **Delete:** quit MOSS and delete the application-support directory to remove all data. Uninstalling the app alone does not delete your data.

## Not advice

MOSS helps you organize information. It is **not** financial, medical, tax, or legal advice. You own your data and your decisions.

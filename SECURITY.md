# Security

MOSS holds your money, meals, calendar, mail, and notes. You deserve a straight answer about what protects that data, what doesn't, and where the limits are. This page is that answer — plain language first, the technical table for auditors at the end.

## What actually protects your data

**Everything stays on your computer.** There is no MOSS server, no account, no sync. The only network traffic is what you explicitly set up: fetching your RSS feeds, syncing a Google Calendar you connected, looking up foods in USDA/Open Food Facts, checking GitHub for app updates, and sending mail you wrote. Your records never ride along.

**If you set a profile password:** your profile's database is encrypted on disk with SQLCipher (AES-256), and your password is the key. Someone who copies the file — or sits down at your unlocked computer and roots through your disk — gets unreadable bytes without it. Your recovery phrase is the only backup key: anyone who has it can open the profile, and if you lose both the password and the phrase, **nobody can recover that data, including us.** That's the honest cost of real encryption.

**If you don't set a password:** your data is protected by your operating system, not by MOSS — your OS user account keeps other users on the machine out, and full-disk encryption (FileVault on Mac, BitLocker or Device Encryption on Windows) protects the disk if the laptop is lost or stolen. If you skip a profile password, please at least turn disk encryption on; on modern Macs and most Windows laptops it's one switch.

**Mail and calendar credentials never touch the database.** OAuth tokens and app passwords go in your OS keychain (via Electron `safeStorage`), the same place your other apps keep theirs.

## What it does NOT protect against

No local app can save you from everything. MOSS's encryption does **not** defend against:

- **Malware on your machine.** Anything running as you can read what you can read, capture keystrokes, or wait for you to unlock the profile.
- **Someone you share your OS user account with.** If they log in as you and know (or watch you type) your profile password, that's your trust boundary, not a software one.
- **You, posting your recovery phrase somewhere.** Treat it like cash.
- **The services you connect.** Google still knows your calendar; your mail provider still has your mail. MOSS only promises not to add anyone new to that list.

## Where your data lives on disk

One folder per profile, inside the app's data directory:

| OS | Path |
|----|------|
| macOS | `~/Library/Application Support/MOSS/profiles/<profile-id>/moss.sqlite` |
| Windows | `%APPDATA%\MOSS\profiles\<profile-id>\moss.sqlite` |
| Linux | `~/.config/MOSS/profiles/<profile-id>/moss.sqlite` |

That SQLite file **is** your data — copy it anywhere for a backup (if the profile has a password, the copy stays encrypted). Settings → Privacy & data shows the exact path for your profile.

## How to fully delete everything

1. Delete the app (drag to Trash / uninstall).
2. Delete the data directory above (the whole `moss` folder).
3. Remove MOSS entries from your keychain if you connected mail or Google Calendar (search "moss" in Keychain Access / Credential Manager).

There is no step 4 — no server-side copy exists to ask us to delete.

## Reporting a vulnerability

Please report security issues **privately** — do not open a public GitHub issue.

- Use GitHub's **Report a vulnerability** (Security → Advisories) on this repository, or
- Email the maintainer (see repository profile).

Include reproduction steps and impact. **Never** include passwords, tokens, or personal records in a report. We aim to acknowledge reports promptly; this is a best-effort, single-maintainer beta with no formal SLA.

## Beta builds and signing

Beta artifacts are currently **unsigned** — macOS and Windows will warn you, and the README explains the right-click → Open / "More info → Run anyway" dance. Only download builds from this repository's Releases page, or build from source (`npm run package`) to get the exact same app with nobody in between. Signed installers ship with 1.0.

## Technical controls (for auditors)

MOSS is a sandboxed Electron app following the rules in [`SPEC.md`](SPEC.md) §3.

| Control | Status |
|---------|--------|
| `contextIsolation: true` | ✅ enforced (`src/main/index.ts`) |
| `nodeIntegration: false` | ✅ enforced |
| `sandbox: true` | ✅ enforced |
| `webSecurity: true` | ✅ enforced |
| Narrow preload bridge (no raw `fs`/`shell` in renderer) | ✅ explicit `window.moss` IPC surface only |
| IPC sender validation on every handler | ✅ `assertTrustedSender` (file/localhost/devtools origins only) |
| Content-Security-Policy (production) | ✅ `default-src 'self'`; no `unsafe-eval` in prod |
| `shell.openExternal` restricted to http/https | ✅ protocol-validated in main |
| Profile encryption | ✅ SQLCipher (AES-256) via `better-sqlite3-multiple-ciphers` when a profile password is set |
| OAuth tokens / API keys in OS keychain | ✅ Electron `safeStorage`, never SQLite/plain text |
| Parameterized SQL only | ✅ prepared statements everywhere |
| Secrets never logged | ✅ event/error codes only |
| Update checks | ✅ main process only; renderer never talks to GitHub; no auto-restart |
| Dependency audit | ⚠️ `npm audit` — 1 high advisory group against Electron ≤39.x; triaged (MOSS loads only local, bundled content with sandbox + context isolation, and uses none of the affected APIs). Electron major upgrade scheduled before the 1.0 public tag — see `docs/MOSS_PUBLIC_RELEASE_PLAN.md` |

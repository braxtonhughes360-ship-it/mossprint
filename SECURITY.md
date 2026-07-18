# Security

MOSS holds your money, meals, calendar, mail, and notes. You deserve a straight answer about what protects that data, what doesn't, and where the limits are. This page is that answer — plain language first, the technical table for auditors at the end.

## What actually protects your data

**Everything stays on your computer.** There is no MOSS server, no account, no sync. The only network traffic is for features you can see: fetching your RSS feeds, syncing a Google Calendar you connected, syncing and sending mail for accounts you added, looking up foods in USDA/Open Food Facts, fetching prices for investment tickers you added (Yahoo Finance), the dashboard's sun & UV readout (your coordinates only, to Open-Meteo), and checking GitHub for app updates. Your records never ride along.

**Smart parsing (Describe)** runs a small language model **on your own computer** — never in the cloud, never on a MOSS server. The text you type for capture, money, nutrition, and calendar parsing stays on this machine, envelope names included. There are two ways it runs, and MOSS picks automatically:

- **The built-in helper.** MOSS bundles a local inference engine (llama.cpp, MIT-licensed) and, the first time you turn smart parsing on, offers a **one-time ~2.7GB model download** with a clear consent card. That download is the *only* network request smart parsing ever makes: it comes from one pinned URL and is verified against a pinned SHA-256 checksum before it's ever used — a file that doesn't match is deleted, not run. After it lands, smart parsing works fully offline. The engine runs as a short-lived helper process bound to `127.0.0.1` on a random local port, and it's shut down when you quit MOSS.
- **Your own Ollama.** If you already run [Ollama](https://ollama.com) at `127.0.0.1:11434`, MOSS uses it instead — no duplicate download, no second copy in memory.

Either way, the model endpoint is loopback-only (`127.0.0.1`); prompts never leave the machine. Until the model is downloaded (or if you decline), MOSS falls back to fast built-in parsing — the app is never broken.

**MOSS's AI can draft email; only you can send one.** The Inbox's "Draft with MOSS" writes reply text into the composer as an editable local draft — the email it's replying to goes only to the same loopback model endpoint, and nothing is logged. There is no code path that lets model output reach your mail provider on its own: sending always requires you to press Send, and the send channel accepts no automation flag (enforced in the main process, covered by `tests/mail-send-invariant.test.ts`).

**If you set a profile password:** your profile's database is encrypted on disk with SQLCipher (AES-256), and your password is the key. Someone who copies the file — or sits down at your unlocked computer and roots through your disk — gets unreadable bytes without it. Your recovery phrase is the only backup key: anyone who has it can open the profile, and if you lose both the password and the phrase, **nobody can recover that data, including us.** That's the honest cost of real encryption.

**If you don't set a password:** your data is protected by your operating system, not by MOSS — your OS user account keeps other users on the machine out, and full-disk encryption (FileVault on Mac, BitLocker or Device Encryption on Windows) protects the disk if the laptop is lost or stolen. If you skip a profile password, please at least turn disk encryption on; on modern Macs and most Windows laptops it's one switch.

**Mail and calendar credentials never touch the database.** OAuth tokens and app passwords go in your OS keychain (via Electron `safeStorage`), the same place your other apps keep theirs.

**MOSS ships a Google app credential — and that's normal.** So that Google sign-in works without any setup, the app includes MOSS's own Google OAuth client id and secret (obfuscated inside the build). For a desktop app, Google itself treats this secret as non-confidential: it identifies the *app*, not you, and can never unlock anyone's data. Your sign-in is protected by PKCE and a localhost-only redirect, and the tokens Google issues for *your* account live only in your OS keychain. The worst a leaked app credential enables is someone impersonating the MOSS app or using up its API quota — never reading your calendar or mail.

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

MOSS is a sandboxed Electron app with context isolation, sandboxing, and a narrow preload bridge.

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
| Local smart parsing (Describe) | ✅ on-device only; loopback endpoint (`127.0.0.1`, bundled helper on a random port or user Ollama on `:11434`); renderer never talks to the model directly; per-surface toggles in Settings → Local AI |
| Bundled model download | ✅ one pinned URL, SHA-256-verified before use (mismatch → deleted); consented, resumable; the only network fetch smart parsing makes |
| Inference sidecar | ✅ spawned as a child process bound to `127.0.0.1` only, never a public interface; killed on quit (no orphan) |
| AI email drafting | ✅ draft-only by construction: model output lands in the composer as editable text; the send IPC accepts only the user-initiated payload shape, no auto flag (`src/main/mailSendInput.ts`, `tests/mail-send-invariant.test.ts`) |
| Dependency audit | ✅ `npm audit` — 0 vulnerabilities (Electron 42.5.2, June 2026 security patch line) |

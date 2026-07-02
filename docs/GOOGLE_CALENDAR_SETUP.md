# Google Calendar + MOSS

## The $300 credits thing (don't worry)

Google Cloud **trial credits are for servers** (Compute, Cloud Run, etc.). **Calendar API + OAuth are free** for personal use — you do not spend trial credits to sign in or sync events.

You need a Google Cloud **project** (free), not a paid subscription.

---

## Path A — Easiest for mom (no Google Cloud at all)

Use Google's **secret calendar link** — read-only, no developer setup.

1. Open [Google Calendar](https://calendar.google.com) in a browser
2. Click **Settings** (gear) → **Settings**
3. Left sidebar: **Settings for my calendars** → pick your calendar (e.g. "Brax")
4. Scroll to **Integrate calendar**
5. Copy **Secret address in iCal format** (starts with `https://calendar.google.com/calendar/ical/...`)
6. In MOSS: **Settings → Calendar → Paste Google Calendar link** → Subscribe

Events sync into MOSS. Repeat for each calendar you care about.

---

## Path B — Sign in popup (one-time household setup)

After **you** set up OAuth once, everyone else only clicks **Sign in with Google** — a popup opens inside MOSS.

### One-time admin setup (~10 minutes)

1. [Google Cloud Console](https://console.cloud.google.com/) → create project (e.g. "MOSS Household")
2. **APIs & Services → Library** → enable **Google Calendar API**
3. **OAuth consent screen** → External → fill app name "MOSS", your email
   - Add scope: `.../auth/calendar.readonly`
   - Add **Test users**: your email + mom's email
   - For tokens lasting longer than 7 days: set Publishing status to **In production** (personal use; Google shows "unverified app" — click Advanced → Go to MOSS)
4. **Credentials → Create → OAuth client ID → Desktop app**
5. Download JSON → save as `config/google-oauth.json` (see `config/google-oauth.example.json`)

   **Or** create `.env` in the MOSS folder:

   ```
   MOSS_GOOGLE_CLIENT_ID=....apps.googleusercontent.com
   MOSS_GOOGLE_CLIENT_SECRET=GOCSPX-...
   ```

6. Restart MOSS (`npm run dev`)

### Daily use (mom)

Settings → Calendar → **Sign in with Google** → popup → pick account → Allow → done.

---

## Which path?

| | Secret ICS link | Sign in with Google |
|--|-----------------|---------------------|
| Setup | None | Admin once |
| Mom steps | Paste link | One button |
| Auto sync | Re-subscribe / refresh URL | Sync now button (V2: background) |
| Best for | Quick start today | Long-term household |

**Recommendation:** start with **Path A** today; add Path B when you want one-click reconnect for the family.

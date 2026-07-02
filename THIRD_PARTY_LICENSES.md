# Third-Party Licenses

MOSS bundles and depends on open-source software. Full license texts are available in each package under `node_modules/<package>/`. This file summarizes the notable runtime dependencies and bundled assets; it is not exhaustive of the transitive tree (run `npx license-checker` for a complete report).

## Runtime dependencies

| Package | Purpose | License |
|---------|---------|---------|
| `electron` | Desktop runtime | MIT |
| `react`, `react-dom` | UI | MIT |
| `react-router-dom` | Routing | MIT |
| `better-sqlite3-multiple-ciphers` | Local encrypted SQLite storage (SQLCipher) | MIT |
| `googleapis` | Google Calendar + Gmail (OAuth) | Apache-2.0 |
| `imapflow` | IMAP mail sync | MIT |
| `mailparser` | Mail parsing | MIT |
| `nodemailer` | SMTP mail send | MIT-0 |
| `node-ical` | `.ics` calendar parsing | MIT |
| `@tanstack/react-query` | Data fetching/cache | MIT |
| `@radix-ui/*` | Accessible UI primitives | MIT |
| `motion` | Animation | MIT |
| `three`, `@react-three/fiber` | Ambient visuals | MIT |
| `suncalc` | Sunrise/sunset for the hero instrument | BSD-2-Clause |
| `@fontsource-variable/jetbrains-mono` | Numeric/mono typeface | SIL OFL 1.1 |

## Fonts

- **JetBrains Mono** — SIL Open Font License 1.1; bundled via `@fontsource-variable/jetbrains-mono`.
- **Cabinet Grotesk** — Indian Type Foundry, served via Fontshare. Fontshare's EULA does **not** permit redistributing the font files, so they are **not committed to this repository**. They are downloaded at install time by `scripts/fetch-cabinet-fonts.mjs` (postinstall). If the download fails (offline install), MOSS falls back to system fonts.

## Merchant icons

Brand SVG paths under `src/renderer/public/merchant-icons/` are from [Simple Icons](https://simpleicons.org/) (MIT), plus original MOSS-made initial-badge fallbacks — see `src/renderer/public/merchant-icons/LICENSE.md`. All logos and brand names are trademarks or registered trademarks of their respective owners, used solely for identification of the user's own transactions; no affiliation or endorsement is implied.

## Data sources (attribution)

- **USDA FoodData Central** — public domain (U.S. government data).
- **Open Food Facts** — database under Open Database License (ODbL); product data under Database Contents License.

USDA / Open Food Facts attribution is shown in the Nutrition module UI.

---

To regenerate a complete dependency license report:

```bash
npx license-checker --production --summary
```

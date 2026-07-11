# QA fixtures

## Reseed the QA profile

After changing `src/main/qaProfileSeed.ts`, refresh your local **QA Tester** profile:

```bash
npm run seed:qa
```

The script always replaces the existing QA Tester profile. On success it prints a `qaMoneySanity`
JSON line — expect roughly **`unassignedCents` ~$98**, **`safeToSpendCents` ~$380**, and
`rolloverEnvelopes` only showing Insurance (~$420 mid-quarter) plus a small Utilities cushion.
No bill envelope should show a giant rolled-over pile.

## `chase-import-test.csv`

Chase-style export for testing Money import (V2.5a presets + dedupe).

Uses the real Chase column layout (`Transaction Date`, `Description`, …) — not the old
`Details`/`DEBIT`/`CREDIT` test format that incorrectly mapped payees.

**How to use**

1. Open MOSS → Money → Import / Export
2. Drop `chase-import-test.csv` or choose it from the file picker
3. Confirm preset **Chase** is selected
4. Set **Add to account** → **Everyday Checking**
5. Review preview:
   - Payees should show merchant names (Netflix, Starbucks, …) — not DEBIT/CREDIT
   - **2 duplicates** — Netflix (06/14) and Trader Joe's (06/04) already exist in the QA profile ledger
   - **8 new rows** ready to import
6. Confirm import — nothing saves until you click Import

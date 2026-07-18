import {
  runDemoProfilesSeed,
  runHeadlessCalendarParse,
  runHeadlessCaptureRouting,
  runHeadlessDescribeParse,
  runHeadlessDescribeSmoke,
  runHeadlessEstimateLabels,
  runHeadlessHealthCheck,
  runHeadlessUsdaImport
} from './headlessChecks'
import {
  runHeadlessCreditSmoke,
  runHeadlessFlowSmoke,
  runHeadlessImportSmoke,
  runHeadlessLedgerSmoke,
  runHeadlessReportsSmoke
} from './headlessMoneySmokes'
import { runHeadlessNewsOffline, runHeadlessNewsWidgetShot } from './headlessNewsSmokes'
import { runHeadlessReadmeShots } from './headlessShots'
import { runHeadlessPerfSweep } from './headlessPerfSweep'

/**
 * Env-flag dispatch for headless QA/verify runs (scripts/verify-*.mjs et al.).
 * Returns true when a headless run took over — normal boot must be skipped.
 */
export function dispatchHeadlessRun(): boolean {
  if (process.env.MOSS_DEMO_PROFILES === '1') {
    void runDemoProfilesSeed()
    return true
  }

  if (process.env.MOSS_HEADLESS_HEALTHCHECK === '1') {
    void runHeadlessHealthCheck()
    return true
  }

  if (process.env.MOSS_HEADLESS_USDA_IMPORT === '1') {
    void runHeadlessUsdaImport()
    return true
  }

  if (process.env.MOSS_HEADLESS_CALENDAR_PARSE === '1') {
    void runHeadlessCalendarParse()
    return true
  }

  if (process.env.MOSS_HEADLESS_NEWS_OFFLINE === '1') {
    void runHeadlessNewsOffline()
    return true
  }

  if (process.env.MOSS_HEADLESS_LEDGER_SMOKE === '1') {
    void runHeadlessLedgerSmoke()
    return true
  }

  if (process.env.MOSS_HEADLESS_FLOW_SMOKE === '1') {
    void runHeadlessFlowSmoke()
    return true
  }

  if (process.env.MOSS_HEADLESS_REPORTS_SMOKE === '1') {
    void runHeadlessReportsSmoke()
    return true
  }

  if (process.env.MOSS_HEADLESS_IMPORT_SMOKE === '1') {
    void runHeadlessImportSmoke()
    return true
  }

  if (process.env.MOSS_HEADLESS_CREDIT_SMOKE === '1') {
    void runHeadlessCreditSmoke()
    return true
  }

  if (process.env.MOSS_HEADLESS_SEED === '1') {
    void import('./headlessSeed').then(({ runHeadlessSeed }) => runHeadlessSeed())
    return true
  }

  if (process.env.MOSS_QA_SEED === '1') {
    void import('./qaProfileSeed').then(({ runQaProfileSeed }) =>
      runQaProfileSeed({
        quitApp: true,
        force: process.env.MOSS_QA_SEED_FORCE === '1'
      })
    )
    return true
  }

  if (process.env.MOSS_HEADLESS_NEWS_WIDGET_SHOT === '1') {
    void runHeadlessNewsWidgetShot()
    return true
  }

  if (process.env.MOSS_HEADLESS_README_SHOTS === '1') {
    void runHeadlessReadmeShots()
    return true
  }

  if (process.env.MOSS_HEADLESS_QA2_SMOKE === '1') {
    void import('./qa2Smoke').then(({ runHeadlessQa2Smoke }) => runHeadlessQa2Smoke())
    return true
  }

  if (process.env.MOSS_HEADLESS_PERF_SWEEP === '1') {
    void runHeadlessPerfSweep()
    return true
  }

  if (process.env.MOSS_HEADLESS_DESCRIBE_PARSE === '1') {
    void runHeadlessDescribeParse()
    return true
  }

  if (process.env.MOSS_HEADLESS_CAPTURE_ROUTING === '1') {
    void runHeadlessCaptureRouting()
    return true
  }

  if (process.env.MOSS_HEADLESS_DESCRIBE === '1') {
    void runHeadlessDescribeSmoke()
    return true
  }

  if (process.env.MOSS_HEADLESS_ESTIMATE_LABELS === '1') {
    void runHeadlessEstimateLabels()
    return true
  }

  return false
}

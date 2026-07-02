/**
 * Seeds a rich QA profile into an ISOLATED userData dir.
 * Gated behind MOSS_HEADLESS_SEED=1 + MOSS_HEADLESS_USER_DATA=<dir>.
 */
import { runQaProfileSeed } from './qaProfileSeed'

export async function runHeadlessSeed(): Promise<void> {
  await runQaProfileSeed({ quitApp: true, force: false })
}

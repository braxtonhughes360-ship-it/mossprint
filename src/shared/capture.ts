import type { CommitDescribePlateInput } from './nutrition'

/** Which module a quick-capture line was routed to. */
export type CaptureKind = 'money' | 'nutrition' | 'calendar'

/** The entry was written immediately (money expense / calendar event). */
export interface CaptureLoggedResult {
  status: 'logged'
  kind: CaptureKind
  message: string
}

/** Nutrition describe needs a one-line confirm before committing the plate. */
export interface CaptureConfirmResult {
  status: 'confirm'
  kind: 'nutrition'
  message: string
  plate: CommitDescribePlateInput
}

/** Input didn't match any shape — message explains the three shapes. */
export interface CaptureUnroutedResult {
  status: 'unrouted'
  message: string
}

export type CaptureSubmitResult =
  | CaptureLoggedResult
  | CaptureConfirmResult
  | CaptureUnroutedResult

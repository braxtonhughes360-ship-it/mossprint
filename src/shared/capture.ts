import type { CalendarEventKind } from './calendar'
import type { CommitDescribePlateInput } from './nutrition'

/** Which module a quick-capture line was routed to. */
export type CaptureKind = 'money' | 'nutrition' | 'calendar' | 'note'

/** The entry was written immediately (deterministic money / calendar). */
export interface CaptureLoggedResult {
  status: 'logged'
  kind: CaptureKind
  message: string
}

/** LLM-routed money entry awaiting explicit confirm. */
export interface CaptureMoneyDraft {
  amountCents: number
  /** "income" for money received; everything else is an expense. */
  direction: 'expense' | 'income'
  /** YYYY-MM-DD the money moved; null means today. */
  dateKey: string | null
  merchant: string
  categoryId: string | null
}

/** LLM-routed calendar event awaiting explicit confirm. */
export interface CaptureCalendarDraft {
  title: string
  startAt: string
  endAt: string
  kind: CalendarEventKind
}

/** LLM-routed note or task awaiting explicit confirm. */
export interface CaptureNoteDraft {
  text: string
  isTask: boolean
}

/** Nutrition describe needs a one-line confirm before committing the plate. */
export interface CaptureNutritionConfirmResult {
  status: 'confirm'
  kind: 'nutrition'
  message: string
  plate: CommitDescribePlateInput
}

/** LLM-routed money expense — confirm before writing. */
export interface CaptureMoneyConfirmResult {
  status: 'confirm'
  kind: 'money'
  message: string
  money: CaptureMoneyDraft
}

/** LLM-routed calendar event — confirm before writing. */
export interface CaptureCalendarConfirmResult {
  status: 'confirm'
  kind: 'calendar'
  message: string
  calendar: CaptureCalendarDraft
}

/** LLM-routed note or task — confirm before writing. */
export interface CaptureNoteConfirmResult {
  status: 'confirm'
  kind: 'note'
  message: string
  note: CaptureNoteDraft
}

export type CaptureConfirmResult =
  | CaptureNutritionConfirmResult
  | CaptureMoneyConfirmResult
  | CaptureCalendarConfirmResult
  | CaptureNoteConfirmResult

/** Input didn't match any shape — message explains the three shapes. */
export interface CaptureUnroutedResult {
  status: 'unrouted'
  message: string
}

export type CaptureSubmitResult =
  | CaptureLoggedResult
  | CaptureConfirmResult
  | CaptureUnroutedResult

/** Payload for capture:confirm — commits an LLM-routed money/calendar/note draft. */
export type CaptureCommitInput =
  | { kind: 'money'; money: CaptureMoneyDraft }
  | { kind: 'calendar'; calendar: CaptureCalendarDraft }
  | { kind: 'note'; note: CaptureNoteDraft }

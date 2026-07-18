/** Name heuristic for first-run defaults only — user can override per envelope. */
export const BILL_ENVELOPE_NAME_PATTERN =
  /\b(rent|housing|lease|mortgage|utilities|electric|gas|water|internet|phone|insurance|bills?|grocery|groceries)\b/i

/** Guess whether a new envelope should count toward safe to spend (default path). */
export function inferCountsTowardSafeToSpendFromName(name: string): boolean {
  return !BILL_ENVELOPE_NAME_PATTERN.test(name.trim())
}

export function formatEverydayEnvelopeNames(names: readonly string[]): string {
  if (names.length === 0) return 'your everyday envelopes'
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  if (names.length <= 4) {
    return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
  }
  return `${names.slice(0, 3).join(', ')}, and ${names.length - 3} more everyday envelopes`
}

/** One-time nudge — assigning ≠ spending (V2.75b). */
export const ENVELOPE_ASSIGN_VS_SPEND_HINT =
  'Assigning money just gives it a job — it stays in your account until you actually spend it.'

export const ENVELOPE_ASSIGN_HINT_DISMISSED_KEY = 'moss.money.envelopeAssignHintDismissed'

export interface EnvelopeRestMetaParts {
  /** "Spent $X of $Y" — Y is carry-in + assigned for the period. */
  spentLine: string
  /** Positive carry-in from a prior period (rollover on). */
  carryInClause: string | null
  /** Only when underfunded: "Goal $Z · $W to go". */
  goalClause: string | null
  /** Prior-period overspend still on the envelope. */
  overspendClause: string | null
}

/** Collapsed envelope row copy — display only, no math. */
export function envelopeRestMetaParts(input: {
  spentCents: number
  budgetedCents: number
  targetCents: number | null
  assignedCents: number
  carryInCents: number
  rolloverEnabled: boolean
  formatCents: (cents: number) => string
}): EnvelopeRestMetaParts {
  const { spentCents, budgetedCents, targetCents, assignedCents, carryInCents, rolloverEnabled, formatCents } =
    input
  const spentLine = `Spent ${formatCents(spentCents)} of ${formatCents(budgetedCents)}`
  const underfunded = targetCents != null && targetCents > 0 && assignedCents < targetCents
  const goalClause =
    underfunded && targetCents != null
      ? `Goal ${formatCents(targetCents)} · ${formatCents(targetCents - assignedCents)} to go`
      : null
  const overspendClause =
    rolloverEnabled && carryInCents < 0
      ? `${formatCents(Math.abs(carryInCents))} carried overspend`
      : null
  const carryInClause =
    rolloverEnabled && carryInCents > 0 ? `${formatCents(carryInCents)} rolled over` : null
  return { spentLine, carryInClause, goalClause, overspendClause }
}

/** Expanded-editor copy for the rollover toggle — plain where the pile lives. */
export function envelopeRolloverEditorHint(input: {
  rolloverEnabled: boolean
  priorBalanceCents: number
  releasedCents: number
  /** Envelope balance after spend (cumulative when rollover on). */
  remainingCents: number
  formatCents: (cents: number) => string
}): string {
  const { rolloverEnabled, priorBalanceCents, releasedCents, remainingCents, formatCents } = input
  if (rolloverEnabled) {
    if (priorBalanceCents > 0) {
      return `${formatCents(priorBalanceCents)} rolled over counts here. Turn this off to move only that pile to “to assign” — your assignment this month stays. Spending pulls from this pile first.`
    }
    if (priorBalanceCents < 0) {
      return `${formatCents(Math.abs(priorBalanceCents))} carried overspend is tracked here. Good for sinking funds like insurance or car repairs.`
    }
    return 'Leftover builds up here — good for sinking funds like car repairs or gifts.'
  }
  if (releasedCents > 0 && remainingCents <= 0) {
    return `${formatCents(releasedCents)} from this envelope is in “to assign”. Turn rollover on to start saving up again — assign it back here if you want it.`
  }
  if (releasedCents < 0) {
    return `${formatCents(Math.abs(releasedCents))} carried overspend was released while rollover was off.`
  }
  return 'Off: unspent money from this month goes back to “to assign” next month. Turn on to save up over time.'
}

/** Confirm copy when turning rollover off with carry-in (pile or carried overspend). */
export function envelopeRolloverOffConfirmBody(
  envelopeName: string,
  carryInCents: number,
  formatCents: (cents: number) => string
): string {
  if (carryInCents < 0) {
    return `${formatCents(Math.abs(carryInCents))} carried overspend in “${envelopeName}” will move to “to assign”. Your assignment this month stays. Turning rollover back on later starts fresh. Your bank balance does not change.`
  }
  return `${formatCents(carryInCents)} rolled over in “${envelopeName}” will move to “to assign”. Your assignment this month stays — only the saved-up pile moves. Turning rollover back on later starts fresh; assign from “to assign” if you want that pile here again. Your bank balance does not change.`
}

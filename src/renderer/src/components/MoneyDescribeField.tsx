import { useEffect, useRef, useState } from 'react'
import type { CaptureSubmitResult } from '@shared/capture'
import { currentDateKey } from '@shared/calendar'
import { dayKeyToIso, formatMoneyCents, parseMoneyInput } from '@shared/money'
import { extractMoneyDate, parseMoneyDescribeLine } from '@shared/moneyDescribeParse'
import { MossSelect, type MossSelectOption } from './MossSelect'

type MoneyDirection = 'expense' | 'income'

const DONE_MS = 2400

const DESCRIBE_HELP =
  'Couldn’t read that as money — try “coffee 4.50 yesterday” or “got paid 2400”, or use Manual entry.'

/** Warm the local model once per app session, on first focus (plan §2 rule 5). */
let warmedThisSession = false

function warmOnFirstFocus(): void {
  if (warmedThisSession) return
  warmedThisSession = true
  void window.moss.localai.warm().catch(() => undefined)
}

function amountInputValue(amountCents: number): string {
  return amountCents % 100 === 0 ? String(amountCents / 100) : (amountCents / 100).toFixed(2)
}

/** Honest redirects when the shared brain routes the line somewhere else. */
function noticeForNonMoney(result: CaptureSubmitResult | null): string {
  if (result && result.status === 'confirm') {
    if (result.kind === 'nutrition') {
      return 'That reads like a meal — log food from quick capture or the Nutrition page. For a purchase, end with the amount, e.g. “coffee 4.50”.'
    }
    if (result.kind === 'calendar') {
      return 'That reads like an event — add it on the Calendar page or from quick capture.'
    }
    if (result.kind === 'note') {
      return 'That reads like a note — quick capture files those. For money, end with the amount.'
    }
  }
  return DESCRIBE_HELP
}

interface MoneyDescribeFieldProps {
  /** Envelope options from the ledger panel — '' means "No envelope". */
  categoryOptions: MossSelectOption[]
  busy: boolean
  onMutate: (task: () => Promise<void>) => Promise<void>
}

/**
 * Default entry surface at the top of the register (LocalAI plan §2.5/LA2):
 * plain English → previewed draft → explicit Post via createTransaction.
 * Parse-only until the user confirms — nothing here writes on its own.
 * Transfer/Adjust stay manual-only behind the Manual entry disclosure.
 */
export function MoneyDescribeField({
  categoryOptions,
  busy,
  onMutate
}: MoneyDescribeFieldProps): React.JSX.Element {
  const [text, setText] = useState('')
  const [thinking, setThinking] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [doneMessage, setDoneMessage] = useState<string | null>(null)

  const [direction, setDirection] = useState<MoneyDirection>('expense')
  const [amount, setAmount] = useState('')
  const [payee, setPayee] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [entryDateKey, setEntryDateKey] = useState(currentDateKey())

  const doneTimerRef = useRef<number | null>(null)
  useEffect(() => {
    return () => {
      if (doneTimerRef.current !== null) window.clearTimeout(doneTimerRef.current)
    }
  }, [])

  function openPreview(draft: {
    direction: MoneyDirection
    amountCents: number
    merchant: string
    categoryId: string
    dateKey: string
  }): void {
    setDirection(draft.direction)
    setAmount(amountInputValue(draft.amountCents))
    setPayee(draft.merchant)
    setCategoryId(draft.categoryId)
    setEntryDateKey(draft.dateKey)
    setPreviewOpen(true)
    setThinking(false)
  }

  async function runDescribe(): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed || thinking) return
    setNotice(null)
    setDoneMessage(null)

    // The module extractor resolves date phrases deterministically (register
    // bias: backwards) and works offline; the LLM's money_date fills the gap
    // for phrasings it misses. Module read wins when both exist.
    const { remainder, dateKey: phraseDateKey } = extractMoneyDate(trimmed, currentDateKey())
    if (!remainder) {
      setNotice(DESCRIBE_HELP)
      return
    }

    setThinking(true)
    let result: CaptureSubmitResult | null = null
    try {
      result = await window.moss.localai.describePreview(remainder, 'money')
    } catch {
      result = null
    }

    if (result && result.status === 'confirm' && result.kind === 'money') {
      openPreview({
        direction: result.money.direction === 'income' ? 'income' : 'expense',
        amountCents: result.money.amountCents,
        merchant: result.money.merchant,
        categoryId: result.money.categoryId ?? '',
        dateKey: phraseDateKey ?? result.money.dateKey ?? currentDateKey()
      })
      return
    }

    // Module context wins on shape: in the register, a line ending in an
    // amount is a money entry even when capture's brain reads it as food
    // ("coffee 4.50"). Also the offline path — works with no Ollama at all.
    const fallback = parseMoneyDescribeLine(remainder)
    if (fallback) {
      openPreview({ ...fallback, categoryId: '', dateKey: phraseDateKey ?? currentDateKey() })
      return
    }

    setThinking(false)
    setNotice(noticeForNonMoney(result))
  }

  function closePreview(): void {
    setPreviewOpen(false)
    setNotice(null)
  }

  function postEntry(): void {
    const cents = parseMoneyInput(amount)
    if (!cents || cents <= 0) return
    const payeeName = payee.trim()
    const occurredAt = dayKeyToIso(entryDateKey)
    const postedDirection = direction

    void onMutate(async () => {
      if (postedDirection === 'income') {
        // A2: income funds the budget — a paycheck row, not a ledger line
        // (matches schedule posting; "got paid 2400" must move "to assign").
        await window.moss.money.createPaycheck({
          label: payeeName || 'Income',
          amountCents: Math.abs(cents),
          receivedAt: occurredAt
        })
      } else {
        await window.moss.money.createTransaction({
          amountCents: -Math.abs(cents),
          type: 'expense',
          status: 'cleared',
          categoryId: categoryId || null,
          payeeName: payeeName || undefined,
          memo: payeeName,
          occurredAt
        })
      }
      setText('')
      setPreviewOpen(false)
      setDoneMessage(
        postedDirection === 'income'
          ? `Logged ${formatMoneyCents(Math.abs(cents))} in${payeeName ? ` — ${payeeName}` : ''} · added to budget`
          : `Logged ${formatMoneyCents(Math.abs(cents))} out${payeeName ? ` — ${payeeName}` : ''}`
      )
      if (doneTimerRef.current !== null) window.clearTimeout(doneTimerRef.current)
      doneTimerRef.current = window.setTimeout(() => setDoneMessage(null), DONE_MS)
    })
  }

  return (
    <section className="money-describe" aria-label="Describe an entry">
      {!previewOpen ? (
        <form
          className="money-describe-form"
          onSubmit={(event) => {
            event.preventDefault()
            void runDescribe()
          }}
        >
          <input
            className="money-input money-input--register money-describe-input"
            type="text"
            value={text}
            onChange={(event) => {
              setText(event.target.value)
              if (notice) setNotice(null)
            }}
            onFocus={warmOnFirstFocus}
            placeholder="coffee 4.50 yesterday · got paid 2400 · $12 chipotle"
            aria-label="Describe a purchase or income in plain English"
            disabled={busy || thinking}
            spellCheck={false}
            autoComplete="off"
          />
          <button
            type="submit"
            className="money-button money-button--compact"
            disabled={busy || thinking || !text.trim()}
          >
            {thinking ? 'Thinking…' : 'Preview'}
          </button>
        </form>
      ) : (
        <div className="money-describe-preview" role="group" aria-label="Confirm entry">
          <div className="money-kind-toggle money-kind-toggle--register">
            <button
              type="button"
              className={['money-kind', direction === 'expense' ? 'money-kind--active' : ''].join(' ')}
              onClick={() => setDirection('expense')}
            >
              Out
            </button>
            <button
              type="button"
              className={['money-kind', direction === 'income' ? 'money-kind--active' : ''].join(' ')}
              onClick={() => setDirection('income')}
            >
              In
            </button>
          </div>
          <input
            className="money-input money-input--register money-mono money-input--amount"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0.00"
            inputMode="decimal"
            aria-label="Amount"
          />
          <input
            className="money-input money-input--register"
            value={payee}
            onChange={(event) => setPayee(event.target.value)}
            placeholder="Payee"
            aria-label="Payee"
          />
          {direction === 'expense' ? (
            <MossSelect
              className="money-select--register"
              value={categoryId}
              options={categoryOptions}
              onChange={setCategoryId}
              placeholder="Envelope"
              ariaLabel="Envelope"
            />
          ) : (
            // Income has no envelope — it lands in the budget as a paycheck.
            <span className="nutrition-mono text-xs text-ink-muted self-center">
              Adds to budget
            </span>
          )}
          <input
            type="date"
            className="money-input money-input--register money-mono"
            value={entryDateKey}
            onChange={(event) => setEntryDateKey(event.target.value || currentDateKey())}
            aria-label="Date"
          />
          <button
            type="button"
            className="money-button money-button--compact"
            disabled={busy || !parseMoneyInput(amount)}
            onClick={postEntry}
          >
            Post
          </button>
          <button
            type="button"
            className="money-button money-button--ghost money-button--compact"
            onClick={closePreview}
          >
            Cancel
          </button>
        </div>
      )}

      {doneMessage && (
        <p className="money-describe-status" role="status">
          {doneMessage}
        </p>
      )}
      {notice && (
        <p className="money-describe-status money-describe-status--notice" role="status">
          {notice}
        </p>
      )}
    </section>
  )
}

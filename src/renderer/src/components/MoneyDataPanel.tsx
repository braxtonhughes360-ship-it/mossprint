import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CashAccountBalance } from '@shared/money'
import type {
  CsvParseResult,
  ImportFieldTarget,
  ImportOptions,
  ImportPresetId,
  ImportPreview,
  ImportRequest
} from '@shared/moneyImportExport'
import {
  DEFAULT_IMPORT_OPTIONS,
  IMPORT_FIELD_LABELS,
  IMPORT_FIELD_TARGETS,
  IMPORT_PRESET_OPTIONS,
  applyImportPreset,
  buildCsvParseResult,
  formatImportSummary
} from '@shared/moneyImportExport'
import { MossSelect } from './MossSelect'
import { MossButton } from './MossButton'
import { MossCheckbox } from './MossCheckbox'

interface MoneyDataPanelProps {
  accounts: CashAccountBalance[]
  busy: boolean
  onMutate: (task: () => Promise<void>) => Promise<void>
}

const FIELD_OPTIONS = IMPORT_FIELD_TARGETS.map((target) => ({
  value: target,
  label: IMPORT_FIELD_LABELS[target]
}))

const PRESET_OPTIONS = IMPORT_PRESET_OPTIONS.map((preset) => ({
  value: preset.id,
  label: preset.label
}))

const DATE_FORMAT_OPTIONS = [
  { value: 'auto', label: 'Detect automatically' },
  { value: 'mdy', label: 'Month / Day / Year' },
  { value: 'dmy', label: 'Day / Month / Year' },
  { value: 'ymd', label: 'Year - Month - Day' }
]

const AMOUNT_SIGN_OPTIONS = [
  { value: 'expense_negative', label: 'Spending shows as negative (−)' },
  { value: 'expense_positive', label: 'Spending shows as positive (+)' }
]

const PREVIEW_LIMIT = 12
const CSV_EXT = /\.(csv|tsv|txt)$/i

export function MoneyDataPanel({ accounts, busy, onMutate }: MoneyDataPanelProps): React.JSX.Element {
  const [parse, setParse] = useState<CsvParseResult | null>(null)
  const [presetId, setPresetId] = useState<ImportPresetId>('auto')
  const [mapping, setMapping] = useState<ImportFieldTarget[]>([])
  const [options, setOptions] = useState<ImportOptions>({ ...DEFAULT_IMPORT_OPTIONS })
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  const activeAccounts = useMemo(() => accounts.filter((a) => !a.archived), [accounts])
  const accountOptions = useMemo(
    () => [{ value: '', label: 'No account' }, ...activeAccounts.map((a) => ({ value: a.id, label: a.name }))],
    [activeAccounts]
  )

  const request: ImportRequest | null = useMemo(() => {
    if (!parse) return null
    return { headers: parse.headers, rows: parse.rows, mapping, options }
  }, [parse, mapping, options])

  const hasAmountColumn = mapping.includes('amount')
  const hasOutInColumns = mapping.includes('outflow') || mapping.includes('inflow')

  const refreshPreview = useCallback(async () => {
    if (!request) return
    try {
      const next = await window.moss.money.importPreview(request)
      setPreview(next)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that file')
    }
  }, [request])

  useEffect(() => {
    void refreshPreview()
  }, [refreshPreview])

  function loadParseResult(result: CsvParseResult): void {
    if (result.headers.length === 0) {
      setError("That file didn't have any columns we could read.")
      return
    }
    const detected = result.suggestedPreset
    const applied = applyImportPreset(detected, result.headers)
    setParse(result)
    setPresetId(detected)
    setMapping(applied.mapping)
    setOptions(applied.options)
    setPreview(null)
    setError(null)
  }

  async function handlePick(): Promise<void> {
    setNotice(null)
    setError(null)
    setWorking(true)
    try {
      const result = await window.moss.money.importPickCsv()
      if (result.canceled) return
      loadParseResult(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open that file')
    } finally {
      setWorking(false)
    }
  }

  async function handleDrop(event: React.DragEvent<HTMLElement>): Promise<void> {
    event.preventDefault()
    setDragOver(false)
    setNotice(null)
    setError(null)

    const file = event.dataTransfer.files[0]
    if (!file) return
    if (!CSV_EXT.test(file.name)) {
      setError('Drop a CSV file from your bank or spreadsheet.')
      return
    }

    setWorking(true)
    try {
      const text = await file.text()
      loadParseResult(buildCsvParseResult(file.name, text))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that file')
    } finally {
      setWorking(false)
    }
  }

  function handleDragOver(event: React.DragEvent<HTMLElement>): void {
    event.preventDefault()
    setDragOver(true)
  }

  function handleDragLeave(event: React.DragEvent<HTMLElement>): void {
    if (event.currentTarget.contains(event.relatedTarget as Node)) return
    setDragOver(false)
  }

  function handlePresetChange(nextId: ImportPresetId): void {
    if (!parse) return
    setPresetId(nextId)
    const applied = applyImportPreset(nextId, parse.headers)
    setMapping(applied.mapping)
    setOptions((prev) => ({ ...prev, ...applied.options }))
  }

  function setColumn(index: number, target: ImportFieldTarget): void {
    setMapping((prev) => prev.map((value, i) => (i === index ? target : value)))
  }

  function cancelImport(): void {
    setParse(null)
    setPresetId('auto')
    setMapping([])
    setPreview(null)
    setError(null)
    setDragOver(false)
  }

  function handleImport(): void {
    if (!request) return
    void onMutate(async () => {
      const result = await window.moss.money.importCommit(request)
      setNotice(result.message)
      cancelImport()
    })
  }

  async function runExport(kind: 'transactions' | 'backup'): Promise<void> {
    setNotice(null)
    setError(null)
    setWorking(true)
    try {
      const result =
        kind === 'transactions'
          ? await window.moss.money.exportTransactionsCsv()
          : await window.moss.money.exportBackup()
      if (result.canceled) return
      setNotice(result.message ?? 'Saved.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that file')
    } finally {
      setWorking(false)
    }
  }

  function handleRestore(): void {
    setNotice(null)
    setError(null)
    void onMutate(async () => {
      const result = await window.moss.money.restoreBackup()
      if (result.canceled) return
      setNotice(result.message ?? 'Restore finished.')
    })
  }

  const previewRows = preview?.rows.slice(0, PREVIEW_LIMIT) ?? []
  const importDisabled = busy || working || !preview || preview.okCount === 0

  return (
    <div className="money-data-panel">
      {notice && <p className="money-data-notice" role="status">{notice}</p>}
      {error && <p className="money-error">{error}</p>}

      {!parse ? (
        <section
          className={`money-data-card money-data-drop${dragOver ? ' money-data-drop--active' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={(event) => void handleDrop(event)}
        >
          <p className="money-data-kicker">Bring data in</p>
          <h3 className="money-data-title">Import transactions</h3>
          <p className="money-data-copy">
            Drop a CSV from your bank here, or choose a file. You'll see a preview before anything
            is saved — nothing goes into your ledger until you confirm.
          </p>
          <div className="money-data-drop-zone" aria-hidden={!dragOver}>
            <span className="money-data-drop-label">
              {dragOver ? 'Drop to preview' : 'Drag a CSV here'}
            </span>
          </div>
          <div className="money-data-actions">
            <MossButton type="button" onClick={handlePick} disabled={working}>
              Choose a CSV file…
            </MossButton>
          </div>
        </section>
      ) : (
        <section className="money-data-card money-data-import">
          <div className="money-data-import-head">
            <div>
              <p className="money-data-kicker">Review import</p>
              <h3 className="money-data-title">{parse.fileName || 'Imported file'}</h3>
              <p className="money-data-copy">
                Check the preview below. Nothing saves until you tap Import.
              </p>
            </div>
            <MossButton type="button" variant="quiet" onClick={cancelImport}>
              Cancel
            </MossButton>
          </div>

          <div className="money-data-import-quick">
            <label className="money-data-option money-data-preset">
              <span className="money-data-option-label">Export from</span>
              <MossSelect
                className="money-select--register"
                ariaLabel="Bank or app export preset"
                value={presetId}
                options={PRESET_OPTIONS}
                onChange={(value) => handlePresetChange(value as ImportPresetId)}
              />
            </label>
            <label className="money-data-option">
              <span className="money-data-option-label">Add to account</span>
              <MossSelect
                className="money-select--register"
                ariaLabel="Default account"
                value={options.defaultAccountId ?? ''}
                options={accountOptions}
                onChange={(value) =>
                  setOptions((prev) => ({ ...prev, defaultAccountId: value || null }))
                }
              />
            </label>
          </div>

          {preview && (
            <>
              <p className="money-data-summary money-mono" role="status">
                {formatImportSummary(preview)}
              </p>

              {preview.unmatchedCategories.length > 0 && (
                <p className="money-data-hint">
                  These envelopes aren't in your budget yet, so those rows come in uncategorized:{' '}
                  {preview.unmatchedCategories.slice(0, 6).join(', ')}
                  {preview.unmatchedCategories.length > 6 ? '…' : ''}
                </p>
              )}

              {previewRows.length > 0 ? (
                <table className="money-data-preview">
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Payee</th>
                      <th scope="col" className="money-data-preview-num">
                        Amount
                      </th>
                      <th scope="col">Envelope</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row) => (
                      <tr key={row.index} className={`money-data-preview-row--${row.status}`}>
                        <td className="money-mono">{row.dateLabel}</td>
                        <td>{row.payee || row.memo || '—'}</td>
                        <td className="money-data-preview-num money-mono">{row.amountLabel}</td>
                        <td>
                          {row.categoryName ? (
                            <span className={row.categoryMatched ? '' : 'money-data-unmatched'}>
                              {row.categoryName}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>
                          <span className={`money-data-chip money-data-chip--${row.status}`}>
                            {row.status === 'ok'
                              ? 'Ready'
                              : row.status === 'duplicate'
                                ? 'Duplicate'
                                : row.message || 'Skip'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="money-data-copy">No rows to preview from this file.</p>
              )}

              {preview.totalCount > PREVIEW_LIMIT && (
                <p className="money-data-hint money-mono">
                  Showing {PREVIEW_LIMIT} of {preview.totalCount} rows.
                </p>
              )}
            </>
          )}

          <div className="money-data-actions">
            <MossButton type="button" onClick={handleImport} disabled={importDisabled}>
              {preview && preview.okCount > 0
                ? `Import ${preview.okCount} transaction${preview.okCount === 1 ? '' : 's'}`
                : 'Nothing to import'}
            </MossButton>
          </div>

          <details className="money-data-advanced">
            <summary className="money-data-advanced-summary">
              Something look wrong? Adjust columns
            </summary>
            <div className="money-data-mapping" role="list">
              {parse.headers.map((header, index) => (
                <label key={`${header}-${index}`} className="money-data-mapping-row" role="listitem">
                  <span className="money-data-mapping-source money-mono">{header || `Column ${index + 1}`}</span>
                  <span className="money-data-mapping-arrow" aria-hidden>
                    →
                  </span>
                  <MossSelect
                    className="money-select--register money-data-mapping-select"
                    ariaLabel={`Map column ${header || index + 1}`}
                    value={mapping[index] ?? 'ignore'}
                    options={FIELD_OPTIONS}
                    onChange={(value) => setColumn(index, value as ImportFieldTarget)}
                  />
                </label>
              ))}
            </div>

            <div className="money-data-options">
              <label className="money-data-option">
                <span className="money-data-option-label">Dates are</span>
                <MossSelect
                  className="money-select--register"
                  ariaLabel="Date format"
                  value={options.dateFormat}
                  options={DATE_FORMAT_OPTIONS}
                  onChange={(value) =>
                    setOptions((prev) => ({ ...prev, dateFormat: value as ImportOptions['dateFormat'] }))
                  }
                />
              </label>
              {hasAmountColumn && !hasOutInColumns && (
                <label className="money-data-option">
                  <span className="money-data-option-label">Amount column</span>
                  <MossSelect
                    className="money-select--register"
                    ariaLabel="How to read the amount"
                    value={options.amountSign}
                    options={AMOUNT_SIGN_OPTIONS}
                    onChange={(value) =>
                      setOptions((prev) => ({ ...prev, amountSign: value as ImportOptions['amountSign'] }))
                    }
                  />
                </label>
              )}
              <MossCheckbox
                label="Skip rows already in my ledger"
                checked={options.skipDuplicates}
                onChange={(event) =>
                  setOptions((prev) => ({ ...prev, skipDuplicates: event.target.checked }))
                }
              />
            </div>
          </details>
        </section>
      )}

      {!parse && (
        <section className="money-data-card">
          <p className="money-data-kicker">Back up &amp; export</p>
          <h3 className="money-data-title">Save a copy</h3>
          <p className="money-data-copy">
            Export your transactions to open in a spreadsheet, or save a full backup of everything in
            Money — both stay on this device.
          </p>
          <div className="money-data-export-grid">
            <MossButton
              type="button"
              variant="quiet"
              onClick={() => runExport('transactions')}
              disabled={working || busy}
            >
              Transactions (.csv)
            </MossButton>
            <MossButton
              type="button"
              variant="quiet"
              onClick={() => runExport('backup')}
              disabled={working || busy}
            >
              Full backup (.json)
            </MossButton>
            <MossButton
              type="button"
              variant="quiet"
              onClick={handleRestore}
              disabled={working || busy}
            >
              Restore from backup…
            </MossButton>
          </div>
          <p className="money-data-trust">Everything stays on this device. Nothing is uploaded.</p>
        </section>
      )}
    </div>
  )
}

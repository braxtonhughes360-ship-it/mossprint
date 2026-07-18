import { describe, expect, it } from 'vitest'
import { applyImportPreset, detectPreset, guessMapping } from '@shared/moneyImportExport'

describe('CSV import mapping', () => {
  it('guesses a simple Date/Payee/Category/Amount header row', () => {
    const mapping = guessMapping(['Date', 'Payee', 'Category', 'Amount'])
    expect(mapping[0]).toBe('date')
    expect(mapping).toContain('payee')
    expect(mapping).toContain('amount')
  })

  it('detects the Chase preset and maps Description as payee, not Details', () => {
    const headers = ['Details', 'Posting Date', 'Description', 'Amount', 'Type', 'Balance']
    expect(detectPreset(headers)).toBe('chase')

    const applied = applyImportPreset('chase', headers)
    expect(applied.mapping[headers.indexOf('Details')]).toBe('ignore')
    expect(applied.mapping[headers.indexOf('Description')]).toBe('payee')
    expect(applied.mapping[headers.indexOf('Posting Date')]).toBe('date')
    expect(applied.mapping[headers.indexOf('Amount')]).toBe('amount')
  })

  it('detects the Capital One two-column debit/credit preset', () => {
    const headers = ['Transaction Date', 'Description', 'Debit', 'Credit']
    expect(detectPreset(headers)).toBe('capital_one')

    const applied = applyImportPreset('capital_one', headers)
    expect(applied.mapping).toContain('outflow')
    expect(applied.mapping).toContain('inflow')
  })
})

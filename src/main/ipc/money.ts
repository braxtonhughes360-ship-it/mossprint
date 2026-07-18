import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'
import { assertTrustedSender } from './trust'
import type {
  CoverOverspendingInput,
  CreateBudgetRuleInput,
  CreateCashAccountInput,
  CreateCategoryGroupInput,
  CreateCategoryInput,
  CreateInvestmentAccountInput,
  CreateInvestmentActivityInput,
  CreateInvestmentHoldingInput,
  CreateInvestmentSnapshotInput,
  CreatePaycheckInput,
  CreateScheduleInput,
  CreateTransactionInput,
  CreateTransferInput,
  PostScheduleInput,
  RenameCategoryGroupInput,
  SetAssignmentInput,
  SetCategoryGroupInput,
  SetCategoryRolloverInput,
  SetCategorySpendPolicyInput,
  SetCategoryTargetInput,
  SetTransactionStatusInput,
  TransactionSplitInput,
  TransactionStatus,
  TransactionType,
  TransferAssignmentInput,
  UpdatePaycheckInput,
  UpdateInvestmentHoldingInput,
  UpdateTransactionInput
} from '@shared/money'
import {
  coverOverspending,
  createBudgetRule,
  createCashAccount,
  createCategory,
  createCategoryGroup,
  createInvestmentAccount,
  createInvestmentActivity,
  createInvestmentHolding,
  createInvestmentSnapshot,
  createPaycheck,
  createSchedule,
  createTransaction,
  createTransfer,
  deleteBudgetRule,
  deleteCashAccount,
  deleteCategory,
  deleteCategoryGroup,
  deleteInvestmentAccount,
  deleteInvestmentActivity,
  deleteInvestmentHolding,
  deleteInvestmentSnapshot,
  deletePaycheck,
  deleteSchedule,
  deleteTransaction,
  getBudgetOverview,
  getInvestmentsOverview,
  getMoneySummary,
  getMoneyDoorSnapshot,
  getReconciliationSummary,
  getTransactionAudit,
  reconcileClearedForAccount,
  renameCategoryGroup,
  listBudgetRules,
  listCashAccounts,
  listCategories,
  listInvestmentSnapshots,
  listPayees,
  listPaychecks,
  listSchedules,
  listTransactions,
  postSchedule,
  refreshInvestmentQuotes,
  restoreDeletedTransaction,
  revertTransaction,
  setAssignment,
  setCategoryTarget,
  setCategorySpendPolicy,
  setCategoryGroup,
  setCategoryRollover,
  setTransactionStatus,
  transferAssignment,
  updatePaycheck,
  updateInvestmentHolding,
  updateTransaction,
  contributeToSavingsGoal,
  createSavingsGoal,
  deleteSavingsGoal,
  getSavingsOverview,
  listSavingsGoals
} from '../money'
import {
  createExpectedPaycheck,
  deleteExpectedPaycheck,
  getMoneyFlowGuidance,
  getMoneyFlowSettings,
  listExpectedPaychecks,
  setMoneyFlowSettings
} from '../moneyFlow'
import { buildMoneyCockpitPresentation } from '@shared/moneyFlow'
import { getMoneyTrustOverview, getMoneyTrustSettings, setMoneyTrustSettings } from '../moneyTrust'
import {
  createReportPreset,
  deleteReportPreset,
  getMoneyReportsOverview,
  listReportPresets
} from '../moneyReports'
import {
  commitImport,
  exportFullBackup,
  exportTransactionsCsv,
  pickAndParseCsv,
  previewImport,
  restoreFullBackup
} from '../moneyImportExport'
import type { ImportFieldTarget, ImportRequest } from '@shared/moneyImportExport'
import { DEFAULT_IMPORT_OPTIONS, IMPORT_FIELD_TARGETS } from '@shared/moneyImportExport'

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`)
  }
}

function assertInteger(value: unknown, field: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`${field} must be an integer`)
  }
}

function assertOptionalCategoryId(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null
  }
  assertNonEmptyString(value, 'categoryId')
  return value
}

function assertOptionalId(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === '') {
    return null
  }
  assertNonEmptyString(value, field)
  return value
}

function normalizeSplits(value: unknown): TransactionSplitInput[] | undefined {
  if (value === null || value === undefined) return undefined
  if (!Array.isArray(value)) {
    throw new Error('splits must be an array')
  }
  return value.map((raw) => {
    if (!raw || typeof raw !== 'object') {
      throw new Error('Invalid split line')
    }
    const line = raw as { categoryId?: unknown; amountCents?: unknown; memo?: unknown }
    assertInteger(line.amountCents, 'split amountCents')
    return {
      categoryId: assertOptionalCategoryId(line.categoryId),
      amountCents: line.amountCents,
      memo: typeof line.memo === 'string' ? line.memo : undefined
    }
  })
}

const TRANSACTION_TYPES = new Set<TransactionType>(['income', 'expense', 'transfer', 'adjustment'])
const TRANSACTION_STATUSES = new Set<TransactionStatus>(['pending', 'cleared', 'reconciled'])

function normalizeTransactionType(value: unknown): TransactionType | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || !TRANSACTION_TYPES.has(value as TransactionType)) {
    throw new Error('Invalid transaction type')
  }
  return value as TransactionType
}

function normalizeTransactionStatus(value: unknown): TransactionStatus | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || !TRANSACTION_STATUSES.has(value as TransactionStatus)) {
    throw new Error('Invalid transaction status')
  }
  return value as TransactionStatus
}

function normalizeTags(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) throw new Error('tags must be an array')
  return value.map((tag) => {
    if (typeof tag !== 'string') throw new Error('each tag must be a string')
    return tag
  })
}

const IMPORT_TARGET_SET = new Set<ImportFieldTarget>(IMPORT_FIELD_TARGETS)

function normalizeImportRequest(value: unknown): ImportRequest {
  if (!value || typeof value !== 'object') throw new Error('Invalid import request')
  const input = value as Partial<ImportRequest>
  if (!Array.isArray(input.headers) || !input.headers.every((h) => typeof h === 'string')) {
    throw new Error('headers must be strings')
  }
  if (!Array.isArray(input.rows)) throw new Error('rows must be an array')
  const rows = input.rows.map((row) => {
    if (!Array.isArray(row)) throw new Error('each row must be an array')
    return row.map((cell) => (typeof cell === 'string' ? cell : cell == null ? '' : String(cell)))
  })
  if (!Array.isArray(input.mapping) || !input.mapping.every((m) => IMPORT_TARGET_SET.has(m as ImportFieldTarget))) {
    throw new Error('mapping has an invalid field')
  }
  const rawOptions = (input.options ?? {}) as Record<string, unknown>
  return {
    headers: input.headers,
    rows,
    mapping: input.mapping as ImportFieldTarget[],
    options: {
      dateFormat:
        rawOptions.dateFormat === 'mdy' ||
        rawOptions.dateFormat === 'dmy' ||
        rawOptions.dateFormat === 'ymd'
          ? rawOptions.dateFormat
          : 'auto',
      amountSign:
        rawOptions.amountSign === 'expense_positive' || rawOptions.amountSign === 'auto'
          ? rawOptions.amountSign
          : 'expense_negative',
      skipDuplicates: rawOptions.skipDuplicates !== false,
      defaultAccountId:
        typeof rawOptions.defaultAccountId === 'string' && rawOptions.defaultAccountId
          ? rawOptions.defaultAccountId
          : DEFAULT_IMPORT_OPTIONS.defaultAccountId
    }
  }
}

export function registerMoneyHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.MONEY_GET_SUMMARY, (event, periodKey?: unknown) => {
    assertTrustedSender(event)
    if (periodKey !== undefined) {
      assertNonEmptyString(periodKey, 'periodKey')
      return getMoneySummary(periodKey)
    }
    return getMoneySummary()
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_GET_DOOR_SNAPSHOT, (event, periodKey?: unknown) => {
    assertTrustedSender(event)
    if (periodKey !== undefined) {
      assertNonEmptyString(periodKey, 'periodKey')
    }
    const snapshot =
      periodKey !== undefined
        ? getMoneyDoorSnapshot(periodKey as string)
        : getMoneyDoorSnapshot()
    const flow =
      periodKey !== undefined
        ? getMoneyFlowGuidance(periodKey as string)
        : getMoneyFlowGuidance()
    const budget =
      periodKey !== undefined
        ? getBudgetOverview(periodKey as string)
        : getBudgetOverview()
    const monthFlowCents =
      snapshot.summary.monthFlowCents ??
      snapshot.summary.paycheckTotalCents + (snapshot.summary.ledgerNetCents ?? 0)
    const presentation = buildMoneyCockpitPresentation({
      budget,
      monthFlowCents,
      ledgerNetCents: snapshot.summary.ledgerNetCents ?? 0,
      guidance: flow
    })

    return {
      ...snapshot,
      flowStatusLabel: flow.statusLabel,
      flowStatus: flow.status,
      safeToSpendCents: flow.safeToSpend.cents,
      safeToSpendWhy: flow.safeToSpend.why,
      relationshipLine: presentation.relationshipLine,
      rentGlanceWhy: flow.rentGlance.why
    }
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_GET_BUDGET, (event, periodKey?: unknown) => {
    assertTrustedSender(event)
    if (periodKey !== undefined) {
      assertNonEmptyString(periodKey, 'periodKey')
      return getBudgetOverview(periodKey)
    }
    return getBudgetOverview()
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_LIST_PAYCHECKS, (event) => {
    assertTrustedSender(event)
    return listPaychecks()
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_CREATE_PAYCHECK, (event, input: unknown) => {
    assertTrustedSender(event)
    if (!input || typeof input !== 'object') {
      throw new Error('Invalid paycheck input')
    }
    const payload = input as CreatePaycheckInput
    assertNonEmptyString(payload.label, 'label')
    assertInteger(payload.amountCents, 'amountCents')
    assertNonEmptyString(payload.receivedAt, 'receivedAt')
    return createPaycheck({
      label: payload.label,
      amountCents: payload.amountCents,
      receivedAt: payload.receivedAt,
      accountId: assertOptionalId(payload.accountId, 'accountId')
    })
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_LIST_CATEGORIES, (event) => {
    assertTrustedSender(event)
    return listCategories()
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_CREATE_CATEGORY, (event, input: unknown) => {
    assertTrustedSender(event)
    if (!input || typeof input !== 'object') {
      throw new Error('Invalid category input')
    }
    const payload = input as CreateCategoryInput
    assertNonEmptyString(payload.name, 'name')
    return createCategory(payload)
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_SET_ASSIGNMENT, (event, input: unknown) => {
    assertTrustedSender(event)
    if (!input || typeof input !== 'object') {
      throw new Error('Invalid assignment input')
    }
    const payload = input as SetAssignmentInput
    assertNonEmptyString(payload.categoryId, 'categoryId')
    assertNonEmptyString(payload.periodKey, 'periodKey')
    assertInteger(payload.amountCents, 'amountCents')
    return setAssignment(payload)
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_LIST_TRANSACTIONS, (event, limit?: unknown, periodKey?: unknown) => {
    assertTrustedSender(event)
    const resolvedLimit = limit === undefined ? 100 : limit
    assertInteger(resolvedLimit, 'limit')
    if (periodKey !== undefined) {
      assertNonEmptyString(periodKey, 'periodKey')
      return listTransactions(resolvedLimit, periodKey)
    }
    return listTransactions(resolvedLimit)
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_CREATE_TRANSACTION, (event, input: unknown) => {
    assertTrustedSender(event)
    if (!input || typeof input !== 'object') {
      throw new Error('Invalid transaction input')
    }
    const payload = input as CreateTransactionInput
    assertInteger(payload.amountCents, 'amountCents')
    assertNonEmptyString(payload.occurredAt, 'occurredAt')
    return createTransaction({
      amountCents: payload.amountCents,
      type: normalizeTransactionType(payload.type),
      status: normalizeTransactionStatus(payload.status),
      categoryId: assertOptionalCategoryId(payload.categoryId),
      payeeName: typeof payload.payeeName === 'string' ? payload.payeeName : undefined,
      memo: payload.memo,
      notes: typeof payload.notes === 'string' ? payload.notes : undefined,
      tags: normalizeTags(payload.tags),
      occurredAt: payload.occurredAt,
      accountId: assertOptionalId(payload.accountId, 'accountId'),
      splits: normalizeSplits(payload.splits)
    })
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_DELETE_PAYCHECK, (event, id: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(id, 'id')
    deletePaycheck(id)
    return { ok: true as const }
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_UPDATE_PAYCHECK, (event, input: unknown) => {
    assertTrustedSender(event)
    if (!input || typeof input !== 'object') {
      throw new Error('Invalid paycheck input')
    }
    const payload = input as UpdatePaycheckInput
    assertNonEmptyString(payload.id, 'id')
    if (payload.label !== undefined) assertNonEmptyString(payload.label, 'label')
    if (payload.amountCents !== undefined) assertInteger(payload.amountCents, 'amountCents')
    if (payload.receivedAt !== undefined) assertNonEmptyString(payload.receivedAt, 'receivedAt')
    return updatePaycheck({
      id: payload.id,
      label: payload.label,
      amountCents: payload.amountCents,
      receivedAt: payload.receivedAt,
      accountId:
        payload.accountId !== undefined
          ? assertOptionalId(payload.accountId, 'accountId')
          : undefined
    })
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_DELETE_CATEGORY, (event, id: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(id, 'id')
    deleteCategory(id)
    return { ok: true as const }
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_DELETE_TRANSACTION, (event, id: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(id, 'id')
    return deleteTransaction(id)
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_UPDATE_TRANSACTION, (event, input: unknown) => {
    assertTrustedSender(event)
    if (!input || typeof input !== 'object') throw new Error('Invalid transaction input')
    const payload = input as UpdateTransactionInput
    assertNonEmptyString(payload.id, 'id')
    assertInteger(payload.amountCents, 'amountCents')
    assertNonEmptyString(payload.occurredAt, 'occurredAt')
    const type = normalizeTransactionType(payload.type)
    const status = normalizeTransactionStatus(payload.status)
    if (!type) throw new Error('type is required')
    if (!status) throw new Error('status is required')
    return updateTransaction({
      id: payload.id,
      amountCents: payload.amountCents,
      type,
      status,
      categoryId: assertOptionalCategoryId(payload.categoryId),
      payeeName: typeof payload.payeeName === 'string' ? payload.payeeName : undefined,
      memo: payload.memo,
      notes: typeof payload.notes === 'string' ? payload.notes : undefined,
      tags: normalizeTags(payload.tags),
      occurredAt: payload.occurredAt,
      accountId: assertOptionalId(payload.accountId, 'accountId'),
      splits: normalizeSplits(payload.splits)
    })
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_SET_TRANSACTION_STATUS, (event, input: unknown) => {
    assertTrustedSender(event)
    if (!input || typeof input !== 'object') throw new Error('Invalid status input')
    const payload = input as SetTransactionStatusInput
    assertNonEmptyString(payload.id, 'id')
    const status = normalizeTransactionStatus(payload.status)
    if (!status) throw new Error('status is required')
    return setTransactionStatus({ id: payload.id, status })
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_CREATE_TRANSFER, (event, input: unknown) => {
    assertTrustedSender(event)
    if (!input || typeof input !== 'object') throw new Error('Invalid transfer input')
    const payload = input as CreateTransferInput
    assertNonEmptyString(payload.fromAccountId, 'fromAccountId')
    assertNonEmptyString(payload.toAccountId, 'toAccountId')
    assertInteger(payload.amountCents, 'amountCents')
    assertNonEmptyString(payload.occurredAt, 'occurredAt')
    return createTransfer({
      fromAccountId: payload.fromAccountId,
      toAccountId: payload.toAccountId,
      amountCents: payload.amountCents,
      occurredAt: payload.occurredAt,
      memo: payload.memo,
      notes: typeof payload.notes === 'string' ? payload.notes : undefined,
      tags: normalizeTags(payload.tags),
      status: normalizeTransactionStatus(payload.status)
    })
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_RESTORE_TRANSACTION, (event, undoToken: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(undoToken, 'undoToken')
    return restoreDeletedTransaction(undoToken)
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_REVERT_TRANSACTION, (event, id: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(id, 'id')
    return revertTransaction(id)
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_GET_TRANSACTION_AUDIT, (event, transactionId: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(transactionId, 'transactionId')
    return getTransactionAudit(transactionId)
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_GET_RECONCILIATION, (event, accountId: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(accountId, 'accountId')
    return getReconciliationSummary(accountId)
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_RECONCILE_ACCOUNT, (event, accountId: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(accountId, 'accountId')
    return reconcileClearedForAccount(accountId)
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_GET_INVESTMENTS, (event) => {
    assertTrustedSender(event)
    return getInvestmentsOverview()
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_LIST_INVESTMENT_SNAPSHOTS, (event, accountId: unknown, limit?: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(accountId, 'accountId')
    const resolvedLimit = limit === undefined ? 12 : limit
    assertInteger(resolvedLimit, 'limit')
    return listInvestmentSnapshots(accountId, resolvedLimit)
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_CREATE_INVESTMENT_ACCOUNT, (event, input: unknown) => {
    assertTrustedSender(event)
    if (!input || typeof input !== 'object') {
      throw new Error('Invalid investment account input')
    }
    const payload = input as CreateInvestmentAccountInput
    assertNonEmptyString(payload.label, 'label')
    assertNonEmptyString(payload.accountType, 'accountType')
    return createInvestmentAccount(payload)
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_CREATE_INVESTMENT_SNAPSHOT, (event, input: unknown) => {
    assertTrustedSender(event)
    if (!input || typeof input !== 'object') {
      throw new Error('Invalid investment snapshot input')
    }
    const payload = input as CreateInvestmentSnapshotInput
    assertNonEmptyString(payload.accountId, 'accountId')
    assertInteger(payload.valueCents, 'valueCents')
    assertNonEmptyString(payload.asOf, 'asOf')
    return createInvestmentSnapshot(payload)
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_DELETE_INVESTMENT_ACCOUNT, (event, id: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(id, 'id')
    deleteInvestmentAccount(id)
    return { ok: true as const }
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_DELETE_INVESTMENT_SNAPSHOT, (event, id: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(id, 'id')
    deleteInvestmentSnapshot(id)
    return { ok: true as const }
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_CREATE_CATEGORY_GROUP, (event, input: unknown) => {
    assertTrustedSender(event)
    if (!input || typeof input !== 'object') throw new Error('Invalid group input')
    const payload = input as CreateCategoryGroupInput
    assertNonEmptyString(payload.name, 'name')
    return createCategoryGroup(payload)
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_RENAME_CATEGORY_GROUP, (event, input: unknown) => {
    assertTrustedSender(event)
    if (!input || typeof input !== 'object') throw new Error('Invalid group input')
    const payload = input as RenameCategoryGroupInput
    assertNonEmptyString(payload.id, 'id')
    assertNonEmptyString(payload.name, 'name')
    return renameCategoryGroup(payload)
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_DELETE_CATEGORY_GROUP, (event, id: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(id, 'id')
    deleteCategoryGroup(id)
    return { ok: true as const }
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_TRANSFER_ASSIGNMENT, (event, input: unknown) => {
    assertTrustedSender(event)
    if (!input || typeof input !== 'object') throw new Error('Invalid transfer input')
    const payload = input as TransferAssignmentInput
    assertNonEmptyString(payload.fromCategoryId, 'fromCategoryId')
    assertNonEmptyString(payload.toCategoryId, 'toCategoryId')
    assertNonEmptyString(payload.periodKey, 'periodKey')
    assertInteger(payload.amountCents, 'amountCents')
    transferAssignment(payload)
    return { ok: true as const }
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_COVER_OVERSPENDING, (event, input: unknown) => {
    assertTrustedSender(event)
    if (!input || typeof input !== 'object') throw new Error('Invalid cover input')
    const payload = input as CoverOverspendingInput
    assertNonEmptyString(payload.categoryId, 'categoryId')
    assertNonEmptyString(payload.periodKey, 'periodKey')
    coverOverspending(payload)
    return { ok: true as const }
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_LIST_PAYEES, (event) => {
    assertTrustedSender(event)
    return listPayees()
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_CREATE_INVESTMENT_HOLDING, (event, input: unknown) => {
    assertTrustedSender(event)
    if (!input || typeof input !== 'object') throw new Error('Invalid holding input')
    const payload = input as CreateInvestmentHoldingInput
    assertNonEmptyString(payload.accountId, 'accountId')
    assertNonEmptyString(payload.symbol, 'symbol')
    if (typeof payload.quantity !== 'number' || !Number.isFinite(payload.quantity) || payload.quantity <= 0) {
      throw new Error('quantity must be a positive number')
    }
    assertInteger(payload.costBasisCents, 'costBasisCents')
    return createInvestmentHolding(payload)
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_DELETE_INVESTMENT_HOLDING, (event, id: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(id, 'id')
    deleteInvestmentHolding(id)
    return { ok: true as const }
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_REFRESH_INVESTMENT_QUOTES, async (event) => {
    assertTrustedSender(event)
    return refreshInvestmentQuotes()
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_CREATE_INVESTMENT_ACTIVITY, (event, input: unknown) => {
    assertTrustedSender(event)
    if (!input || typeof input !== 'object') throw new Error('Invalid activity input')
    const payload = input as CreateInvestmentActivityInput
    assertNonEmptyString(payload.accountId, 'accountId')
    assertNonEmptyString(payload.type, 'type')
    assertInteger(payload.amountCents, 'amountCents')
    assertNonEmptyString(payload.occurredAt, 'occurredAt')
    return createInvestmentActivity(payload)
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_DELETE_INVESTMENT_ACTIVITY, (event, id: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(id, 'id')
    deleteInvestmentActivity(id)
    return { ok: true as const }
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_UPDATE_INVESTMENT_HOLDING, (event, input: unknown) => {
    assertTrustedSender(event)
    if (!input || typeof input !== 'object') throw new Error('Invalid holding update')
    const payload = input as UpdateInvestmentHoldingInput
    assertNonEmptyString(payload.id, 'id')
    return updateInvestmentHolding(payload)
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_SET_CATEGORY_TARGET, (event, input: unknown) => {
    assertTrustedSender(event)
    if (!input || typeof input !== 'object') throw new Error('Invalid target input')
    const payload = input as SetCategoryTargetInput
    assertNonEmptyString(payload.categoryId, 'categoryId')
    if (payload.targetCents !== null) {
      assertInteger(payload.targetCents, 'targetCents')
      if (payload.targetCents < 0) throw new Error('targetCents must be non-negative')
    }
    setCategoryTarget({ categoryId: payload.categoryId, targetCents: payload.targetCents })
    return { ok: true as const }
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_SET_CATEGORY_SPEND_POLICY, (event, input: unknown) => {
    assertTrustedSender(event)
    if (!input || typeof input !== 'object') throw new Error('Invalid spend policy input')
    const payload = input as SetCategorySpendPolicyInput
    assertNonEmptyString(payload.categoryId, 'categoryId')
    if (typeof payload.countsTowardSafeToSpend !== 'boolean') {
      throw new Error('countsTowardSafeToSpend must be a boolean')
    }
    setCategorySpendPolicy({
      categoryId: payload.categoryId,
      countsTowardSafeToSpend: payload.countsTowardSafeToSpend
    })
    return { ok: true as const }
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_SET_CATEGORY_GROUP, (event, input: unknown) => {
    assertTrustedSender(event)
    if (!input || typeof input !== 'object') throw new Error('Invalid category group input')
    const payload = input as SetCategoryGroupInput
    assertNonEmptyString(payload.categoryId, 'categoryId')
    if (payload.groupId !== null) {
      assertNonEmptyString(payload.groupId, 'groupId')
    }
    setCategoryGroup({ categoryId: payload.categoryId, groupId: payload.groupId })
    return { ok: true as const }
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_SET_CATEGORY_ROLLOVER, (event, input: unknown) => {
    assertTrustedSender(event)
    if (!input || typeof input !== 'object') throw new Error('Invalid rollover input')
    const payload = input as SetCategoryRolloverInput
    assertNonEmptyString(payload.categoryId, 'categoryId')
    if (typeof payload.rolloverEnabled !== 'boolean') {
      throw new Error('rolloverEnabled must be a boolean')
    }
    setCategoryRollover({
      categoryId: payload.categoryId,
      rolloverEnabled: payload.rolloverEnabled
    })
    return { ok: true as const }
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_LIST_CASH_ACCOUNTS, (event) => {
    assertTrustedSender(event)
    return listCashAccounts()
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_CREATE_CASH_ACCOUNT, (event, input: unknown) => {
    assertTrustedSender(event)
    if (!input || typeof input !== 'object') throw new Error('Invalid cash account input')
    const payload = input as CreateCashAccountInput
    assertNonEmptyString(payload.name, 'name')
    assertNonEmptyString(payload.type, 'type')
    if (payload.startingBalanceCents !== undefined) {
      assertInteger(payload.startingBalanceCents, 'startingBalanceCents')
    }
    return createCashAccount(payload)
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_DELETE_CASH_ACCOUNT, (event, id: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(id, 'id')
    deleteCashAccount(id)
    return { ok: true as const }
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_LIST_SCHEDULES, (event) => {
    assertTrustedSender(event)
    return listSchedules()
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_CREATE_SCHEDULE, (event, input: unknown) => {
    assertTrustedSender(event)
    if (!input || typeof input !== 'object') throw new Error('Invalid schedule input')
    const payload = input as CreateScheduleInput
    assertNonEmptyString(payload.kind, 'kind')
    assertNonEmptyString(payload.label, 'label')
    assertInteger(payload.amountCents, 'amountCents')
    assertNonEmptyString(payload.cadence, 'cadence')
    assertNonEmptyString(payload.nextDate, 'nextDate')
    return createSchedule({
      kind: payload.kind,
      label: payload.label,
      amountCents: payload.amountCents,
      categoryId: assertOptionalCategoryId(payload.categoryId),
      accountId: assertOptionalId(payload.accountId, 'accountId'),
      cadence: payload.cadence,
      nextDate: payload.nextDate
    })
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_DELETE_SCHEDULE, (event, id: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(id, 'id')
    deleteSchedule(id)
    return { ok: true as const }
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_POST_SCHEDULE, (event, id: unknown, options?: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(id, 'id')
    if (options === undefined) {
      return postSchedule(id)
    }
    if (!options || typeof options !== 'object') {
      throw new Error('Invalid post schedule options')
    }
    const payload = options as PostScheduleInput
    if (payload.amountCents !== undefined) {
      assertInteger(payload.amountCents, 'amountCents')
      return postSchedule(id, { amountCents: payload.amountCents })
    }
    return postSchedule(id)
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_LIST_RULES, (event) => {
    assertTrustedSender(event)
    return listBudgetRules()
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_CREATE_RULE, (event, input: unknown) => {
    assertTrustedSender(event)
    if (!input || typeof input !== 'object') throw new Error('Invalid rule input')
    const payload = input as CreateBudgetRuleInput
    assertNonEmptyString(payload.matchField, 'matchField')
    assertNonEmptyString(payload.matchType, 'matchType')
    assertNonEmptyString(payload.matchValue, 'matchValue')
    assertNonEmptyString(payload.categoryId, 'categoryId')
    return createBudgetRule(payload)
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_DELETE_RULE, (event, id: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(id, 'id')
    deleteBudgetRule(id)
    return { ok: true as const }
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_GET_FLOW_GUIDANCE, (event, periodKey?: unknown) => {
    assertTrustedSender(event)
    if (periodKey !== undefined) {
      assertNonEmptyString(periodKey, 'periodKey')
      return getMoneyFlowGuidance(periodKey)
    }
    return getMoneyFlowGuidance()
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_GET_FLOW_SETTINGS, (event) => {
    assertTrustedSender(event)
    return getMoneyFlowSettings()
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_SET_FLOW_SETTINGS, (event, input: unknown) => {
    assertTrustedSender(event)
    if (!input || typeof input !== 'object') throw new Error('Invalid flow settings input')
    const payload = input as { holdBufferCents?: unknown; useLowestPaycheckBaseline?: unknown }
    if (payload.holdBufferCents !== undefined) {
      assertInteger(payload.holdBufferCents, 'holdBufferCents')
    }
    if (
      payload.useLowestPaycheckBaseline !== undefined &&
      typeof payload.useLowestPaycheckBaseline !== 'boolean'
    ) {
      throw new Error('useLowestPaycheckBaseline must be a boolean')
    }
    return setMoneyFlowSettings({
      holdBufferCents: payload.holdBufferCents as number | undefined,
      useLowestPaycheckBaseline: payload.useLowestPaycheckBaseline as boolean | undefined
    })
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_LIST_EXPECTED_PAYCHECKS, (event) => {
    assertTrustedSender(event)
    return listExpectedPaychecks()
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_CREATE_EXPECTED_PAYCHECK, (event, input: unknown) => {
    assertTrustedSender(event)
    if (!input || typeof input !== 'object') throw new Error('Invalid expected paycheck input')
    const payload = input as { label?: unknown; amountCents?: unknown; expectedDate?: unknown }
    assertNonEmptyString(payload.label, 'label')
    assertInteger(payload.amountCents, 'amountCents')
    assertNonEmptyString(payload.expectedDate, 'expectedDate')
    return createExpectedPaycheck({
      label: payload.label,
      amountCents: payload.amountCents,
      expectedDate: payload.expectedDate
    })
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_DELETE_EXPECTED_PAYCHECK, (event, id: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(id, 'id')
    deleteExpectedPaycheck(id)
    return { ok: true as const }
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_GET_SAVINGS_OVERVIEW, (event, periodKey?: unknown) => {
    assertTrustedSender(event)
    if (periodKey !== undefined) {
      assertNonEmptyString(periodKey, 'periodKey')
      return getSavingsOverview(periodKey)
    }
    return getSavingsOverview()
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_LIST_SAVINGS_GOALS, (event) => {
    assertTrustedSender(event)
    return listSavingsGoals()
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_CREATE_SAVINGS_GOAL, (event, input: unknown) => {
    assertTrustedSender(event)
    if (!input || typeof input !== 'object') throw new Error('Invalid savings goal input')
    const payload = input as {
      name?: unknown
      targetCents?: unknown
      targetDate?: unknown
      kind?: unknown
      milestonesCents?: unknown
      rolloverEnabled?: unknown
    }
    assertNonEmptyString(payload.name, 'name')
    assertInteger(payload.targetCents, 'targetCents')
    if ((payload.targetCents as number) <= 0) throw new Error('targetCents must be positive')
    let targetDate: string | null | undefined
    if (payload.targetDate !== undefined && payload.targetDate !== null && payload.targetDate !== '') {
      assertNonEmptyString(payload.targetDate, 'targetDate')
      targetDate = payload.targetDate as string
    } else {
      targetDate = null
    }
    return createSavingsGoal({
      name: payload.name as string,
      targetCents: payload.targetCents as number,
      targetDate,
      kind:
        typeof payload.kind === 'string'
          ? (payload.kind as import('@shared/moneySavings').SavingsGoalKind)
          : undefined,
      milestonesCents: Array.isArray(payload.milestonesCents)
        ? (payload.milestonesCents as number[])
        : undefined,
      rolloverEnabled:
        typeof payload.rolloverEnabled === 'boolean' ? payload.rolloverEnabled : undefined
    })
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_DELETE_SAVINGS_GOAL, (event, id: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(id, 'id')
    deleteSavingsGoal(id)
    return { ok: true as const }
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_CONTRIBUTE_SAVINGS_GOAL, (event, input: unknown) => {
    assertTrustedSender(event)
    if (!input || typeof input !== 'object') throw new Error('Invalid contribution input')
    const payload = input as {
      goalId?: unknown
      periodKey?: unknown
      amountCents?: unknown
      memo?: unknown
    }
    assertNonEmptyString(payload.goalId, 'goalId')
    assertNonEmptyString(payload.periodKey, 'periodKey')
    assertInteger(payload.amountCents, 'amountCents')
    return contributeToSavingsGoal({
      goalId: payload.goalId as string,
      periodKey: payload.periodKey as string,
      amountCents: payload.amountCents as number,
      memo: typeof payload.memo === 'string' ? payload.memo : undefined
    })
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_GET_REPORTS_OVERVIEW, (event, filters: unknown, periodKey?: unknown) => {
    assertTrustedSender(event)
    if (periodKey !== undefined) {
      assertNonEmptyString(periodKey, 'periodKey')
      return getMoneyReportsOverview(
        (filters ?? {}) as import('@shared/moneyReports').ReportFilters,
        periodKey
      )
    }
    return getMoneyReportsOverview((filters ?? {}) as import('@shared/moneyReports').ReportFilters)
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_LIST_REPORT_PRESETS, (event) => {
    assertTrustedSender(event)
    return listReportPresets()
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_CREATE_REPORT_PRESET, (event, input: unknown) => {
    assertTrustedSender(event)
    if (!input || typeof input !== 'object') throw new Error('Invalid report preset input')
    const payload = input as { name?: unknown; filters?: unknown; viewMode?: unknown }
    assertNonEmptyString(payload.name, 'name')
    return createReportPreset({
      name: payload.name as string,
      filters: (payload.filters ?? {}) as import('@shared/moneyReports').ReportFilters,
      viewMode:
        payload.viewMode === 'table' || payload.viewMode === 'chart' ? payload.viewMode : undefined
    })
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_DELETE_REPORT_PRESET, (event, id: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(id, 'id')
    deleteReportPreset(id)
    return { ok: true as const }
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_IMPORT_PICK_CSV, (event) => {
    assertTrustedSender(event)
    return pickAndParseCsv()
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_IMPORT_PREVIEW, (event, request: unknown) => {
    assertTrustedSender(event)
    return previewImport(normalizeImportRequest(request))
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_IMPORT_COMMIT, (event, request: unknown) => {
    assertTrustedSender(event)
    return commitImport(normalizeImportRequest(request))
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_EXPORT_TRANSACTIONS_CSV, (event) => {
    assertTrustedSender(event)
    return exportTransactionsCsv()
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_EXPORT_BACKUP, (event) => {
    assertTrustedSender(event)
    return exportFullBackup()
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_RESTORE_BACKUP, (event) => {
    assertTrustedSender(event)
    return restoreFullBackup()
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_GET_TRUST_SETTINGS, (event) => {
    assertTrustedSender(event)
    return getMoneyTrustSettings()
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_SET_TRUST_SETTINGS, (event, input: unknown) => {
    assertTrustedSender(event)
    if (!input || typeof input !== 'object') throw new Error('Invalid trust settings input')
    const payload = input as {
      quoteStaleMinutes?: unknown
      defaultSavingsGoalKind?: unknown
    }
    if (payload.quoteStaleMinutes !== undefined) {
      assertInteger(payload.quoteStaleMinutes, 'quoteStaleMinutes')
    }
    if (payload.defaultSavingsGoalKind !== undefined) {
      const kind = payload.defaultSavingsGoalKind
      if (
        kind !== 'emergency' &&
        kind !== 'cushion' &&
        kind !== 'purchase' &&
        kind !== 'project' &&
        kind !== 'custom'
      ) {
        throw new Error('defaultSavingsGoalKind must be emergency, cushion, purchase, project, or custom')
      }
    }
    return setMoneyTrustSettings({
      quoteStaleMinutes: payload.quoteStaleMinutes as number | undefined,
      defaultSavingsGoalKind: payload.defaultSavingsGoalKind as
        | import('@shared/moneySavings').SavingsGoalKind
        | undefined
    })
  })

  ipcMain.handle(IPC_CHANNELS.MONEY_GET_TRUST_OVERVIEW, (event, periodKey?: unknown) => {
    assertTrustedSender(event)
    if (periodKey !== undefined && typeof periodKey !== 'string') {
      throw new Error('periodKey must be a string')
    }
    return getMoneyTrustOverview(periodKey)
  })
}

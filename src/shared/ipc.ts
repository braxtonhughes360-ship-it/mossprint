import type { DatabaseHealthResult, DatabasePingResult, SettingRecord } from './types'
import type {
  BudgetRuleRecord,
  CashAccountBalance,
  CashAccountRecord,
  CategoryRecord,
  CoverOverspendingInput,
  CreateBudgetRuleInput,
  CreateCashAccountInput,
  CreateCategoryGroupInput,
  CreateCategoryInput,
  CreateInvestmentAccountInput,
  CreateInvestmentHoldingInput,
  CreateInvestmentSnapshotInput,
  CreatePaycheckInput,
  PostScheduleInput,
  CreateScheduleInput,
  CreateTransactionInput,
  CreateTransferInput,
  DeleteTransactionResult,
  InvestmentAccountRecord,
  InvestmentHoldingRecord,
  InvestmentSnapshotRecord,
  InvestmentsOverview,
  LedgerAuditRecord,
  MoneyBudgetOverview,
  MoneySummary,
  MoneyDoorSnapshot,
  PaycheckRecord,
  PayeeRecord,
  RenameCategoryGroupInput,
  ReconciliationSummary,
  ScheduleRecord,
  SetAssignmentInput,
  SetCategorySpendPolicyInput,
  SetCategoryGroupInput,
  SetCategoryRolloverInput,
  SetCategoryTargetInput,
  SetTransactionStatusInput,
  TransactionRecord,
  TransferAssignmentInput,
  UpdatePaycheckInput,
  UpdateTransactionInput
} from './money'
import type {
  CommitDescribePlateInput,
  CreateFoodItemInput,
  DescribeDraftItem,
  DescribeMealInput,
  DescribeMealResult,
  FoodEntryRecord,
  FoodItemRecord,
  FoodSearchResult,
  FoodServingRecord,
  LogEntryInput,
  NutritionDiary,
  NutritionDoorSnapshot,
  NutritionGoals,
  NutritionLookupState,
  NutritionSummary,
  RecentDiaryEntry,
  ResolveDescribeItemInput,
  SetGoalsInput,
  UpdateEntryInput,
  UsdaFoundationImportResult
} from './nutrition'
import type {
  CalendarEventRecord,
  CalendarEventRange,
  CalendarSourceRecord,
  CalendarWeekGlance,
  CalendarMonthGlance,
  CalendarCaldavSubscribeInput,
  CalendarDeleteEventResult,
  CreateCalendarEventInput,
  CreateClassScheduleInput,
  CreateClassScheduleResult,
  UpdateCalendarEventInput,
  CalendarIcsImportResult,
  CalendarIcsPickResult,
  CalendarGoogleConnectResult,
  CalendarGoogleSyncResult,
  CalendarGoogleStatus,
  CalendarDoorSnapshot,
  CalendarSyncAllResult
} from './calendar'
import type {
  AddNewsSourceInput,
  NewsBriefing,
  NewsBriefingOptions,
  NewsDoorSnapshot,
  NewsItemRecord,
  NewsSourceRecord,
  NewsSyncAllResult,
  NewsSyncResult
} from './news'
import type {
  MailConnectImapInput,
  MailConnectResult,
  MailDoorSnapshot,
  MailListOptions,
  MailMessageDetail,
  MailMessageSummary,
  MailSendInput,
  MailSendResult,
  MailStatus,
  MailSyncAllResult,
  MailSyncResult
} from './mail'
import type {
  CreateNoteFolderInput,
  CreateNoteInput,
  CreateNoteTaskInput,
  NoteFolderRecord,
  NoteRecord,
  NotesDoorSnapshot,
  NoteTaskRecord,
  UpdateNoteInput,
  UpdateNoteTaskInput
} from './notes'
import type {
  CreateGoalHabitInput,
  GoalCompletionStatus,
  GoalHabitRecord,
  GoalWeekSnapshot,
  UpdateGoalHabitInput
} from './goals'
import type { WeeklyScoreSnapshot } from './weeklyScore'
import type { CaptureSubmitResult } from './capture'
import type { UpdateState } from './updates'
import type {
  ActivateProfileResponse,
  ActiveProfileState,
  CreateProfileInput,
  CreateProfileResult,
  DeleteProfileInput,
  ProfileSummary,
  RegenerateRecoveryPhraseInput,
  RegenerateRecoveryPhraseResult,
  ResetProfilePasswordInput,
  SetProfilePasswordInput,
  UpdateProfileInput
} from './profiles'

export const IPC_CHANNELS = {
  DB_RUN_HEALTH_CHECK: 'db:run-health-check',
  DB_GET_SETTING: 'db:get-setting',
  DB_SET_SETTING: 'db:set-setting',
  DB_PING: 'db:ping',
  PROFILES_LIST: 'profiles:list',
  PROFILES_GET_ACTIVE: 'profiles:get-active',
  PROFILES_ACTIVATE: 'profiles:activate',
  PROFILES_LOCK: 'profiles:lock',
  PROFILES_CREATE: 'profiles:create',
  PROFILES_UPDATE: 'profiles:update',
  PROFILES_SET_PASSWORD: 'profiles:set-password',
  PROFILES_RESET_PASSWORD: 'profiles:reset-password',
  PROFILES_CLEAR_PASSWORD: 'profiles:clear-password',
  PROFILES_CLEAR_PASSWORD_WITH_RECOVERY: 'profiles:clear-password-with-recovery',
  PROFILES_REGENERATE_RECOVERY: 'profiles:regenerate-recovery',
  PROFILES_SETUP_RECOVERY: 'profiles:setup-recovery',
  PROFILES_ISSUE_RECOVERY_FOR_PASSWORD: 'profiles:issue-recovery-for-password',
  PROFILES_DELETE: 'profiles:delete',
  SHELL_OPEN_EXTERNAL: 'shell:open-external',
  MONEY_GET_SUMMARY: 'money:get-summary',
  MONEY_GET_DOOR_SNAPSHOT: 'money:get-door-snapshot',
  MONEY_GET_BUDGET: 'money:get-budget',
  MONEY_LIST_PAYCHECKS: 'money:list-paychecks',
  MONEY_CREATE_PAYCHECK: 'money:create-paycheck',
  MONEY_LIST_CATEGORIES: 'money:list-categories',
  MONEY_CREATE_CATEGORY: 'money:create-category',
  MONEY_SET_ASSIGNMENT: 'money:set-assignment',
  MONEY_LIST_TRANSACTIONS: 'money:list-transactions',
  MONEY_CREATE_TRANSACTION: 'money:create-transaction',
  MONEY_DELETE_PAYCHECK: 'money:delete-paycheck',
  MONEY_UPDATE_PAYCHECK: 'money:update-paycheck',
  MONEY_DELETE_CATEGORY: 'money:delete-category',
  MONEY_DELETE_TRANSACTION: 'money:delete-transaction',
  MONEY_GET_INVESTMENTS: 'money:get-investments',
  MONEY_LIST_INVESTMENT_SNAPSHOTS: 'money:list-investment-snapshots',
  MONEY_CREATE_INVESTMENT_ACCOUNT: 'money:create-investment-account',
  MONEY_CREATE_INVESTMENT_SNAPSHOT: 'money:create-investment-snapshot',
  MONEY_DELETE_INVESTMENT_ACCOUNT: 'money:delete-investment-account',
  MONEY_DELETE_INVESTMENT_SNAPSHOT: 'money:delete-investment-snapshot',
  MONEY_CREATE_CATEGORY_GROUP: 'money:create-category-group',
  MONEY_RENAME_CATEGORY_GROUP: 'money:rename-category-group',
  MONEY_DELETE_CATEGORY_GROUP: 'money:delete-category-group',
  MONEY_TRANSFER_ASSIGNMENT: 'money:transfer-assignment',
  MONEY_COVER_OVERSPENDING: 'money:cover-overspending',
  MONEY_LIST_PAYEES: 'money:list-payees',
  MONEY_CREATE_INVESTMENT_HOLDING: 'money:create-investment-holding',
  MONEY_DELETE_INVESTMENT_HOLDING: 'money:delete-investment-holding',
  MONEY_REFRESH_INVESTMENT_QUOTES: 'money:refresh-investment-quotes',
  MONEY_CREATE_INVESTMENT_ACTIVITY: 'money:create-investment-activity',
  MONEY_DELETE_INVESTMENT_ACTIVITY: 'money:delete-investment-activity',
  MONEY_UPDATE_INVESTMENT_HOLDING: 'money:update-investment-holding',
  MONEY_SET_CATEGORY_TARGET: 'money:set-category-target',
  MONEY_SET_CATEGORY_SPEND_POLICY: 'money:set-category-spend-policy',
  MONEY_SET_CATEGORY_GROUP: 'money:set-category-group',
  MONEY_SET_CATEGORY_ROLLOVER: 'money:set-category-rollover',
  MONEY_LIST_CASH_ACCOUNTS: 'money:list-cash-accounts',
  MONEY_CREATE_CASH_ACCOUNT: 'money:create-cash-account',
  MONEY_DELETE_CASH_ACCOUNT: 'money:delete-cash-account',
  MONEY_LIST_SCHEDULES: 'money:list-schedules',
  MONEY_CREATE_SCHEDULE: 'money:create-schedule',
  MONEY_DELETE_SCHEDULE: 'money:delete-schedule',
  MONEY_POST_SCHEDULE: 'money:post-schedule',
  MONEY_LIST_RULES: 'money:list-rules',
  MONEY_CREATE_RULE: 'money:create-rule',
  MONEY_DELETE_RULE: 'money:delete-rule',
  MONEY_UPDATE_TRANSACTION: 'money:update-transaction',
  MONEY_SET_TRANSACTION_STATUS: 'money:set-transaction-status',
  MONEY_CREATE_TRANSFER: 'money:create-transfer',
  MONEY_RESTORE_TRANSACTION: 'money:restore-transaction',
  MONEY_REVERT_TRANSACTION: 'money:revert-transaction',
  MONEY_GET_TRANSACTION_AUDIT: 'money:get-transaction-audit',
  MONEY_GET_RECONCILIATION: 'money:get-reconciliation',
  MONEY_RECONCILE_ACCOUNT: 'money:reconcile-account',
  MONEY_GET_FLOW_GUIDANCE: 'money:get-flow-guidance',
  MONEY_GET_FLOW_SETTINGS: 'money:get-flow-settings',
  MONEY_SET_FLOW_SETTINGS: 'money:set-flow-settings',
  MONEY_LIST_EXPECTED_PAYCHECKS: 'money:list-expected-paychecks',
  MONEY_CREATE_EXPECTED_PAYCHECK: 'money:create-expected-paycheck',
  MONEY_DELETE_EXPECTED_PAYCHECK: 'money:delete-expected-paycheck',
  MONEY_GET_SAVINGS_OVERVIEW: 'money:get-savings-overview',
  MONEY_LIST_SAVINGS_GOALS: 'money:list-savings-goals',
  MONEY_CREATE_SAVINGS_GOAL: 'money:create-savings-goal',
  MONEY_DELETE_SAVINGS_GOAL: 'money:delete-savings-goal',
  MONEY_CONTRIBUTE_SAVINGS_GOAL: 'money:contribute-savings-goal',
  MONEY_GET_REPORTS_OVERVIEW: 'money:get-reports-overview',
  MONEY_LIST_REPORT_PRESETS: 'money:list-report-presets',
  MONEY_CREATE_REPORT_PRESET: 'money:create-report-preset',
  MONEY_DELETE_REPORT_PRESET: 'money:delete-report-preset',
  MONEY_IMPORT_PICK_CSV: 'money:import-pick-csv',
  MONEY_IMPORT_PREVIEW: 'money:import-preview',
  MONEY_IMPORT_COMMIT: 'money:import-commit',
  MONEY_EXPORT_TRANSACTIONS_CSV: 'money:export-transactions-csv',
  MONEY_EXPORT_BACKUP: 'money:export-backup',
  MONEY_RESTORE_BACKUP: 'money:restore-backup',
  MONEY_GET_TRUST_SETTINGS: 'money:get-trust-settings',
  MONEY_SET_TRUST_SETTINGS: 'money:set-trust-settings',
  MONEY_GET_TRUST_OVERVIEW: 'money:get-trust-overview',
  NUTRITION_GET_SUMMARY: 'nutrition:get-summary',
  NUTRITION_GET_DOOR_SNAPSHOT: 'nutrition:get-door-snapshot',
  NUTRITION_GET_DIARY: 'nutrition:get-diary',
  NUTRITION_GET_GOALS: 'nutrition:get-goals',
  NUTRITION_SET_GOALS: 'nutrition:set-goals',
  NUTRITION_LIST_FOOD_ITEMS: 'nutrition:list-food-items',
  NUTRITION_LIST_RECENT_FOODS: 'nutrition:list-recent-foods',
  NUTRITION_CREATE_FOOD_ITEM: 'nutrition:create-food-item',
  NUTRITION_LOG_ENTRY: 'nutrition:log-entry',
  NUTRITION_UPDATE_ENTRY: 'nutrition:update-entry',
  NUTRITION_DELETE_ENTRY: 'nutrition:delete-entry',
  NUTRITION_QUICK_ADD_CALORIES: 'nutrition:quick-add-calories',
  NUTRITION_DESCRIBE_MEAL: 'nutrition:describe-meal',
  NUTRITION_RESOLVE_DESCRIBE_ITEM: 'nutrition:resolve-describe-item',
  NUTRITION_COMMIT_DESCRIBE_PLATE: 'nutrition:commit-describe-plate',
  NUTRITION_SEARCH_FOODS: 'nutrition:search-foods',
  NUTRITION_IMPORT_FDC_FOOD: 'nutrition:import-fdc-food',
  NUTRITION_LOOKUP_BARCODE: 'nutrition:lookup-barcode',
  NUTRITION_GET_LOOKUP_STATE: 'nutrition:get-lookup-state',
  NUTRITION_SET_USDA_API_KEY: 'nutrition:set-usda-api-key',
  NUTRITION_IMPORT_USDA_FOUNDATION: 'nutrition:import-usda-foundation',
  NUTRITION_LIST_RECENT_DIARY_ENTRIES: 'nutrition:list-recent-diary-entries',
  NUTRITION_RELOG_RECENT_ENTRY: 'nutrition:relog-recent-entry',
  NUTRITION_LIST_FAVORITE_FOODS: 'nutrition:list-favorite-foods',
  NUTRITION_ADD_FAVORITE_FOOD: 'nutrition:add-favorite-food',
  NUTRITION_REMOVE_FAVORITE_FOOD: 'nutrition:remove-favorite-food',
  NUTRITION_LIST_FOOD_SERVINGS: 'nutrition:list-food-servings',
  CALENDAR_LIST_EVENTS: 'calendar:list-events',
  CALENDAR_LIST_SOURCES: 'calendar:list-sources',
  CALENDAR_SET_SOURCE_ENABLED: 'calendar:set-source-enabled',
  CALENDAR_SUBSCRIBE_CALDAV: 'calendar:subscribe-caldav',
  CALENDAR_GET_WEEK_GLANCE: 'calendar:get-week-glance',
  CALENDAR_GET_MONTH_GLANCE: 'calendar:get-month-glance',
  CALENDAR_CREATE_EVENT: 'calendar:create-event',
  CALENDAR_UPDATE_EVENT: 'calendar:update-event',
  CALENDAR_DELETE_EVENT: 'calendar:delete-event',
  CALENDAR_IMPORT_ICS_FILE: 'calendar:import-ics-file',
  CALENDAR_IMPORT_ICS_URL: 'calendar:import-ics-url',
  CALENDAR_GET_GOOGLE_STATUS: 'calendar:get-google-status',
  CALENDAR_SET_GOOGLE_OAUTH: 'calendar:set-google-oauth',
  CALENDAR_CONNECT_GOOGLE: 'calendar:connect-google',
  CALENDAR_CREATE_CLASS_SCHEDULE: 'calendar:create-class-schedule',
  CALENDAR_SYNC_SOURCE: 'calendar:sync-source',
  CALENDAR_DISCONNECT_GOOGLE: 'calendar:disconnect-google',
  CALENDAR_SYNC_ALL: 'calendar:sync-all',
  CALENDAR_GET_DOOR_SNAPSHOT: 'calendar:get-door-snapshot',
  NEWS_LIST_SOURCES: 'news:list-sources',
  NEWS_ADD_SOURCE: 'news:add-source',
  NEWS_DELETE_SOURCE: 'news:delete-source',
  NEWS_SET_SOURCE_ENABLED: 'news:set-source-enabled',
  NEWS_SYNC_ALL: 'news:sync-all',
  NEWS_SYNC_SOURCE: 'news:sync-source',
  NEWS_LIST_ITEMS: 'news:list-items',
  NEWS_GET_BRIEFING: 'news:get-briefing',
  NEWS_GET_DOOR_SNAPSHOT: 'news:get-door-snapshot',
  NEWS_MARK_READ: 'news:mark-read',
  MAIL_GET_STATUS: 'mail:get-status',
  MAIL_SET_GOOGLE_OAUTH: 'mail:set-google-oauth',
  MAIL_CONNECT_GMAIL: 'mail:connect-gmail',
  MAIL_CANCEL_CONNECT_GMAIL: 'mail:cancel-connect-gmail',
  MAIL_CONNECT_IMAP: 'mail:connect-imap',
  MAIL_DISCONNECT_ACCOUNT: 'mail:disconnect-account',
  MAIL_SYNC_ALL: 'mail:sync-all',
  MAIL_SYNC_ACCOUNT: 'mail:sync-account',
  MAIL_LIST_MESSAGES: 'mail:list-messages',
  MAIL_COUNT_MESSAGES: 'mail:count-messages',
  MAIL_GET_MESSAGE: 'mail:get-message',
  MAIL_GET_DOOR_SNAPSHOT: 'mail:get-door-snapshot',
  MAIL_SET_READ: 'mail:set-read',
  MAIL_ARCHIVE: 'mail:archive',
  MAIL_TRASH: 'mail:trash',
  MAIL_SEND: 'mail:send',
  NOTES_LIST_FOLDERS: 'notes:list-folders',
  NOTES_CREATE_FOLDER: 'notes:create-folder',
  NOTES_RENAME_FOLDER: 'notes:rename-folder',
  NOTES_DELETE_FOLDER: 'notes:delete-folder',
  NOTES_LIST_NOTES: 'notes:list-notes',
  NOTES_GET_NOTE: 'notes:get-note',
  NOTES_CREATE_NOTE: 'notes:create-note',
  NOTES_UPDATE_NOTE: 'notes:update-note',
  NOTES_DELETE_NOTE: 'notes:delete-note',
  NOTES_SET_PIN: 'notes:set-pin',
  NOTES_SEARCH: 'notes:search',
  NOTES_LIST_TASKS: 'notes:list-tasks',
  NOTES_CREATE_TASK: 'notes:create-task',
  NOTES_UPDATE_TASK: 'notes:update-task',
  NOTES_TOGGLE_TASK: 'notes:toggle-task',
  NOTES_DELETE_TASK: 'notes:delete-task',
  NOTES_GET_DOOR_SNAPSHOT: 'notes:get-door-snapshot',
  GOALS_LIST_HABITS: 'goals:list-habits',
  GOALS_CREATE_HABIT: 'goals:create-habit',
  GOALS_UPDATE_HABIT: 'goals:update-habit',
  GOALS_ARCHIVE_HABIT: 'goals:archive-habit',
  GOALS_DELETE_HABIT: 'goals:delete-habit',
  GOALS_GET_WEEK: 'goals:get-week',
  GOALS_SET_COMPLETION: 'goals:set-completion',
  GOALS_TOGGLE_COMPLETION: 'goals:toggle-completion',
  GOALS_GET_WEEKLY_SCORE: 'goals:get-weekly-score',
  CAPTURE_SUBMIT: 'capture:submit',
  CAPTURE_HIDE: 'capture:hide',
  UPDATES_GET_STATE: 'updates:get-state',
  UPDATES_CHECK_NOW: 'updates:check-now',
  UPDATES_RESTART_AND_INSTALL: 'updates:restart-and-install'
} as const

/** Main → renderer push (ipcRenderer.on), not an invoke channel. */
export const UPDATES_STATE_CHANGED_EVENT = 'updates:state-changed'

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]

export interface MossBridge {
  db: {
    runHealthCheck: () => Promise<DatabaseHealthResult>
    getSetting: (key: string) => Promise<SettingRecord | null>
    setSetting: (key: string, value: string) => Promise<SettingRecord>
    ping: () => Promise<DatabasePingResult>
  }
  profiles: {
    list: () => Promise<ProfileSummary[]>
    getActive: () => Promise<ActiveProfileState | null>
    activate: (profileId: string, password?: string) => Promise<ActivateProfileResponse>
    lock: () => Promise<{ ok: true }>
    touchActivity: () => void
    onIdleLocked: (callback: () => void) => () => void
    create: (input: CreateProfileInput) => Promise<CreateProfileResult>
    update: (profileId: string, input: UpdateProfileInput) => Promise<ProfileSummary>
    setPassword: (profileId: string, input: SetProfilePasswordInput) => Promise<ProfileSummary>
    resetPassword: (profileId: string, input: ResetProfilePasswordInput) => Promise<ProfileSummary>
    clearPassword: (profileId: string, currentPassword: string) => Promise<ProfileSummary>
    clearPasswordWithRecovery: (profileId: string, recoveryPhrase: string) => Promise<ProfileSummary>
    regenerateRecovery: (
      profileId: string,
      input: RegenerateRecoveryPhraseInput
    ) => Promise<RegenerateRecoveryPhraseResult>
    setupRecovery: (profileId: string) => Promise<RegenerateRecoveryPhraseResult>
    issueRecoveryForPassword: (profileId: string) => Promise<RegenerateRecoveryPhraseResult>
    delete: (profileId: string, input: DeleteProfileInput) => Promise<{ ok: true }>
  }
  shell: {
    openExternal: (url: string) => Promise<{ ok: true }>
  }
  money: {
    getSummary: (periodKey?: string) => Promise<MoneySummary>
    getDoorSnapshot: (periodKey?: string) => Promise<MoneyDoorSnapshot>
    getBudget: (periodKey?: string) => Promise<MoneyBudgetOverview>
    listPaychecks: () => Promise<PaycheckRecord[]>
    createPaycheck: (input: CreatePaycheckInput) => Promise<PaycheckRecord>
    updatePaycheck: (input: UpdatePaycheckInput) => Promise<PaycheckRecord>
    listCategories: () => Promise<CategoryRecord[]>
    createCategory: (input: CreateCategoryInput) => Promise<CategoryRecord>
    setAssignment: (input: SetAssignmentInput) => Promise<unknown>
    listTransactions: (limit?: number, periodKey?: string) => Promise<TransactionRecord[]>
    createTransaction: (input: CreateTransactionInput) => Promise<TransactionRecord>
    updateTransaction: (input: UpdateTransactionInput) => Promise<TransactionRecord>
    setTransactionStatus: (input: SetTransactionStatusInput) => Promise<TransactionRecord>
    createTransfer: (input: CreateTransferInput) => Promise<TransactionRecord[]>
    restoreTransaction: (undoToken: string) => Promise<{ ok: true }>
    revertTransaction: (id: string) => Promise<TransactionRecord>
    getTransactionAudit: (transactionId: string) => Promise<LedgerAuditRecord[]>
    getReconciliation: (accountId: string) => Promise<ReconciliationSummary>
    reconcileAccount: (accountId: string) => Promise<{ ok: true; count: number }>
    deletePaycheck: (id: string) => Promise<{ ok: true }>
    deleteCategory: (id: string) => Promise<{ ok: true }>
    deleteTransaction: (id: string) => Promise<DeleteTransactionResult>
    getInvestments: () => Promise<InvestmentsOverview>
    listInvestmentSnapshots: (accountId: string, limit?: number) => Promise<InvestmentSnapshotRecord[]>
    createInvestmentAccount: (input: CreateInvestmentAccountInput) => Promise<InvestmentAccountRecord>
    createInvestmentSnapshot: (input: CreateInvestmentSnapshotInput) => Promise<InvestmentSnapshotRecord>
    deleteInvestmentAccount: (id: string) => Promise<{ ok: true }>
    deleteInvestmentSnapshot: (id: string) => Promise<{ ok: true }>
    createCategoryGroup: (input: CreateCategoryGroupInput) => Promise<unknown>
    renameCategoryGroup: (input: RenameCategoryGroupInput) => Promise<unknown>
    deleteCategoryGroup: (id: string) => Promise<{ ok: true }>
    transferAssignment: (input: TransferAssignmentInput) => Promise<{ ok: true }>
    coverOverspending: (input: CoverOverspendingInput) => Promise<{ ok: true }>
    listPayees: () => Promise<PayeeRecord[]>
    createInvestmentHolding: (input: CreateInvestmentHoldingInput) => Promise<InvestmentHoldingRecord>
    deleteInvestmentHolding: (id: string) => Promise<{ ok: true }>
    refreshInvestmentQuotes: () => Promise<{ updated: number; stale: boolean }>
    createInvestmentActivity: (
      input: import('@shared/money').CreateInvestmentActivityInput
    ) => Promise<import('@shared/money').InvestmentActivityRecord>
    deleteInvestmentActivity: (id: string) => Promise<{ ok: true }>
    updateInvestmentHolding: (
      input: import('@shared/money').UpdateInvestmentHoldingInput
    ) => Promise<import('@shared/money').InvestmentHoldingRecord>
    setCategoryTarget: (input: SetCategoryTargetInput) => Promise<{ ok: true }>
    setCategorySpendPolicy: (input: SetCategorySpendPolicyInput) => Promise<{ ok: true }>
    setCategoryGroup: (input: SetCategoryGroupInput) => Promise<{ ok: true }>
    setCategoryRollover: (input: SetCategoryRolloverInput) => Promise<{ ok: true }>
    listCashAccounts: () => Promise<CashAccountBalance[]>
    createCashAccount: (input: CreateCashAccountInput) => Promise<CashAccountRecord>
    deleteCashAccount: (id: string) => Promise<{ ok: true }>
    listSchedules: () => Promise<ScheduleRecord[]>
    createSchedule: (input: CreateScheduleInput) => Promise<ScheduleRecord>
    deleteSchedule: (id: string) => Promise<{ ok: true }>
    postSchedule: (id: string, options?: PostScheduleInput) => Promise<ScheduleRecord>
    listRules: () => Promise<BudgetRuleRecord[]>
    createRule: (input: CreateBudgetRuleInput) => Promise<BudgetRuleRecord>
    deleteRule: (id: string) => Promise<{ ok: true }>
    getFlowGuidance: (periodKey?: string) => Promise<import('@shared/moneyFlow').MoneyFlowGuidance>
    getFlowSettings: () => Promise<import('@shared/moneyFlow').MoneyFlowSettings>
    setFlowSettings: (
      input: Partial<import('@shared/moneyFlow').MoneyFlowSettings>
    ) => Promise<import('@shared/moneyFlow').MoneyFlowSettings>
    listExpectedPaychecks: () => Promise<import('@shared/moneyFlow').ExpectedPaycheckRecord[]>
    createExpectedPaycheck: (
      input: import('@shared/moneyFlow').CreateExpectedPaycheckInput
    ) => Promise<import('@shared/moneyFlow').ExpectedPaycheckRecord>
    deleteExpectedPaycheck: (id: string) => Promise<{ ok: true }>
    getSavingsOverview: (periodKey?: string) => Promise<import('@shared/moneySavings').SavingsOverview>
    listSavingsGoals: () => Promise<import('@shared/moneySavings').SavingsGoalRecord[]>
    createSavingsGoal: (
      input: import('@shared/moneySavings').CreateSavingsGoalInput
    ) => Promise<import('@shared/moneySavings').SavingsGoalRecord>
    deleteSavingsGoal: (id: string) => Promise<{ ok: true }>
    contributeToSavingsGoal: (
      input: import('@shared/moneySavings').ContributeToSavingsGoalInput
    ) => Promise<import('@shared/moneySavings').SavingsContributionRecord>
    getReportsOverview: (
      filters: import('@shared/moneyReports').ReportFilters,
      periodKey?: string
    ) => Promise<import('@shared/moneyReports').MoneyReportsOverview>
    listReportPresets: () => Promise<import('@shared/moneyReports').ReportPresetRecord[]>
    createReportPreset: (
      input: import('@shared/moneyReports').CreateReportPresetInput
    ) => Promise<import('@shared/moneyReports').ReportPresetRecord>
    deleteReportPreset: (id: string) => Promise<{ ok: true }>
    importPickCsv: () => Promise<import('@shared/moneyImportExport').CsvParseResult>
    importPreview: (
      request: import('@shared/moneyImportExport').ImportRequest
    ) => Promise<import('@shared/moneyImportExport').ImportPreview>
    importCommit: (
      request: import('@shared/moneyImportExport').ImportRequest
    ) => Promise<import('@shared/moneyImportExport').ImportCommitResult>
    exportTransactionsCsv: () => Promise<import('@shared/moneyImportExport').ExportResult>
    exportBackup: () => Promise<import('@shared/moneyImportExport').ExportResult>
    restoreBackup: () => Promise<import('@shared/moneyImportExport').RestoreResult>
    getTrustSettings: () => Promise<import('@shared/moneyTrust').MoneyTrustSettings>
    setTrustSettings: (
      input: Partial<import('@shared/moneyTrust').MoneyTrustSettings>
    ) => Promise<import('@shared/moneyTrust').MoneyTrustSettings>
    getTrustOverview: (periodKey?: string) => Promise<import('@shared/moneyTrust').MoneyTrustOverview>
  }
  nutrition: {
    getSummary: (dateKey?: string) => Promise<NutritionSummary>
    getDoorSnapshot: (dateKey?: string) => Promise<NutritionDoorSnapshot>
    getDiary: (dateKey: string) => Promise<NutritionDiary>
    getGoals: () => Promise<NutritionGoals>
    setGoals: (input: SetGoalsInput) => Promise<NutritionGoals>
    listFoodItems: (query?: string) => Promise<FoodItemRecord[]>
    listRecentFoods: (limit?: number) => Promise<FoodItemRecord[]>
    createFoodItem: (input: CreateFoodItemInput) => Promise<FoodItemRecord>
    logEntry: (input: LogEntryInput) => Promise<FoodEntryRecord>
    updateEntry: (id: string, patch: UpdateEntryInput) => Promise<FoodEntryRecord>
    deleteEntry: (id: string) => Promise<{ ok: true }>
    quickAddCalories: (
      dateKey: string,
      mealSlot: LogEntryInput['mealSlot'],
      kcal: number,
      label?: string
    ) => Promise<FoodEntryRecord>
    describeMeal: (input: DescribeMealInput) => Promise<DescribeMealResult>
    resolveDescribeItem: (input: ResolveDescribeItemInput) => Promise<DescribeDraftItem>
    commitDescribePlate: (input: CommitDescribePlateInput) => Promise<FoodEntryRecord[]>
    searchFoods: (
      query: string,
      sources?: Array<'local' | 'fdc' | 'off'>
    ) => Promise<FoodSearchResult[]>
    importFdcFood: (fdcId: string) => Promise<FoodItemRecord>
    lookupBarcode: (barcode: string) => Promise<FoodItemRecord | null>
    getLookupState: () => Promise<NutritionLookupState>
    setUsdaApiKey: (key: string) => Promise<{ ok: true }>
    importUsdaFoundation: () => Promise<UsdaFoundationImportResult>
    listRecentDiaryEntries: (limit?: number) => Promise<RecentDiaryEntry[]>
    relogRecentEntry: (
      dateKey: string,
      mealSlot: LogEntryInput['mealSlot'],
      recent: RecentDiaryEntry,
      quantity?: number
    ) => Promise<FoodEntryRecord>
    listFavoriteFoods: () => Promise<FoodItemRecord[]>
    addFavoriteFood: (foodItemId: string) => Promise<{ ok: true }>
    removeFavoriteFood: (foodItemId: string) => Promise<{ ok: true }>
    listFoodServings: (foodItemId: string) => Promise<FoodServingRecord[]>
  }
  calendar: {
    listEvents: (range: CalendarEventRange) => Promise<CalendarEventRecord[]>
    listSources: () => Promise<CalendarSourceRecord[]>
    setSourceEnabled: (sourceId: string, enabled: boolean) => Promise<{ ok: true }>
    subscribeCaldav: (input: CalendarCaldavSubscribeInput) => Promise<CalendarIcsImportResult>
    getWeekGlance: (weekStartKey?: string) => Promise<CalendarWeekGlance>
    getMonthGlance: (monthKey: string) => Promise<CalendarMonthGlance>
    createEvent: (input: CreateCalendarEventInput) => Promise<CalendarEventRecord>
    createClassSchedule: (input: CreateClassScheduleInput) => Promise<CreateClassScheduleResult>
    updateEvent: (id: string, patch: UpdateCalendarEventInput) => Promise<CalendarEventRecord>
    deleteEvent: (id: string) => Promise<CalendarDeleteEventResult>
    importIcsFile: () => Promise<CalendarIcsPickResult>
    importIcsUrl: (url: string, label?: string) => Promise<CalendarIcsImportResult>
    getGoogleStatus: () => Promise<CalendarGoogleStatus>
    setGoogleOAuth: (clientId: string, clientSecret: string) => Promise<{ ok: true }>
    connectGoogle: (label?: string) => Promise<CalendarGoogleConnectResult>
    syncSource: (sourceId: string) => Promise<CalendarGoogleSyncResult>
    syncAllSources: () => Promise<CalendarSyncAllResult>
    disconnectGoogle: (sourceId: string) => Promise<{ ok: true }>
    getDoorSnapshot: () => Promise<CalendarDoorSnapshot>
  }
  news: {
    listSources: () => Promise<NewsSourceRecord[]>
    addSource: (input: AddNewsSourceInput) => Promise<NewsSourceRecord>
    deleteSource: (sourceId: string) => Promise<{ ok: true }>
    setSourceEnabled: (sourceId: string, enabled: boolean) => Promise<NewsSourceRecord>
    syncAll: () => Promise<NewsSyncAllResult>
    syncSource: (sourceId: string) => Promise<NewsSyncResult>
    listItems: (limit?: number) => Promise<NewsItemRecord[]>
    getBriefing: (options?: NewsBriefingOptions | number) => Promise<NewsBriefing>
    getDoorSnapshot: () => Promise<NewsDoorSnapshot>
    markRead: (itemId: string) => Promise<{ ok: true }>
  }
  mail: {
    getStatus: () => Promise<MailStatus>
    setGoogleOAuth: (clientId: string, clientSecret: string) => Promise<{ ok: true }>
    connectGmail: () => Promise<MailConnectResult>
    cancelConnectGmail: () => Promise<{ ok: true }>
    connectImap: (input: MailConnectImapInput) => Promise<MailConnectResult>
    disconnectAccount: (accountId: string) => Promise<{ ok: true }>
    syncAll: () => Promise<MailSyncAllResult>
    syncAccount: (accountId: string) => Promise<MailSyncResult>
    listMessages: (options?: MailListOptions) => Promise<MailMessageSummary[]>
    countMessages: (options?: MailListOptions) => Promise<number>
    getMessage: (messageId: string) => Promise<MailMessageDetail | null>
    getDoorSnapshot: () => Promise<MailDoorSnapshot>
    setRead: (messageId: string, read: boolean) => Promise<{ ok: true }>
    archive: (messageId: string) => Promise<{ ok: true }>
    trash: (messageId: string) => Promise<{ ok: true }>
    send: (input: MailSendInput) => Promise<MailSendResult>
  }
  notes: {
    listFolders: () => Promise<NoteFolderRecord[]>
    createFolder: (input: CreateNoteFolderInput) => Promise<NoteFolderRecord>
    renameFolder: (id: string, name: string) => Promise<NoteFolderRecord>
    deleteFolder: (id: string) => Promise<{ ok: true }>
    listNotes: (folderId?: string, searchQuery?: string) => Promise<NoteRecord[]>
    getNote: (id: string) => Promise<NoteRecord | null>
    createNote: (input?: CreateNoteInput) => Promise<NoteRecord>
    updateNote: (id: string, patch: UpdateNoteInput) => Promise<NoteRecord>
    deleteNote: (id: string) => Promise<{ ok: true }>
    setPin: (id: string, pinned: boolean) => Promise<NoteRecord>
    search: (query: string) => Promise<NoteRecord[]>
    listTasks: (noteId: string) => Promise<NoteTaskRecord[]>
    createTask: (input: CreateNoteTaskInput) => Promise<NoteTaskRecord>
    updateTask: (id: string, patch: UpdateNoteTaskInput) => Promise<NoteTaskRecord>
    toggleTask: (id: string) => Promise<NoteTaskRecord>
    deleteTask: (id: string) => Promise<{ ok: true }>
    getDoorSnapshot: () => Promise<NotesDoorSnapshot>
  }
  goals: {
    listHabits: () => Promise<GoalHabitRecord[]>
    createHabit: (input: CreateGoalHabitInput) => Promise<GoalHabitRecord>
    updateHabit: (id: string, patch: UpdateGoalHabitInput) => Promise<GoalHabitRecord>
    archiveHabit: (id: string) => Promise<{ ok: true }>
    deleteHabit: (id: string) => Promise<{ ok: true }>
    getWeek: (weekStartKey?: string) => Promise<GoalWeekSnapshot>
    setCompletion: (
      habitId: string,
      dateKey: string,
      status: GoalCompletionStatus | null
    ) => Promise<GoalWeekSnapshot>
    toggleCompletion: (habitId: string, dateKey: string) => Promise<GoalWeekSnapshot>
    getWeeklyScore: (weekStartKey?: string) => Promise<WeeklyScoreSnapshot>
  }
  capture: {
    submit: (text: string) => Promise<CaptureSubmitResult>
    hide: () => Promise<{ ok: true }>
  }
  updates: {
    getState: () => Promise<UpdateState>
    checkNow: () => Promise<UpdateState>
    restartAndInstall: () => Promise<{ ok: true }>
    onStateChanged: (callback: (state: UpdateState) => void) => () => void
  }
}

declare global {
  interface Window {
    moss: MossBridge
  }
}

export {}

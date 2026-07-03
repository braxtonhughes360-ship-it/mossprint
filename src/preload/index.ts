import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC_CHANNELS,
  LOCALAI_DOWNLOAD_PROGRESS_EVENT,
  UPDATES_STATE_CHANGED_EVENT
} from '@shared/ipc'

const mossBridge = {
  db: {
    runHealthCheck: () => ipcRenderer.invoke(IPC_CHANNELS.DB_RUN_HEALTH_CHECK),
    getSetting: (key: string) => ipcRenderer.invoke(IPC_CHANNELS.DB_GET_SETTING, key),
    setSetting: (key: string, value: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.DB_SET_SETTING, key, value),
    ping: () => ipcRenderer.invoke(IPC_CHANNELS.DB_PING)
  },
  profiles: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.PROFILES_LIST),
    getActive: () => ipcRenderer.invoke(IPC_CHANNELS.PROFILES_GET_ACTIVE),
    activate: (profileId: string, password?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.PROFILES_ACTIVATE, profileId, password),
    lock: () => ipcRenderer.invoke(IPC_CHANNELS.PROFILES_LOCK),
    touchActivity: () => ipcRenderer.send('profiles:activity'),
    onIdleLocked: (callback: () => void) => {
      const handler = (): void => callback()
      ipcRenderer.on('profiles:idle-locked', handler)
      return () => ipcRenderer.removeListener('profiles:idle-locked', handler)
    },
    create: (input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.PROFILES_CREATE, input),
    update: (profileId: string, input: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.PROFILES_UPDATE, profileId, input),
    setPassword: (profileId: string, input: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.PROFILES_SET_PASSWORD, profileId, input),
    resetPassword: (profileId: string, input: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.PROFILES_RESET_PASSWORD, profileId, input),
    clearPassword: (profileId: string, currentPassword: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.PROFILES_CLEAR_PASSWORD, profileId, currentPassword),
    clearPasswordWithRecovery: (profileId: string, recoveryPhrase: string) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.PROFILES_CLEAR_PASSWORD_WITH_RECOVERY,
        profileId,
        recoveryPhrase
      ),
    regenerateRecovery: (profileId: string, input: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.PROFILES_REGENERATE_RECOVERY, profileId, input),
    setupRecovery: (profileId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.PROFILES_SETUP_RECOVERY, profileId),
    issueRecoveryForPassword: (profileId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.PROFILES_ISSUE_RECOVERY_FOR_PASSWORD, profileId),
    delete: (profileId: string, input: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.PROFILES_DELETE, profileId, input)
  },
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.SHELL_OPEN_EXTERNAL, url),
    getAppSettings: () => ipcRenderer.invoke(IPC_CHANNELS.SHELL_GET_APP_SETTINGS),
    setAppSettings: (patch: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.SHELL_SET_APP_SETTINGS, patch)
  },
  money: {
    getSummary: (periodKey?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_GET_SUMMARY, periodKey),
    getDoorSnapshot: (periodKey?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_GET_DOOR_SNAPSHOT, periodKey),
    getBudget: (periodKey?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_GET_BUDGET, periodKey),
    listPaychecks: () => ipcRenderer.invoke(IPC_CHANNELS.MONEY_LIST_PAYCHECKS),
    createPaycheck: (input: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_CREATE_PAYCHECK, input),
    listCategories: () => ipcRenderer.invoke(IPC_CHANNELS.MONEY_LIST_CATEGORIES),
    createCategory: (input: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_CREATE_CATEGORY, input),
    setAssignment: (input: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_SET_ASSIGNMENT, input),
    listTransactions: (limit?: number, periodKey?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_LIST_TRANSACTIONS, limit, periodKey),
    createTransaction: (input: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_CREATE_TRANSACTION, input),
    updateTransaction: (input: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_UPDATE_TRANSACTION, input),
    setTransactionStatus: (input: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_SET_TRANSACTION_STATUS, input),
    createTransfer: (input: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_CREATE_TRANSFER, input),
    restoreTransaction: (undoToken: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_RESTORE_TRANSACTION, undoToken),
    revertTransaction: (id: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_REVERT_TRANSACTION, id),
    getTransactionAudit: (transactionId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_GET_TRANSACTION_AUDIT, transactionId),
    getReconciliation: (accountId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_GET_RECONCILIATION, accountId),
    reconcileAccount: (accountId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_RECONCILE_ACCOUNT, accountId),
    deletePaycheck: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.MONEY_DELETE_PAYCHECK, id),
    updatePaycheck: (input: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_UPDATE_PAYCHECK, input),
    deleteCategory: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.MONEY_DELETE_CATEGORY, id),
    deleteTransaction: (id: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_DELETE_TRANSACTION, id),
    getInvestments: () => ipcRenderer.invoke(IPC_CHANNELS.MONEY_GET_INVESTMENTS),
    listInvestmentSnapshots: (accountId: string, limit?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_LIST_INVESTMENT_SNAPSHOTS, accountId, limit),
    createInvestmentAccount: (input: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_CREATE_INVESTMENT_ACCOUNT, input),
    createInvestmentSnapshot: (input: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_CREATE_INVESTMENT_SNAPSHOT, input),
    deleteInvestmentAccount: (id: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_DELETE_INVESTMENT_ACCOUNT, id),
    deleteInvestmentSnapshot: (id: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_DELETE_INVESTMENT_SNAPSHOT, id),
    createCategoryGroup: (input: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_CREATE_CATEGORY_GROUP, input),
    renameCategoryGroup: (input: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_RENAME_CATEGORY_GROUP, input),
    deleteCategoryGroup: (id: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_DELETE_CATEGORY_GROUP, id),
    transferAssignment: (input: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_TRANSFER_ASSIGNMENT, input),
    coverOverspending: (input: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_COVER_OVERSPENDING, input),
    listPayees: () => ipcRenderer.invoke(IPC_CHANNELS.MONEY_LIST_PAYEES),
    createInvestmentHolding: (input: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_CREATE_INVESTMENT_HOLDING, input),
    deleteInvestmentHolding: (id: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_DELETE_INVESTMENT_HOLDING, id),
    refreshInvestmentQuotes: () =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_REFRESH_INVESTMENT_QUOTES),
    createInvestmentActivity: (input: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_CREATE_INVESTMENT_ACTIVITY, input),
    deleteInvestmentActivity: (id: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_DELETE_INVESTMENT_ACTIVITY, id),
    updateInvestmentHolding: (input: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_UPDATE_INVESTMENT_HOLDING, input),
    setCategoryTarget: (input: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_SET_CATEGORY_TARGET, input),
    setCategorySpendPolicy: (input: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_SET_CATEGORY_SPEND_POLICY, input),
    setCategoryGroup: (input: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_SET_CATEGORY_GROUP, input),
    setCategoryRollover: (input: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_SET_CATEGORY_ROLLOVER, input),
    listCashAccounts: () => ipcRenderer.invoke(IPC_CHANNELS.MONEY_LIST_CASH_ACCOUNTS),
    createCashAccount: (input: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_CREATE_CASH_ACCOUNT, input),
    deleteCashAccount: (id: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_DELETE_CASH_ACCOUNT, id),
    listSchedules: () => ipcRenderer.invoke(IPC_CHANNELS.MONEY_LIST_SCHEDULES),
    createSchedule: (input: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_CREATE_SCHEDULE, input),
    deleteSchedule: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.MONEY_DELETE_SCHEDULE, id),
    postSchedule: (id: string, options?: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_POST_SCHEDULE, id, options),
    listRules: () => ipcRenderer.invoke(IPC_CHANNELS.MONEY_LIST_RULES),
    createRule: (input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.MONEY_CREATE_RULE, input),
    deleteRule: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.MONEY_DELETE_RULE, id),
    getFlowGuidance: (periodKey?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_GET_FLOW_GUIDANCE, periodKey),
    getFlowSettings: () => ipcRenderer.invoke(IPC_CHANNELS.MONEY_GET_FLOW_SETTINGS),
    setFlowSettings: (input: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_SET_FLOW_SETTINGS, input),
    listExpectedPaychecks: () => ipcRenderer.invoke(IPC_CHANNELS.MONEY_LIST_EXPECTED_PAYCHECKS),
    createExpectedPaycheck: (input: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_CREATE_EXPECTED_PAYCHECK, input),
    deleteExpectedPaycheck: (id: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_DELETE_EXPECTED_PAYCHECK, id),
    getSavingsOverview: (periodKey?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_GET_SAVINGS_OVERVIEW, periodKey),
    listSavingsGoals: () => ipcRenderer.invoke(IPC_CHANNELS.MONEY_LIST_SAVINGS_GOALS),
    createSavingsGoal: (input: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_CREATE_SAVINGS_GOAL, input),
    deleteSavingsGoal: (id: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_DELETE_SAVINGS_GOAL, id),
    contributeToSavingsGoal: (input: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_CONTRIBUTE_SAVINGS_GOAL, input),
    getReportsOverview: (filters: unknown, periodKey?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_GET_REPORTS_OVERVIEW, filters, periodKey),
    listReportPresets: () => ipcRenderer.invoke(IPC_CHANNELS.MONEY_LIST_REPORT_PRESETS),
    createReportPreset: (input: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_CREATE_REPORT_PRESET, input),
    deleteReportPreset: (id: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_DELETE_REPORT_PRESET, id),
    importPickCsv: () => ipcRenderer.invoke(IPC_CHANNELS.MONEY_IMPORT_PICK_CSV),
    importPreview: (request: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_IMPORT_PREVIEW, request),
    importCommit: (request: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_IMPORT_COMMIT, request),
    exportTransactionsCsv: () =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_EXPORT_TRANSACTIONS_CSV),
    exportBackup: () => ipcRenderer.invoke(IPC_CHANNELS.MONEY_EXPORT_BACKUP),
    restoreBackup: () => ipcRenderer.invoke(IPC_CHANNELS.MONEY_RESTORE_BACKUP),
    getTrustSettings: () => ipcRenderer.invoke(IPC_CHANNELS.MONEY_GET_TRUST_SETTINGS),
    setTrustSettings: (input: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_SET_TRUST_SETTINGS, input),
    getTrustOverview: (periodKey?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.MONEY_GET_TRUST_OVERVIEW, periodKey)
  },
  nutrition: {
    getSummary: (dateKey?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.NUTRITION_GET_SUMMARY, dateKey),
    getDoorSnapshot: (dateKey?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.NUTRITION_GET_DOOR_SNAPSHOT, dateKey),
    getDiary: (dateKey: string) => ipcRenderer.invoke(IPC_CHANNELS.NUTRITION_GET_DIARY, dateKey),
    getGoals: () => ipcRenderer.invoke(IPC_CHANNELS.NUTRITION_GET_GOALS),
    setGoals: (input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.NUTRITION_SET_GOALS, input),
    listFoodItems: (query?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.NUTRITION_LIST_FOOD_ITEMS, query),
    listRecentFoods: (limit?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.NUTRITION_LIST_RECENT_FOODS, limit),
    createFoodItem: (input: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.NUTRITION_CREATE_FOOD_ITEM, input),
    logEntry: (input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.NUTRITION_LOG_ENTRY, input),
    updateEntry: (id: string, patch: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.NUTRITION_UPDATE_ENTRY, id, patch),
    deleteEntry: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.NUTRITION_DELETE_ENTRY, id),
    quickAddCalories: (dateKey: string, mealSlot: string, kcal: number, label?: string) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.NUTRITION_QUICK_ADD_CALORIES,
        dateKey,
        mealSlot,
        kcal,
        label
      ),
    describeMeal: (input: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.NUTRITION_DESCRIBE_MEAL, input),
    resolveDescribeItem: (input: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.NUTRITION_RESOLVE_DESCRIBE_ITEM, input),
    commitDescribePlate: (input: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.NUTRITION_COMMIT_DESCRIBE_PLATE, input),
    searchFoods: (query: string, sources?: string[]) =>
      ipcRenderer.invoke(IPC_CHANNELS.NUTRITION_SEARCH_FOODS, query, sources),
    importFdcFood: (fdcId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.NUTRITION_IMPORT_FDC_FOOD, fdcId),
    lookupBarcode: (barcode: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.NUTRITION_LOOKUP_BARCODE, barcode),
    getLookupState: () => ipcRenderer.invoke(IPC_CHANNELS.NUTRITION_GET_LOOKUP_STATE),
    setUsdaApiKey: (key: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.NUTRITION_SET_USDA_API_KEY, key),
    importUsdaFoundation: () =>
      ipcRenderer.invoke(IPC_CHANNELS.NUTRITION_IMPORT_USDA_FOUNDATION),
    listRecentDiaryEntries: (limit?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.NUTRITION_LIST_RECENT_DIARY_ENTRIES, limit),
    relogRecentEntry: (dateKey: string, mealSlot: string, recent: unknown, quantity?: number) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.NUTRITION_RELOG_RECENT_ENTRY,
        dateKey,
        mealSlot,
        recent,
        quantity
      ),
    listFavoriteFoods: () => ipcRenderer.invoke(IPC_CHANNELS.NUTRITION_LIST_FAVORITE_FOODS),
    addFavoriteFood: (foodItemId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.NUTRITION_ADD_FAVORITE_FOOD, foodItemId),
    removeFavoriteFood: (foodItemId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.NUTRITION_REMOVE_FAVORITE_FOOD, foodItemId),
    listFoodServings: (foodItemId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.NUTRITION_LIST_FOOD_SERVINGS, foodItemId)
  },
  calendar: {
    listEvents: (range: unknown) => ipcRenderer.invoke(IPC_CHANNELS.CALENDAR_LIST_EVENTS, range),
    listSources: () => ipcRenderer.invoke(IPC_CHANNELS.CALENDAR_LIST_SOURCES),
    setSourceEnabled: (sourceId: string, enabled: boolean) =>
      ipcRenderer.invoke(IPC_CHANNELS.CALENDAR_SET_SOURCE_ENABLED, sourceId, enabled),
    subscribeCaldav: (input: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.CALENDAR_SUBSCRIBE_CALDAV, input),
    getWeekGlance: (weekStartKey?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.CALENDAR_GET_WEEK_GLANCE, weekStartKey),
    getMonthGlance: (monthKey: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.CALENDAR_GET_MONTH_GLANCE, monthKey),
    createEvent: (input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.CALENDAR_CREATE_EVENT, input),
    createClassSchedule: (input: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.CALENDAR_CREATE_CLASS_SCHEDULE, input),
    updateEvent: (id: string, patch: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.CALENDAR_UPDATE_EVENT, id, patch),
    deleteEvent: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.CALENDAR_DELETE_EVENT, id),
    importIcsFile: () => ipcRenderer.invoke(IPC_CHANNELS.CALENDAR_IMPORT_ICS_FILE),
    importIcsUrl: (url: string, label?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.CALENDAR_IMPORT_ICS_URL, url, label),
    getGoogleStatus: () => ipcRenderer.invoke(IPC_CHANNELS.CALENDAR_GET_GOOGLE_STATUS),
    setGoogleOAuth: (clientId: string, clientSecret: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.CALENDAR_SET_GOOGLE_OAUTH, clientId, clientSecret),
    connectGoogle: (label?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.CALENDAR_CONNECT_GOOGLE, label),
    syncSource: (sourceId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.CALENDAR_SYNC_SOURCE, sourceId),
    syncAllSources: () => ipcRenderer.invoke(IPC_CHANNELS.CALENDAR_SYNC_ALL),
    disconnectGoogle: (sourceId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.CALENDAR_DISCONNECT_GOOGLE, sourceId),
    getDoorSnapshot: () => ipcRenderer.invoke(IPC_CHANNELS.CALENDAR_GET_DOOR_SNAPSHOT)
  },
  news: {
    listSources: () => ipcRenderer.invoke(IPC_CHANNELS.NEWS_LIST_SOURCES),
    addSource: (input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.NEWS_ADD_SOURCE, input),
    deleteSource: (sourceId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.NEWS_DELETE_SOURCE, sourceId),
    setSourceEnabled: (sourceId: string, enabled: boolean) =>
      ipcRenderer.invoke(IPC_CHANNELS.NEWS_SET_SOURCE_ENABLED, sourceId, enabled),
    syncAll: () => ipcRenderer.invoke(IPC_CHANNELS.NEWS_SYNC_ALL),
    syncSource: (sourceId: string) => ipcRenderer.invoke(IPC_CHANNELS.NEWS_SYNC_SOURCE, sourceId),
    listItems: (limit?: number) => ipcRenderer.invoke(IPC_CHANNELS.NEWS_LIST_ITEMS, limit),
    getBriefing: (options?: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.NEWS_GET_BRIEFING, options),
    getDoorSnapshot: () => ipcRenderer.invoke(IPC_CHANNELS.NEWS_GET_DOOR_SNAPSHOT),
    markRead: (itemId: string) => ipcRenderer.invoke(IPC_CHANNELS.NEWS_MARK_READ, itemId)
  },
  mail: {
    getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.MAIL_GET_STATUS),
    setGoogleOAuth: (clientId: string, clientSecret: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.MAIL_SET_GOOGLE_OAUTH, clientId, clientSecret),
    connectGmail: () => ipcRenderer.invoke(IPC_CHANNELS.MAIL_CONNECT_GMAIL),
    cancelConnectGmail: () => ipcRenderer.invoke(IPC_CHANNELS.MAIL_CANCEL_CONNECT_GMAIL),
    connectImap: (input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.MAIL_CONNECT_IMAP, input),
    disconnectAccount: (accountId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.MAIL_DISCONNECT_ACCOUNT, accountId),
    syncAll: () => ipcRenderer.invoke(IPC_CHANNELS.MAIL_SYNC_ALL),
    syncAccount: (accountId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.MAIL_SYNC_ACCOUNT, accountId),
    listMessages: (options?: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.MAIL_LIST_MESSAGES, options),
    countMessages: (options?: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.MAIL_COUNT_MESSAGES, options),
    getMessage: (messageId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.MAIL_GET_MESSAGE, messageId),
    getDoorSnapshot: () => ipcRenderer.invoke(IPC_CHANNELS.MAIL_GET_DOOR_SNAPSHOT),
    setRead: (messageId: string, read: boolean) =>
      ipcRenderer.invoke(IPC_CHANNELS.MAIL_SET_READ, messageId, read),
    archive: (messageId: string) => ipcRenderer.invoke(IPC_CHANNELS.MAIL_ARCHIVE, messageId),
    trash: (messageId: string) => ipcRenderer.invoke(IPC_CHANNELS.MAIL_TRASH, messageId),
    send: (input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.MAIL_SEND, input)
  },
  notes: {
    listFolders: () => ipcRenderer.invoke(IPC_CHANNELS.NOTES_LIST_FOLDERS),
    createFolder: (input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.NOTES_CREATE_FOLDER, input),
    renameFolder: (id: string, name: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.NOTES_RENAME_FOLDER, id, name),
    deleteFolder: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.NOTES_DELETE_FOLDER, id),
    listNotes: (folderId?: string, searchQuery?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.NOTES_LIST_NOTES, folderId, searchQuery),
    getNote: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.NOTES_GET_NOTE, id),
    createNote: (input?: unknown) => ipcRenderer.invoke(IPC_CHANNELS.NOTES_CREATE_NOTE, input),
    updateNote: (id: string, patch: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.NOTES_UPDATE_NOTE, id, patch),
    deleteNote: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.NOTES_DELETE_NOTE, id),
    setPin: (id: string, pinned: boolean) =>
      ipcRenderer.invoke(IPC_CHANNELS.NOTES_SET_PIN, id, pinned),
    search: (query: string) => ipcRenderer.invoke(IPC_CHANNELS.NOTES_SEARCH, query),
    listTasks: (noteId: string) => ipcRenderer.invoke(IPC_CHANNELS.NOTES_LIST_TASKS, noteId),
    createTask: (input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.NOTES_CREATE_TASK, input),
    updateTask: (id: string, patch: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.NOTES_UPDATE_TASK, id, patch),
    toggleTask: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.NOTES_TOGGLE_TASK, id),
    deleteTask: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.NOTES_DELETE_TASK, id),
    getDoorSnapshot: () => ipcRenderer.invoke(IPC_CHANNELS.NOTES_GET_DOOR_SNAPSHOT)
  },
  goals: {
    listHabits: () => ipcRenderer.invoke(IPC_CHANNELS.GOALS_LIST_HABITS),
    createHabit: (input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.GOALS_CREATE_HABIT, input),
    updateHabit: (id: string, patch: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.GOALS_UPDATE_HABIT, id, patch),
    archiveHabit: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.GOALS_ARCHIVE_HABIT, id),
    deleteHabit: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.GOALS_DELETE_HABIT, id),
    getWeek: (weekStartKey?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.GOALS_GET_WEEK, weekStartKey),
    setCompletion: (habitId: string, dateKey: string, status: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.GOALS_SET_COMPLETION, habitId, dateKey, status),
    toggleCompletion: (habitId: string, dateKey: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.GOALS_TOGGLE_COMPLETION, habitId, dateKey),
    getWeeklyScore: (weekStartKey?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.GOALS_GET_WEEKLY_SCORE, weekStartKey)
  },
  capture: {
    submit: (text: string) => ipcRenderer.invoke(IPC_CHANNELS.CAPTURE_SUBMIT, text),
    confirm: (input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.CAPTURE_CONFIRM, input),
    hide: () => ipcRenderer.invoke(IPC_CHANNELS.CAPTURE_HIDE)
  },
  localai: {
    describePreview: (text: string, surface?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.LOCALAI_DESCRIBE_PREVIEW, text, surface),
    warm: () => ipcRenderer.invoke(IPC_CHANNELS.LOCALAI_WARM),
    getState: () => ipcRenderer.invoke(IPC_CHANNELS.LOCALAI_GET_STATE),
    resetProbe: () => ipcRenderer.invoke(IPC_CHANNELS.LOCALAI_RESET_PROBE),
    setModelConsent: (consent: 'accepted' | 'later') =>
      ipcRenderer.invoke(IPC_CHANNELS.LOCALAI_MODEL_CONSENT, consent),
    startModelDownload: () => ipcRenderer.invoke(IPC_CHANNELS.LOCALAI_MODEL_DOWNLOAD_START),
    cancelModelDownload: () => ipcRenderer.invoke(IPC_CHANNELS.LOCALAI_MODEL_DOWNLOAD_CANCEL),
    onDownloadProgress: (callback: (state: unknown) => void) => {
      const handler = (_event: unknown, state: unknown): void => callback(state)
      ipcRenderer.on(LOCALAI_DOWNLOAD_PROGRESS_EVENT, handler)
      return () => ipcRenderer.removeListener(LOCALAI_DOWNLOAD_PROGRESS_EVENT, handler)
    }
  },
  updates: {
    getState: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATES_GET_STATE),
    checkNow: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATES_CHECK_NOW),
    restartAndInstall: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATES_RESTART_AND_INSTALL),
    onStateChanged: (callback: (state: unknown) => void) => {
      const handler = (_event: unknown, state: unknown): void => callback(state)
      ipcRenderer.on(UPDATES_STATE_CHANGED_EVENT, handler)
      return () => ipcRenderer.removeListener(UPDATES_STATE_CHANGED_EVENT, handler)
    }
  }
}

contextBridge.exposeInMainWorld('moss', mossBridge)

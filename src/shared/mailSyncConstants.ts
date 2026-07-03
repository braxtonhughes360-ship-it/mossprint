/** How far back initial / periodic mail sync reaches. */
export const MAIL_SYNC_RETENTION_DAYS = 90

/** Safety cap per sync pass — avoids multi-thousand-message stalls on first connect. */
export const MAIL_SYNC_MAX_MESSAGES = 1500

/** Default inbox list page size in the reader UI. */
export const MAIL_LIST_DEFAULT_LIMIT = 500

/** Hard cap for list/search queries from the renderer. */
export const MAIL_LIST_MAX_LIMIT = 2000

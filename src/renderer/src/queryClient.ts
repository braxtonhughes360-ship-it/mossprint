import { QueryClient } from '@tanstack/react-query'

/**
 * Shared query client for IPC-backed data. Data lives in local SQLite, so:
 * - no retries (an IPC failure is deterministic, not a flaky network),
 * - short staleTime keeps route re-entry instant without going stale for long,
 * - refetchOnWindowFocus picks up edits made after unlocking/re-focusing.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: 15_000,
      refetchOnWindowFocus: true
    },
    mutations: {
      retry: false
    }
  }
})

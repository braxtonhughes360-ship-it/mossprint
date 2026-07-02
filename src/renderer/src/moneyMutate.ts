export interface MoneyMutateOptions {
  /** Route errors to a module panel instead of the page-level banner. */
  onError?: (message: string) => void
}

export type MoneyMutateFn = (
  task: () => Promise<void>,
  options?: MoneyMutateOptions
) => Promise<void>

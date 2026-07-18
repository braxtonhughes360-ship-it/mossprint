import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

/** Catches renderer crashes so Electron shows a message instead of a blank window. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('MOSS renderer error:', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="moss-fatal-error">
          <h1 className="moss-fatal-error-title">MOSS could not load</h1>
          <p className="moss-fatal-error-copy">
            {this.state.error.message || 'An unexpected error occurred.'}
          </p>
          <p className="moss-fatal-error-hint">
            Quit and reopen MOSS. If this keeps happening, check the terminal for details.
          </p>
        </div>
      )
    }

    return this.props.children
  }
}

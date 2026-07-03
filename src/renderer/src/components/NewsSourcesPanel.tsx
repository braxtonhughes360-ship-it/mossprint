import { NewsSourcesEditor } from './NewsSourcesEditor'
import { useNewsBridge } from '../hooks/useNewsBridge'

/** Settings news source picker — same UI as Setup Manager. */
export function NewsSourcesPanel(): React.JSX.Element {
  const { ready: bridgeReady, error: bridgeError } = useNewsBridge()

  return (
    <section className="settings-card settings-card--news-sources">
      <header className="settings-card-head">
        <p className="settings-kicker">Sources</p>
        <h2 className="settings-card-title">Your headlines</h2>
        <p className="settings-card-copy">
          Same picker as setup — interests, local ZIP lookup, outlet logos, and section chips.
          Headlines sync locally on your dashboard widget.
        </p>
      </header>

      {bridgeError && (
        <p className="calendar-error" role="alert">
          {bridgeError}
        </p>
      )}

      <NewsSourcesEditor
        variant="settings"
        idPrefix="settings-news"
        disabled={!bridgeReady}
      />
    </section>
  )
}

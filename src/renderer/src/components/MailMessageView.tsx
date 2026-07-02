import { useEffect, useMemo, useRef, useState } from 'react'
import type { MailMessageDetail } from '@shared/mail'

/**
 * Renders a message body. HTML mail goes into a sandboxed, same-origin srcdoc iframe with no
 * script capability and a strict inner CSP (default-src 'none'), so email markup/CSS is fully
 * isolated from the MOSS shell and nothing executable runs. Plain-text mail renders directly.
 *
 * `allow-same-origin` (without `allow-scripts`) lets the parent measure content height so the
 * whole reading pane grows to fit — no nested scroll inside the message.
 */
export function MailMessageView({ detail }: { detail: MailMessageDetail }): React.JSX.Element {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(320)

  const srcDoc = useMemo(() => buildSrcDoc(detail.bodyHtml), [detail.bodyHtml])
  const hasHtml = detail.bodyHtml.trim().length > 0

  useEffect(() => {
    if (!hasHtml) return
    const frame = frameRef.current
    if (!frame) return

    let cancelled = false
    const measure = (): void => {
      if (cancelled) return
      try {
        const doc = frame.contentDocument
        const next = doc?.body?.scrollHeight ?? 0
        if (next > 0) setHeight(next + 8)
      } catch {
        // Measurement blocked — keep the fallback height with internal scroll.
      }
    }

    measure()
    // Re-measure after late image reflow (no script runs inside the frame).
    const timers = [250, 800, 1600].map((ms) => window.setTimeout(measure, ms))
    return () => {
      cancelled = true
      timers.forEach((id) => window.clearTimeout(id))
    }
  }, [hasHtml, srcDoc])

  if (!hasHtml) {
    const text = detail.bodyText.trim()
    return (
      <div className="mail-body mail-body-text">
        {text ? text : <span className="mail-body-empty">This message has no text content.</span>}
      </div>
    )
  }

  return (
    <iframe
      ref={frameRef}
      className="mail-body mail-body-frame"
      title="Message body"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc={srcDoc}
      style={{ height }}
      onLoad={() => {
        try {
          const doc = frameRef.current?.contentDocument
          const next = doc?.body?.scrollHeight ?? 0
          if (next > 0) setHeight(next + 8)
        } catch {
          /* keep fallback */
        }
      }}
    />
  )
}

function buildSrcDoc(sanitizedHtml: string): string {
  // Inner CSP is the real network boundary for the message document; the sandbox attribute
  // (no allow-scripts) is the script boundary. `base target=_blank` routes link clicks to the
  // main window's open handler, which only forwards http/https to shell.openExternal.
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data: cid:; style-src 'unsafe-inline'; font-src data:; media-src https: data:;" />
<base target="_blank" />
<style>
  :root { color-scheme: light dark; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    font-size: 14px;
    line-height: 1.55;
    color: #1c1b1a;
    background: transparent;
    padding: 4px 2px 8px;
    word-break: break-word;
    overflow-wrap: anywhere;
  }
  img { max-width: 100%; height: auto; }
  table { max-width: 100%; }
  a { color: #2f6f57; }
  blockquote {
    margin: 0.6em 0;
    padding-left: 0.9em;
    border-left: 2px solid rgba(0,0,0,0.18);
    color: #54514c;
  }
  pre { white-space: pre-wrap; word-break: break-word; }
  @media (prefers-color-scheme: dark) {
    body { color: #e9e6df; }
    a { color: #8fd3b3; }
    blockquote { border-left-color: rgba(255,255,255,0.22); color: #b9b4ab; }
  }
</style>
</head>
<body>${sanitizedHtml}</body>
</html>`
}

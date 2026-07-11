/**
 * Conservative, dependency-free sanitizer for email bodies (SPEC §3.1 — validate before persist,
 * never render untrusted HTML raw). This is defense-in-depth: the renderer additionally shows the
 * result inside a sandboxed iframe with no script execution and a strict inner CSP. We still strip
 * the obviously dangerous constructs here so nothing executable is ever stored or shipped.
 */

export const MAX_BODY_LENGTH = 512 * 1024

// Elements whose entire subtree must go (tag + contents).
const DROP_WITH_CONTENT = [
  'script',
  'style',
  'head',
  'title',
  'noscript',
  'template',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet'
]

// Standalone / structural tags to unwrap (drop the tag, keep any inner text).
const DROP_TAG_ONLY = ['meta', 'link', 'base', 'form', 'input', 'button', 'svg']

function stripWithContent(input: string): string {
  let html = input
  for (const tag of DROP_WITH_CONTENT) {
    const re = new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>`, 'gi')
    html = html.replace(re, '')
    // Unclosed/self-terminated variants.
    html = html.replace(new RegExp(`<${tag}\\b[^>]*/?>`, 'gi'), '')
  }
  return html
}

function stripTagOnly(input: string): string {
  let html = input
  for (const tag of DROP_TAG_ONLY) {
    html = html.replace(new RegExp(`</?${tag}\\b[^>]*>`, 'gi'), '')
  }
  return html
}

// Remove on* event-handler attributes (onclick, onload, …) in either quote style or unquoted.
function stripEventHandlers(input: string): string {
  return input
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
}

// Neutralize dangerous URL schemes in href/src/etc. Allow http(s), mailto, tel, and data:image.
function neutralizeUrls(input: string): string {
  const bad = /(href|src|xlink:href|background|action|formaction)\s*=\s*(["'])\s*(javascript:|vbscript:|data:(?!image\/))[^"']*\2/gi
  let html = input.replace(bad, '$1=$2#$2')
  // Unquoted attribute form.
  html = html.replace(
    /(href|src|background|action)\s*=\s*(javascript:|vbscript:|data:(?!image\/))[^\s>]*/gi,
    '$1=#'
  )
  // Inline-style javascript and CSS expression()/behavior — strip the offending declaration's value.
  html = html.replace(/url\(\s*(['"]?)\s*(javascript:|vbscript:)[^)]*\)/gi, 'url($1#$1)')
  html = html.replace(/expression\s*\([^)]*\)/gi, '')
  html = html.replace(/-moz-binding\s*:[^;"']*/gi, '')
  return html
}

/**
 * Returns sanitized HTML ready to drop into a sandboxed iframe's srcdoc. Empty string when there
 * is nothing renderable. Bounded length to keep one malicious message from bloating the DB.
 */
export function sanitizeEmailHtml(rawHtml: string): string {
  if (!rawHtml) return ''
  let html = rawHtml.slice(0, MAX_BODY_LENGTH)

  // Drop comments first (can hide conditional/script payloads).
  html = html.replace(/<!--[\s\S]*?-->/g, '')
  html = stripWithContent(html)
  html = stripTagOnly(html)
  html = stripEventHandlers(html)
  html = neutralizeUrls(html)

  // Collapse <html>/<body> wrappers — the iframe provides the document shell.
  html = html.replace(/<\/?(html|body)\b[^>]*>/gi, '')

  return html.trim()
}

const BLOCK_BREAK = /<\/(p|div|tr|li|h[1-6]|blockquote|section|article|header|footer)>/gi
const LINE_BREAK = /<br\b[^>]*>/gi

/** Best-effort plaintext from HTML — used for snippet/search and the plain reading fallback. */
export function htmlToText(rawHtml: string): string {
  if (!rawHtml) return ''
  let text = rawHtml.slice(0, MAX_BODY_LENGTH)
  text = text.replace(/<!--[\s\S]*?-->/g, '')
  text = text.replace(/<(script|style|head|title)\b[\s\S]*?<\/\1>/gi, '')
  text = text.replace(LINE_BREAK, '\n')
  text = text.replace(BLOCK_BREAK, '\n')
  text = text.replace(/<[^>]+>/g, '')
  text = decodeEntities(text)
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

function decodeEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => {
      const n = Number(code)
      return Number.isFinite(n) && n > 0 && n < 0x10ffff ? String.fromCodePoint(n) : ''
    })
}

/** Trim a plaintext blob into a single-line snippet of at most `max` chars. */
export function buildSnippet(text: string, max = 180): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat
}

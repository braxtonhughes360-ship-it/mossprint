/**
 * AI reply drafting (beta.5 QA-11c) — DRAFT-ONLY BY CONSTRUCTION.
 *
 * This module turns the currently open message into editable reply text for
 * the composer, and nothing else. It never imports mailSync, never touches
 * SMTP, and no IPC channel couples its output to sending: the only way any
 * text leaves the machine as email is MAIL_SEND, whose payload is the
 * user-initiated composer shape (see mailSendInput.ts and
 * tests/mail-send-invariant.test.ts). Recipients are never produced here —
 * reply headers come from the existing reply flow in the renderer.
 *
 * Privacy: email content goes ONLY to the resolved 127.0.0.1 endpoint
 * (structuredChat — user Ollama on :11434 or the bundled llama.cpp sidecar;
 * see localLlm.ts and SECURITY.md). Bodies are never logged.
 */
import type { MailAiDraftResult } from '@shared/mail'
import { getMessageDetail } from './mail'
import { htmlToText } from './mailHtml'
import { isLocalLlmEnabled, probeOllama, structuredChat } from './localLlm'

/** Same honesty budget as capture: answer inside it or fail plainly — never a hung spinner. */
const CHAT_TIMEOUT_MS = 8_000
const MAX_EMAIL_CHARS = 4_000
const MAX_INSTRUCTION_CHARS = 200
const MAX_REPLY_CHARS = 4_000

/** Flat single-field schema — small local models handle this shape reliably. */
export const MAIL_AI_DRAFT_SCHEMA = {
  type: 'object',
  properties: { reply: { type: 'string' } },
  required: ['reply']
} as const

const SYSTEM_PROMPT = [
  'You draft a plain-text reply to an email the user received.',
  'Write ONLY the body of the reply — no subject line, no To/From/Cc headers,',
  'no quoted copy of the original, no markdown, no placeholders like [Your Name].',
  'Be concise and natural, match the tone of the email, and address what it',
  'actually asks. If the user gives an instruction, follow it.',
  'Respond ONLY with JSON matching the schema.'
].join(' ')

// Lines that start the quoted tail of a thread — everything from the first
// match down is the older conversation, not the message being answered.
const QUOTE_START_PATTERNS = [
  /^>/,
  /^On .{0,200} wrote:\s*$/,
  /^-{2,}\s*Original Message\s*-{2,}$/i,
  /^-{4,}\s*Forwarded message\s*-{4,}$/i
]

/**
 * Keep only the latest message in a reply chain. Falls back to the full text
 * when the heuristics match nothing (or would leave nothing).
 */
export function stripQuotedChain(text: string): string {
  const lines = text.split('\n')
  const cut = lines.findIndex((line) =>
    QUOTE_START_PATTERNS.some((pattern) => pattern.test(line.trim()))
  )
  if (cut === -1) return text.trim()
  const latest = lines.slice(0, cut).join('\n').trim()
  return latest || text.trim()
}

/** Plain text only, headers the model may echo stripped, length capped. */
export function sanitizeAiReplyBody(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  let text = raw.replace(/\r\n/g, '\n').trim()
  text = text.replace(/^(?:(?:subject|to|from|cc|bcc|re)\s*:[^\n]*\n+)+/i, '').trim()
  if (!text) return null
  return text.slice(0, MAX_REPLY_CHARS).trim()
}

/**
 * Draft a reply to a stored message with the local model. Resolves within the
 * probe + chat budget (~9s worst case) with either an editable draft body or
 * an honest failure reason — 'no-model' when smart drafting isn't set up,
 * 'unavailable' for everything transient.
 */
export async function draftMailReply(
  messageId: string,
  instruction?: string
): Promise<MailAiDraftResult> {
  if (process.env.MOSS_HEADLESS_USER_DATA || !isLocalLlmEnabled()) {
    return { ok: false, reason: 'no-model' }
  }

  const detail = getMessageDetail(messageId)
  if (!detail) return { ok: false, reason: 'unavailable' }

  const { model } = await probeOllama()
  if (!model) return { ok: false, reason: 'no-model' }

  const source = detail.bodyText.trim() || htmlToText(detail.bodyHtml)
  const latest = stripQuotedChain(source).slice(0, MAX_EMAIL_CHARS).trim()
  if (!latest) return { ok: false, reason: 'unavailable' }

  const trimmedInstruction = instruction?.trim().slice(0, MAX_INSTRUCTION_CHARS)
  const user = [
    `From: ${detail.fromName || detail.fromEmail} <${detail.fromEmail}>`,
    `Subject: ${detail.subject}`,
    '',
    latest,
    '',
    trimmedInstruction ? `Instruction from the user: ${trimmedInstruction}` : 'Write a reply.'
  ].join('\n')

  // Localhost-only inference — structuredChat resolves exclusively to
  // 127.0.0.1 endpoints (localLlm.ts invariant). Never log this content.
  const result = await structuredChat({
    schema: MAIL_AI_DRAFT_SCHEMA,
    system: SYSTEM_PROMPT,
    user,
    timeoutMs: CHAT_TIMEOUT_MS,
    temperature: 0.4
  })
  if (!result) return { ok: false, reason: 'unavailable' }

  try {
    const parsed = JSON.parse(result.content) as { reply?: unknown }
    const body = sanitizeAiReplyBody(parsed.reply)
    if (!body) return { ok: false, reason: 'unavailable' }
    return { ok: true, body }
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
}

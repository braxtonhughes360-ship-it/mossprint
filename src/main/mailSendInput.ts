/**
 * Validation for the ONE send path (beta.5 QA-11c invariant).
 *
 * Every outbound email goes through MAIL_SEND → assertSendInput → the SMTP sender.
 * This function whitelists the user-initiated composer payload and drops
 * everything else on the floor — there is deliberately no "auto", "aiGenerated",
 * or confirmation-bypass flag, and none may be added. MOSS's AI can draft email;
 * only the human clicking Send in the composer can send one.
 * Covered by tests/mail-send-invariant.test.ts; kept free of Electron imports
 * so that test runs against the real code.
 */
import type { MailSendInput } from '@shared/mail'

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`)
  }
}

export function assertSendInput(value: unknown): MailSendInput {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid send input')
  }
  const raw = value as Record<string, unknown>
  assertNonEmptyString(raw.accountId, 'accountId')
  assertNonEmptyString(raw.to, 'to')
  if (typeof raw.subject !== 'string') {
    throw new Error('subject must be a string')
  }
  if (typeof raw.body !== 'string') {
    throw new Error('body must be a string')
  }
  const input: MailSendInput = {
    accountId: raw.accountId,
    to: raw.to.trim(),
    subject: raw.subject,
    body: raw.body
  }
  if (typeof raw.cc === 'string' && raw.cc.trim()) input.cc = raw.cc.trim()
  if (typeof raw.bcc === 'string' && raw.bcc.trim()) input.bcc = raw.bcc.trim()
  if (typeof raw.inReplyToId === 'string' && raw.inReplyToId.trim()) {
    input.inReplyToId = raw.inReplyToId.trim()
  }
  return input
}

/**
 * QA-11c hard invariant: MOSS's AI can draft email; only you can send one.
 *
 * Two layers, both against real source:
 * 1. assertSendInput — the send handler's validator — accepts exactly the
 *    user-initiated composer payload and silently drops any extra flag, so
 *    no "auto"/"aiGenerated"/bypass field can ever reach SMTP.
 * 2. Source-level: sendMailMessage is callable only from its definition and
 *    the MAIL_SEND IPC handler, and the AI draft module never touches the
 *    send path.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertSendInput } from '../src/main/mailSendInput'

const USER_PAYLOAD = {
  accountId: 'acc-1',
  to: 'sam@example.com',
  subject: 'Re: invoice',
  body: 'Sounds good — sending it over tomorrow.'
}

describe('assertSendInput (user-initiated payload shape)', () => {
  it('accepts the standard composer payload and returns only its fields', () => {
    expect(assertSendInput(USER_PAYLOAD)).toEqual(USER_PAYLOAD)
  })

  it('keeps only the whitelisted optional fields', () => {
    const result = assertSendInput({
      ...USER_PAYLOAD,
      cc: 'cc@example.com',
      bcc: 'bcc@example.com',
      inReplyToId: 'msg-9'
    })
    expect(Object.keys(result).sort()).toEqual([
      'accountId',
      'bcc',
      'body',
      'cc',
      'inReplyToId',
      'subject',
      'to'
    ])
  })

  it('drops any auto-send / AI flag instead of honoring it', () => {
    const result = assertSendInput({
      ...USER_PAYLOAD,
      auto: true,
      autoSend: true,
      aiGenerated: true,
      skipConfirmation: true,
      source: 'llm'
    }) as Record<string, unknown>
    expect(Object.keys(result).sort()).toEqual(['accountId', 'body', 'subject', 'to'])
    expect(result.auto).toBeUndefined()
    expect(result.autoSend).toBeUndefined()
  })

  it.each(['accountId', 'to', 'subject', 'body'] as const)(
    'rejects a payload missing %s',
    (field) => {
      const bad: Record<string, unknown> = { ...USER_PAYLOAD }
      delete bad[field]
      expect(() => assertSendInput(bad)).toThrow()
    }
  )

  it('rejects non-object input', () => {
    expect(() => assertSendInput(null)).toThrow()
    expect(() => assertSendInput('send it')).toThrow()
  })
})

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
}

describe('send path (source-level)', () => {
  const srcDir = join(__dirname, '..', 'src')
  const files = listSourceFiles(srcDir)

  it('sendMailMessage is referenced only by its definition and the MAIL_SEND handler', () => {
    const callers = files
      .filter((file) => readFileSync(file, 'utf8').includes('sendMailMessage'))
      .map((file) => file.slice(srcDir.length + 1))
      .sort()
    expect(callers).toEqual(['main/ipc/mail.ts', 'main/mailSync.ts'])
  })

  it('the MAIL_SEND handler validates through assertSendInput', () => {
    const handler = readFileSync(join(srcDir, 'main', 'ipc', 'mail.ts'), 'utf8')
    expect(handler).toMatch(/sendMailMessage\(assertSendInput\(input\)\)/)
    // No auto/AI flag anywhere near the mail IPC surface.
    expect(handler).not.toMatch(/auto[sS]end|aiGenerated|autoFlag/)
  })

  it('the AI draft module never imports the send path', () => {
    const aiDraft = readFileSync(join(srcDir, 'main', 'mailAiDraft.ts'), 'utf8')
    const imports = aiDraft.match(/^import .*$/gm) ?? []
    expect(imports.join('\n')).not.toMatch(/mailSync|mailImap|mailGoogle|nodemailer/)
    expect(aiDraft).not.toMatch(/sendMailMessage/)
  })
})

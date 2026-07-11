import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StructuredChatParams } from '../src/main/localLlm'

const llmMock = vi.hoisted(() => ({
  enabled: true,
  model: 'qwen3.5:4b' as string | null,
  lastParams: null as StructuredChatParams | null,
  response: null as { content: string; model: string } | null
}))

vi.mock('../src/main/localLlm', () => ({
  isLocalLlmEnabled: () => llmMock.enabled,
  probeOllama: async () => ({ model: llmMock.model, error: null }),
  structuredChat: async (params: StructuredChatParams) => {
    llmMock.lastParams = params
    return llmMock.response
  }
}))

const detailMock = vi.hoisted(() => ({
  detail: null as Record<string, unknown> | null
}))

vi.mock('../src/main/mail', () => ({
  getMessageDetail: () => detailMock.detail
}))

import { draftMailReply, sanitizeAiReplyBody, stripQuotedChain } from '../src/main/mailAiDraft'
import { createSingleFlight } from '../src/shared/singleFlight'

const MESSAGE = {
  id: 'msg-1',
  fromName: 'Sam Field',
  fromEmail: 'sam@example.com',
  subject: 'Invoice for June',
  bodyText: 'Hi — could you send over the June invoice this week?\n\nThanks,\nSam',
  bodyHtml: ''
}

describe('stripQuotedChain', () => {
  it('cuts at "> " quoted lines', () => {
    expect(stripQuotedChain('Latest message.\n> older line\n> more')).toBe('Latest message.')
  })

  it('cuts at the "On … wrote:" attribution line', () => {
    const text = 'See you then!\n\nOn Jul 1, 2026, Sam Field <sam@example.com> wrote:\nold stuff'
    expect(stripQuotedChain(text)).toBe('See you then!')
  })

  it('cuts at forwarded/original-message markers', () => {
    expect(stripQuotedChain('New part\n---------- Forwarded message ----------\nold')).toBe(
      'New part'
    )
    expect(stripQuotedChain('New part\n-- Original Message --\nold')).toBe('New part')
  })

  it('falls back to the full text when stripping would leave nothing', () => {
    expect(stripQuotedChain('> everything is quoted\n> all of it')).toBe(
      '> everything is quoted\n> all of it'
    )
  })
})

describe('sanitizeAiReplyBody', () => {
  it('strips echoed headers and trims', () => {
    expect(sanitizeAiReplyBody('Subject: Re: hi\nTo: sam@example.com\n\nHere you go.')).toBe(
      'Here you go.'
    )
  })

  it('rejects non-strings and empty output', () => {
    expect(sanitizeAiReplyBody(null)).toBeNull()
    expect(sanitizeAiReplyBody('   ')).toBeNull()
  })

  it('caps runaway output length', () => {
    expect(sanitizeAiReplyBody('x'.repeat(10_000))!.length).toBeLessThanOrEqual(4_000)
  })
})

describe('draftMailReply', () => {
  beforeEach(() => {
    llmMock.enabled = true
    llmMock.model = 'qwen3.5:4b'
    llmMock.lastParams = null
    llmMock.response = { content: JSON.stringify({ reply: 'Sure — invoice attached tomorrow.' }), model: 'qwen3.5:4b' }
    detailMock.detail = { ...MESSAGE }
    delete process.env.MOSS_HEADLESS_USER_DATA
  })

  afterEach(() => {
    delete process.env.MOSS_HEADLESS_USER_DATA
  })

  it('returns an editable body on success — and nothing but text', async () => {
    const result = await draftMailReply('msg-1', 'agree, promise it tomorrow')
    expect(result).toEqual({ ok: true, body: 'Sure — invoice attached tomorrow.' })
  })

  it('sends only the latest message (quoted chain stripped) to the model', async () => {
    detailMock.detail = {
      ...MESSAGE,
      bodyText: 'Can you resend?\n\nOn Jun 30, 2026, Me <me@example.com> wrote:\n> my old reply'
    }
    await draftMailReply('msg-1')
    expect(llmMock.lastParams?.user).toContain('Can you resend?')
    expect(llmMock.lastParams?.user).not.toContain('my old reply')
  })

  it('passes the user instruction through, capped', async () => {
    await draftMailReply('msg-1', 'decline politely')
    expect(llmMock.lastParams?.user).toContain('decline politely')
  })

  it('reports no-model when the master toggle is off or nothing is reachable', async () => {
    llmMock.enabled = false
    expect(await draftMailReply('msg-1')).toEqual({ ok: false, reason: 'no-model' })

    llmMock.enabled = true
    llmMock.model = null
    expect(await draftMailReply('msg-1')).toEqual({ ok: false, reason: 'no-model' })
  })

  it('reports no-model in headless mode', async () => {
    process.env.MOSS_HEADLESS_USER_DATA = '/tmp/headless'
    expect(await draftMailReply('msg-1')).toEqual({ ok: false, reason: 'no-model' })
  })

  it('fails honestly when the model times out or returns junk', async () => {
    llmMock.response = null
    expect(await draftMailReply('msg-1')).toEqual({ ok: false, reason: 'unavailable' })

    llmMock.response = { content: 'not json', model: 'qwen3.5:4b' }
    expect(await draftMailReply('msg-1')).toEqual({ ok: false, reason: 'unavailable' })

    llmMock.response = { content: JSON.stringify({ reply: '' }), model: 'qwen3.5:4b' }
    expect(await draftMailReply('msg-1')).toEqual({ ok: false, reason: 'unavailable' })
  })

  it('fails honestly when the message is gone', async () => {
    detailMock.detail = null
    expect(await draftMailReply('missing')).toEqual({ ok: false, reason: 'unavailable' })
  })
})

describe('createSingleFlight (composer double-output guard, QA2-13)', () => {
  it('drops a second request while the first generation is in flight', async () => {
    let generations = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const request = createSingleFlight(async () => {
      generations += 1
      await gate
    })

    // StrictMode's double mount effect fires back-to-back before either resolves.
    const first = request()
    const second = request()
    release()
    await first
    await second
    expect(generations).toBe(1)
  })

  it('allows a fresh request after the previous one settles, even on failure', async () => {
    let calls = 0
    const request = createSingleFlight(async () => {
      calls += 1
      if (calls === 1) throw new Error('model timeout')
    })

    await expect(request()).rejects.toThrow('model timeout')
    await request()
    expect(calls).toBe(2)
  })
})

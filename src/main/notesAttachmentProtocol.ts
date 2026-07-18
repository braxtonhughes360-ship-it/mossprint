import { protocol } from 'electron'
import { readFile } from 'node:fs/promises'
import { NOTE_ATTACHMENT_URL_SCHEME } from '@shared/notes'
import { resolveNoteAttachmentFile } from './notesAttachments'
import { requireActiveProfileDatabase } from './profiles'

// Only DB-backed attachment ids resolve — the handler never serves arbitrary paths,
// and nothing is served while the profile is locked. No remote fetches happen here;
// bytes come straight off the profile directory on disk. A query string is tolerated
// (and ignored) so the renderer can cache-bust after in-place sketch edits.
const ATTACHMENT_URL_PATTERN = new RegExp(
  `^${NOTE_ATTACHMENT_URL_SCHEME}://([0-9a-fA-F-]{36})/?(?:\\?[^#]*)?$`
)

/** Must run before app ready — lets moss-attachment: behave like a trustworthy scheme. */
export function registerNoteAttachmentScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: NOTE_ATTACHMENT_URL_SCHEME, privileges: { secure: true, stream: true } }
  ])
}

export function registerNoteAttachmentProtocol(): void {
  protocol.handle(NOTE_ATTACHMENT_URL_SCHEME, async (request) => {
    try {
      requireActiveProfileDatabase()
    } catch {
      return new Response('Profile locked', { status: 403 })
    }

    const match = ATTACHMENT_URL_PATTERN.exec(request.url)
    if (!match) {
      return new Response('Not found', { status: 404 })
    }

    const file = resolveNoteAttachmentFile(match[1].toLowerCase())
    if (!file) {
      return new Response('Not found', { status: 404 })
    }

    try {
      const bytes = await readFile(file.path)
      return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: {
          'Content-Type': file.mime,
          'Cache-Control': 'no-store'
        }
      })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}

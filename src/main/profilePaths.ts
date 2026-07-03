import { join } from 'node:path'
import { app } from 'electron'

export function profilesRoot(): string {
  return join(app.getPath('userData'), 'profiles')
}

export function profileDirectory(profileId: string): string {
  return join(profilesRoot(), profileId)
}

export function profileDatabasePath(profileId: string): string {
  return join(profileDirectory(profileId), 'moss.sqlite')
}

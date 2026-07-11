import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  PROFILE_AVATAR_COLORS,
  PROFILE_CASUAL_PRIVACY_LABEL,
  PROFILE_SECURITY_COPY,
  type ProfileAvatarColor,
  type ProfileSummary
} from '@shared/profiles'
import { useProfile } from '../context/ProfileProvider'
import { MossBrandLockup } from '../components/MossBrandLockup'
import { MossListStagger, MossListStaggerItem } from '../components/MossListStagger'
// Eager boot surface styled with the setup chrome — must load it at boot,
// not with the lazy SetupWizard route (broke in the QA-09 CSS split).
import '../SetupWizard.css'

function profileInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase()
}

export function ProfilePicker(): React.JSX.Element {
  const navigate = useNavigate()
  const { profiles, activate, refreshProfiles } = useProfile()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [manageMode, setManageMode] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [confirmName, setConfirmName] = useState('')
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const selected = profiles.find((p) => p.id === selectedId) ?? null
  const removing = profiles.find((p) => p.id === removingId) ?? null

  useEffect(() => {
    void refreshProfiles()
  }, [refreshProfiles])

  const beginRemove = (id: string): void => {
    setRemovingId(id)
    setConfirmName('')
    setDeletePassword('')
    setDeleteError(null)
    setSelectedId(null)
  }

  const cancelRemove = (): void => {
    setRemovingId(null)
    setConfirmName('')
    setDeletePassword('')
    setDeleteError(null)
  }

  const handleRemove = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (!removing) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await window.moss.profiles.delete(removing.id, {
        confirmName: confirmName.trim(),
        password: deletePassword || undefined
      })
      await refreshProfiles()
      cancelRemove()
      setManageMode(false)
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Could not remove this profile')
    } finally {
      setDeleting(false)
    }
  }

  const openProfile = useCallback(
    async (profile: ProfileSummary, pwd?: string): Promise<void> => {
      setBusy(true)
      setError(null)
      const result = await activate(profile.id, pwd)
      setBusy(false)

      if (result.ok) return

      if (result.code === 'password_required') {
        setSelectedId(profile.id)
        setError(null)
        return
      }

      if (result.code === 'rate_limited') {
        setError(result.message)
        return
      }

      setError(result.message)
    },
    [activate]
  )

  const handleSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (!selected) return
    await openProfile(selected, password)
  }

  return (
    <div className="moss-setup moss-profile-picker">
      <div className="moss-setup-glow" aria-hidden />
      <div className="moss-setup-card moss-profile-picker-card">
        <header className="moss-setup-head">
          <div className="moss-setup-lockup">
            <MossBrandLockup />
          </div>
        </header>

        <div className="moss-setup-body">
          <section className="moss-setup-step">
            <p className="moss-setup-kicker nutrition-mono">Profiles</p>
            <h1 className="moss-setup-title">Who&apos;s using MOSS?</h1>
            <p className="moss-setup-copy">
              Each profile keeps its own calendar, money, and nutrition on this computer.
            </p>

            <MossListStagger as="ul" className="moss-profile-grid" disabled={manageMode}>
              {profiles.map((profile) => (
                <MossListStaggerItem as="li" key={profile.id} className="moss-profile-cell">
                  <button
                    type="button"
                    className={[
                      'moss-profile-tile',
                      selectedId === profile.id ? 'moss-profile-tile--selected' : ''
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => {
                      if (manageMode) {
                        beginRemove(profile.id)
                        return
                      }
                      if (profile.passwordEnabled) {
                        setSelectedId(profile.id)
                        setPassword('')
                        setError(null)
                      } else {
                        void openProfile(profile)
                      }
                    }}
                    disabled={busy || deleting}
                    aria-pressed={selectedId === profile.id}
                  >
                    <span
                      className="moss-profile-avatar"
                      data-color={profile.avatarColor}
                      aria-hidden
                    >
                      {profileInitials(profile.displayName)}
                    </span>
                    <span className="moss-profile-name">{profile.displayName}</span>
                    {profile.passwordEnabled && (
                      <span className="moss-profile-lock nutrition-mono" aria-label="Password protected">
                        lock
                      </span>
                    )}
                  </button>
                  {manageMode && (
                    <button
                      type="button"
                      className="moss-profile-remove"
                      onClick={() => beginRemove(profile.id)}
                      disabled={deleting}
                      aria-label={`Remove ${profile.displayName}`}
                      title={`Remove ${profile.displayName}`}
                    >
                      ✕
                    </button>
                  )}
                </MossListStaggerItem>
              ))}

              {!manageMode && (
                <MossListStaggerItem as="li">
                  <button
                    type="button"
                    className="moss-profile-tile moss-profile-tile--add"
                    onClick={() => navigate('/setup?new=1')}
                    disabled={busy}
                  >
                    <span className="moss-profile-avatar moss-profile-avatar--add" aria-hidden>
                      +
                    </span>
                    <span className="moss-profile-name">Add profile</span>
                  </button>
                </MossListStaggerItem>
              )}
            </MossListStagger>

            {removing ? (
              <form className="moss-profile-remove-confirm" onSubmit={(e) => void handleRemove(e)}>
                <p className="moss-profile-remove-copy">
                  Remove <strong>{removing.displayName}</strong>? This permanently deletes its
                  calendar, money, mail, and nutrition data on this computer — it can&apos;t be undone.
                </p>
                <label className="settings-field">
                  <span className="settings-field-label">
                    Type “{removing.displayName}” to confirm
                  </span>
                  <input
                    type="text"
                    className="moss-setup-input"
                    value={confirmName}
                    onChange={(e) => setConfirmName(e.target.value)}
                    autoComplete="off"
                    autoFocus
                    disabled={deleting}
                  />
                </label>
                {removing.passwordEnabled && (
                  <label className="settings-field">
                    <span className="settings-field-label">Profile password</span>
                    <input
                      type="password"
                      className="moss-setup-input"
                      value={deletePassword}
                      onChange={(e) => setDeletePassword(e.target.value)}
                      autoComplete="current-password"
                      disabled={deleting}
                    />
                  </label>
                )}
                {deleteError && (
                  <p className="moss-setup-error" role="alert">
                    {deleteError}
                  </p>
                )}
                <div className="moss-profile-remove-actions">
                  <button
                    type="button"
                    className="moss-setup-btn"
                    onClick={cancelRemove}
                    disabled={deleting}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="moss-setup-btn moss-setup-btn--danger"
                    disabled={deleting || confirmName.trim() !== removing.displayName}
                  >
                    {deleting ? 'Removing…' : 'Remove profile'}
                  </button>
                </div>
              </form>
            ) : (
              profiles.length > 0 && (
                <button
                  type="button"
                  className="moss-profile-manage-toggle nutrition-mono"
                  onClick={() => {
                    setManageMode((on) => !on)
                    setSelectedId(null)
                    setError(null)
                  }}
                  disabled={busy}
                >
                  {manageMode ? 'Done' : 'Manage profiles'}
                </button>
              )
            )}

            {selected?.passwordEnabled && (
              <form className="moss-profile-unlock" onSubmit={(e) => void handleSubmit(e)}>
                <label className="settings-field">
                  <span className="settings-field-label">Password for {selected.displayName}</span>
                  <input
                    type="password"
                    className="moss-setup-input"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    autoFocus
                    disabled={busy}
                  />
                </label>
                <button
                  type="submit"
                  className="moss-setup-btn moss-setup-btn--primary"
                  disabled={busy || password.length === 0}
                >
                  {busy ? 'Unlocking…' : 'Unlock'}
                </button>
              </form>
            )}

            {error && (
              <p className="moss-setup-error" role="alert">
                {error}
              </p>
            )}

            <p className="moss-profile-security-copy">{PROFILE_SECURITY_COPY}</p>
            <p className="moss-profile-security-label nutrition-mono">{PROFILE_CASUAL_PRIVACY_LABEL}</p>
          </section>
        </div>
      </div>
    </div>
  )
}

export function ProfileAvatar({
  profile,
  size = 'md'
}: {
  profile: Pick<ProfileSummary, 'displayName' | 'avatarColor'>
  size?: 'sm' | 'md'
}): React.JSX.Element {
  return (
    <span
      className={['moss-profile-avatar', size === 'sm' ? 'moss-profile-avatar--sm' : ''].filter(Boolean).join(' ')}
      data-color={profile.avatarColor satisfies ProfileAvatarColor}
      aria-hidden
    >
      {profileInitials(profile.displayName)}
    </span>
  )
}

export { PROFILE_AVATAR_COLORS }

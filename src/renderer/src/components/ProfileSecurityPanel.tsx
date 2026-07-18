import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  PROFILE_AVATAR_COLORS,
  PROFILE_CASUAL_PRIVACY_LABEL,
  PROFILE_PASSWORD_HINT,
  PROFILE_SECURITY_COPY,
  validateProfilePassword,
  type ProfileAvatarColor
} from '@shared/profiles'
import { useProfile } from '../context/ProfileProvider'
import { ProfileAvatar } from '../pages/ProfilePicker'
import { MossButton } from './MossButton'
import { MossCard } from './MossCard'
import { MossToolbar } from './MossToolbar'
import { ProfilePasswordSetupModal } from './ProfilePasswordSetupModal'

export function ProfileSecurityPanel(): React.JSX.Element {
  const navigate = useNavigate()
  const { activeProfile, lock, refreshProfiles, activate } = useProfile()
  const profileId = activeProfile?.id

  const [newPassword, setNewPassword] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [recoveryPhrase, setRecoveryPhrase] = useState('')
  const [resetPassword, setResetPassword] = useState('')
  const [resetPasswordConfirm, setResetPasswordConfirm] = useState('')
  const [confirmDeleteName, setConfirmDeleteName] = useState('')
  const [deletePassword, setDeletePassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [revealedRecovery, setRevealedRecovery] = useState<string | null>(null)
  const [passwordSetupOpen, setPasswordSetupOpen] = useState(false)

  const passwordEnabled = activeProfile?.passwordEnabled ?? false
  const recoveryEnabled = activeProfile?.recoveryEnabled ?? false

  const newPasswordError = newPassword.length > 0 ? validateProfilePassword(newPassword) : null
  const resetPasswordError = resetPassword.length > 0 ? validateProfilePassword(resetPassword) : null

  const setPassword = useCallback(async (): Promise<void> => {
    if (!profileId) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await window.moss.profiles.setPassword(profileId, {
        password: newPassword,
        currentPassword: currentPassword
      })
      setNewPassword('')
      setCurrentPassword('')
      setMessage('Password updated.')
      await refreshProfiles()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set password')
    } finally {
      setBusy(false)
    }
  }, [currentPassword, newPassword, profileId, refreshProfiles])

  const removePassword = useCallback(async (): Promise<void> => {
    if (!profileId) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await window.moss.profiles.clearPassword(profileId, currentPassword)
      setCurrentPassword('')
      setMessage('Password removed.')
      await refreshProfiles()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove password')
    } finally {
      setBusy(false)
    }
  }, [currentPassword, profileId, refreshProfiles])

  const resetWithRecovery = useCallback(async (): Promise<void> => {
    if (!profileId) return
    if (resetPassword !== resetPasswordConfirm) {
      setError('New passwords do not match.')
      return
    }
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await window.moss.profiles.resetPassword(profileId, {
        recoveryPhrase,
        newPassword: resetPassword
      })
      setRecoveryPhrase('')
      setResetPassword('')
      setResetPasswordConfirm('')
      setMessage('Password reset with your recovery phrase.')
      await refreshProfiles()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset password')
    } finally {
      setBusy(false)
    }
  }, [profileId, recoveryPhrase, refreshProfiles, resetPassword, resetPasswordConfirm])

  const setupLegacyRecovery = useCallback(async (): Promise<void> => {
    if (!profileId) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const result = await window.moss.profiles.setupRecovery(profileId)
      setRevealedRecovery(result.recoveryPhrase)
      setMessage('New recovery phrase generated — save it now.')
      await refreshProfiles()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set up recovery phrase')
    } finally {
      setBusy(false)
    }
  }, [profileId, refreshProfiles])

  const switchProfile = useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      await lock()
    } finally {
      setBusy(false)
    }
  }, [lock])

  const deleteProfile = useCallback(async (): Promise<void> => {
    if (!profileId || !activeProfile) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await window.moss.profiles.delete(profileId, {
        confirmName: confirmDeleteName,
        password: deletePassword || undefined
      })
      setConfirmDeleteName('')
      setDeletePassword('')
      const list = await window.moss.profiles.list()
      if (list.length === 0) {
        navigate('/setup?new=1', { replace: true })
        return
      }
      const next = list[0]!
      const result = await activate(next.id)
      if (!result.ok) {
        await lock()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete profile')
    } finally {
      setBusy(false)
    }
  }, [activate, activeProfile, confirmDeleteName, deletePassword, lock, navigate, profileId])

  if (!activeProfile) return <></>

  return (
    <MossCard className="settings-card" id="settings-profiles">
      <header className="settings-card-head">
        <p className="settings-kicker">Profiles</p>
        <h2 className="settings-card-title">This computer</h2>
        <p className="settings-card-copy">
          Switch people, add a password, or remove a profile. Data stays separate per person.
        </p>
      </header>

      <div className="moss-profile-settings-active">
        <ProfileAvatar profile={activeProfile} size="sm" />
        <div>
          <p className="settings-field-label">Signed in</p>
          <p className="text-sm font-medium text-ink">{activeProfile.displayName}</p>
        </div>
        <MossButton tone="neutral" onClick={() => void switchProfile()} disabled={busy}>
          Switch profile
        </MossButton>
      </div>

      <div className="settings-stack mt-5">
        <p className="settings-card-copy">{PROFILE_SECURITY_COPY}</p>
        <p className="nutrition-mono text-xs text-ink-muted">{PROFILE_CASUAL_PRIVACY_LABEL}</p>
      </div>

      {!passwordEnabled ? (
        <div className="settings-stack mt-6">
          <p className="settings-kicker">Optional lock</p>
          <p className="settings-card-copy">
            No password on this profile yet — anyone on this computer can open it. Add one anytime;
            you&apos;ll get a recovery phrase to save offline.
          </p>
          {!recoveryEnabled && (
            <>
              <p className="settings-card-copy">
                This profile needs a recovery phrase before a password can be enabled.
              </p>
              <MossButton
                tone="neutral"
                disabled={busy}
                onClick={() => void setupLegacyRecovery()}
              >
                Generate recovery phrase
              </MossButton>
              {revealedRecovery && (
                <p className="moss-setup-recovery-phrase nutrition-mono moss-selectable">
                  {revealedRecovery}
                </p>
              )}
            </>
          )}
          <MossButton
            disabled={busy || !recoveryEnabled}
            onClick={() => setPasswordSetupOpen(true)}
          >
            Set up password
          </MossButton>
        </div>
      ) : (
        <>
          <div className="settings-stack mt-6">
            <p className="settings-kicker">Password</p>
            <label className="settings-field">
              <span className="settings-field-label">New password</span>
              <input
                type="password"
                className="settings-text-input"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                disabled={busy}
              />
            </label>
            <label className="settings-field">
              <span className="settings-field-label">Current password</span>
              <input
                type="password"
                className="settings-text-input"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                disabled={busy}
              />
            </label>
            {newPassword.length > 0 && (
              <p className="preference-hint">{newPasswordError ?? PROFILE_PASSWORD_HINT}</p>
            )}
            <MossToolbar label="Password actions" className="settings-actions">
              <MossToolbar.Group label="Password">
              <MossButton
                disabled={
                  busy ||
                  !newPassword ||
                  Boolean(newPasswordError) ||
                  !currentPassword
                }
                onClick={() => void setPassword()}
              >
                Change password
              </MossButton>
              <MossButton
                variant="danger"
                subtle
                disabled={busy || !currentPassword}
                onClick={() => void removePassword()}
              >
                Remove password
              </MossButton>
              </MossToolbar.Group>
            </MossToolbar>
          </div>

          <div className="settings-stack mt-8 pt-6 border-t border-[var(--moss-border)]">
            <p className="settings-kicker">Forgot password?</p>
            <p className="settings-card-copy">
              Enter your 12-word recovery phrase and a new password. MOSS never stores the phrase in
              plain text — only you have it.
            </p>
            <label className="settings-field">
              <span className="settings-field-label">Recovery phrase</span>
              <textarea
                className="settings-text-input moss-setup-recovery-input"
                value={recoveryPhrase}
                onChange={(e) => setRecoveryPhrase(e.target.value)}
                rows={3}
                disabled={busy}
                autoComplete="off"
              />
            </label>
            <label className="settings-field">
              <span className="settings-field-label">New password</span>
              <input
                type="password"
                className="settings-text-input"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                autoComplete="new-password"
                disabled={busy}
              />
            </label>
            <label className="settings-field">
              <span className="settings-field-label">Confirm new password</span>
              <input
                type="password"
                className="settings-text-input"
                value={resetPasswordConfirm}
                onChange={(e) => setResetPasswordConfirm(e.target.value)}
                autoComplete="new-password"
                disabled={busy}
              />
            </label>
            {resetPasswordError && <p className="preference-hint">{resetPasswordError}</p>}
            <MossButton
              tone="neutral"
              disabled={
                busy ||
                !recoveryPhrase.trim() ||
                !resetPassword ||
                Boolean(resetPasswordError) ||
                resetPassword !== resetPasswordConfirm
              }
              onClick={() => void resetWithRecovery()}
            >
              Reset password with recovery phrase
            </MossButton>
          </div>
        </>
      )}

      <div className="settings-stack mt-8 pt-6 border-t border-[var(--moss-border)]">
        <p className="settings-kicker">Danger zone</p>
        <p className="settings-card-copy">
          Deletes this profile and its data file from disk. Type the profile name to confirm.
        </p>
        <label className="settings-field">
          <span className="settings-field-label">Type “{activeProfile.displayName}” to confirm</span>
          <input
            type="text"
            className="settings-text-input"
            value={confirmDeleteName}
            onChange={(e) => setConfirmDeleteName(e.target.value)}
            disabled={busy}
          />
        </label>
        {passwordEnabled && (
          <label className="settings-field">
            <span className="settings-field-label">Profile password</span>
            <input
              type="password"
              className="settings-text-input"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
              disabled={busy}
            />
          </label>
        )}
        <MossButton
          variant="danger"
          subtle
          disabled={
            busy ||
            confirmDeleteName.trim() !== activeProfile.displayName ||
            (passwordEnabled && !deletePassword)
          }
          onClick={() => void deleteProfile()}
        >
          Delete profile
        </MossButton>
      </div>

      {message && <p className="memory-feedback memory-feedback-ok mt-5">{message}</p>}
      {error && <p className="memory-feedback memory-feedback-error mt-5">{error}</p>}

      <MossToolbar label="Profile actions" className="settings-actions mt-6">
        <MossToolbar.Group label="Profiles">
          <MossButton tone="neutral" onClick={() => navigate('/setup?new=1')}>
            Add another profile
          </MossButton>
        </MossToolbar.Group>
      </MossToolbar>

      {passwordSetupOpen && profileId && (
        <ProfilePasswordSetupModal
          profileId={profileId}
          onClose={() => setPasswordSetupOpen(false)}
          onComplete={() => {
            setMessage('Password enabled.')
            void refreshProfiles()
          }}
        />
      )}
    </MossCard>
  )
}

export { PROFILE_AVATAR_COLORS, type ProfileAvatarColor }

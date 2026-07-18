import { useCallback, useState } from 'react'
import { PROFILE_PASSWORD_HINT, validateProfilePassword } from '@shared/profiles'
import { MossButton } from './MossButton'
import { MossCheckbox } from './MossCheckbox'
import { MossModal } from './MossModal'
import { MossToolbar } from './MossToolbar'

interface ProfilePasswordSetupModalProps {
  profileId: string
  onClose: () => void
  onComplete: () => void
}

type Phase = 'password' | 'recovery'

/** Guided password + recovery phrase setup — only shown when enabling a profile password. */
export function ProfilePasswordSetupModal({
  profileId,
  onClose,
  onComplete
}: ProfilePasswordSetupModalProps): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>('password')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [recoveryPhrase, setRecoveryPhrase] = useState<string | null>(null)
  const [recoverySaved, setRecoverySaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const passwordError = password.length > 0 ? validateProfilePassword(password) : null
  const passwordMismatch = password.length > 0 && password !== passwordConfirm
  const passwordInvalid = Boolean(passwordError) || passwordMismatch

  const beginRecoveryStep = useCallback(async (): Promise<void> => {
    if (passwordInvalid) return
    setBusy(true)
    setError(null)
    try {
      const result = await window.moss.profiles.issueRecoveryForPassword(profileId)
      setRecoveryPhrase(result.recoveryPhrase)
      setPhase('recovery')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not prepare recovery phrase')
    } finally {
      setBusy(false)
    }
  }, [passwordInvalid, profileId])

  const finishSetup = useCallback(async (): Promise<void> => {
    if (!recoverySaved) {
      setError('Confirm you saved your recovery phrase before continuing.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await window.moss.profiles.setPassword(profileId, { password })
      onComplete()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not enable password')
    } finally {
      setBusy(false)
    }
  }, [onClose, onComplete, password, profileId, recoverySaved])

  return (
    <MossModal
      onClose={onClose}
      backdropClassName="moss-profile-password-backdrop"
      panelClassName="moss-profile-password-modal"
      ariaLabel="Set up profile password"
    >
      <header className="moss-profile-password-head">
        <div>
          <p className="moss-setup-kicker nutrition-mono">
            {phase === 'password' ? 'Profile password' : 'Recovery phrase'}
          </p>
          <h2 className="moss-profile-password-title">
            {phase === 'password' ? 'Lock this profile to you' : 'Save these 12 words'}
          </h2>
        </div>
        <MossButton
          variant="icon"
          size="xs"
          aria-label="Close"
          disabled={busy}
          onClick={onClose}
        >
          ✕
        </MossButton>
      </header>

      {phase === 'password' ? (
        <>
          <p className="moss-profile-password-copy">{PROFILE_PASSWORD_HINT}</p>

          <label className="moss-profile-password-field">
            <span className="moss-setup-field-label">Password</span>
            <input
              type="password"
              className="moss-setup-input"
              value={password}
              autoComplete="new-password"
              autoFocus
              disabled={busy}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label className="moss-profile-password-field">
            <span className="moss-setup-field-label">Confirm password</span>
            <input
              type="password"
              className="moss-setup-input"
              value={passwordConfirm}
              autoComplete="new-password"
              disabled={busy}
              onChange={(event) => setPasswordConfirm(event.target.value)}
            />
          </label>
          {passwordError && (
            <p className="moss-profile-password-hint">{passwordError}</p>
          )}
          {!passwordError && passwordMismatch && (
            <p className="moss-profile-password-hint">Passwords don&apos;t match.</p>
          )}

          <footer className="moss-profile-password-foot">
            <MossToolbar label="Password setup actions">
              <MossToolbar.Group label="Setup">
                <MossButton variant="quiet" onClick={onClose} disabled={busy}>
                  Cancel
                </MossButton>
                <MossButton
                  busy={busy}
                  disabled={!password || passwordInvalid}
                  onClick={() => void beginRecoveryStep()}
                >
                  Continue
                </MossButton>
              </MossToolbar.Group>
            </MossToolbar>
          </footer>
        </>
      ) : (
        <>
          <p className="moss-profile-password-copy">
            MOSS cannot show them again. This is the only way to reset your password if you forget
            it.
          </p>
          {recoveryPhrase && (
            <p className="moss-setup-recovery-phrase nutrition-mono moss-selectable">
              {recoveryPhrase}
            </p>
          )}
          <MossCheckbox
            label="I saved my recovery phrase somewhere safe"
            checked={recoverySaved}
            disabled={busy}
            onChange={(event) => setRecoverySaved(event.target.checked)}
          />

          <footer className="moss-profile-password-foot">
            <MossToolbar label="Recovery phrase actions">
              <MossToolbar.Group label="Recovery">
                <MossButton
                  variant="quiet"
                  disabled={busy}
                  onClick={() => {
                    setPhase('password')
                    setRecoveryPhrase(null)
                    setRecoverySaved(false)
                    setError(null)
                  }}
                >
                  Back
                </MossButton>
                <MossButton
                  busy={busy}
                  disabled={!recoverySaved}
                  onClick={() => void finishSetup()}
                >
                  Enable password
                </MossButton>
              </MossToolbar.Group>
            </MossToolbar>
          </footer>
        </>
      )}

      {error && (
        <p className="moss-profile-password-error" role="alert">
          {error}
        </p>
      )}
    </MossModal>
  )
}

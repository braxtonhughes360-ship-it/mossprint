import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { DevPerfOverlay } from './components/DevPerfOverlay'
import { AppShell } from './components/AppShell'
import { DashboardPage } from './pages/DashboardPage'
import { ProfilePicker } from './pages/ProfilePicker'
import { useProfile } from './context/ProfileProvider'
import { usePreferences } from './context/PreferencesProvider'

// Route-level code splitting (QA-09): the boot surfaces (profile picker,
// dashboard) stay eager — a lazy chunk on the boot path just adds a
// fetch+parse roundtrip before first paint (measured ~+200ms). Every other
// page loads its chunk on first visit. Chunks come off local disk, so the
// Suspense gap is a frame or two — fallbacks stay quiet (no spinner flash)
// and the boot screen only covers the pre-shell surfaces.
const CalendarPage = lazy(() =>
  import('./pages/CalendarPage').then((m) => ({ default: m.CalendarPage }))
)
const CapturePage = lazy(() =>
  import('./pages/CapturePage').then((m) => ({ default: m.CapturePage }))
)
const InboxPage = lazy(() => import('./pages/InboxPage').then((m) => ({ default: m.InboxPage })))
// Document rebuild (R1): /notes is the Apple-Notes-model workspace again —
// folder rail · note list · the open document. The boards desk is gone.
const NotesPage = lazy(() =>
  import('./pages/NotesPage').then((m) => ({ default: m.NotesPage }))
)
const MoneyPage = lazy(() => import('./pages/MoneyPage').then((m) => ({ default: m.MoneyPage })))
const NutritionPage = lazy(() =>
  import('./pages/NutritionPage').then((m) => ({ default: m.NutritionPage }))
)
const SetupWizard = lazy(() =>
  import('./pages/SetupWizard').then((m) => ({ default: m.SetupWizard }))
)
const ShellPlaceholderPage = lazy(() =>
  import('./pages/ShellPlaceholderPage').then((m) => ({ default: m.ShellPlaceholderPage }))
)

const bootScreen = <div className="moss-boot-screen">Loading…</div>

function AppRoutes(): React.JSX.Element {
  const { phase } = useProfile()
  const { ready: prefsReady, preferences } = usePreferences()
  const location = useLocation()

  // Quick-capture window: its own tiny surface, never the shell or the picker.
  if (location.pathname === '/capture') {
    return (
      <Suspense fallback={null}>
        <CapturePage />
      </Suspense>
    )
  }

  if (phase === 'loading') {
    return bootScreen
  }

  if (phase === 'picker') {
    return (
      <Suspense fallback={bootScreen}>
        <Routes>
          <Route path="/setup" element={<SetupWizard />} />
          <Route path="*" element={<ProfilePicker />} />
        </Routes>
      </Suspense>
    )
  }

  if (phase === 'none') {
    return (
      <Suspense fallback={bootScreen}>
        <Routes>
          <Route path="/setup" element={<SetupWizard />} />
          <Route path="*" element={<Navigate to="/setup" replace />} />
        </Routes>
      </Suspense>
    )
  }

  if (!prefsReady) {
    return bootScreen
  }

  return (
    <Suspense fallback={null}>
      <Routes>
        <Route
          path="/setup"
          element={
            preferences.setup.completedAt &&
            !new URLSearchParams(location.search).has('rerun') ? (
              <Navigate to="/" replace />
            ) : (
              <SetupWizard />
            )
          }
        />

        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="money" element={<MoneyPage />} />
          <Route path="nutrition" element={<NutritionPage />} />
          <Route path="inbox" element={<InboxPage />} />
          <Route path="notes" element={<NotesPage />} />
          <Route path="settings" element={<ShellPlaceholderPage routeId="settings" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  )
}

export default function App(): React.JSX.Element {
  return (
    <>
      <DevPerfOverlay />
      <AppRoutes />
    </>
  )
}

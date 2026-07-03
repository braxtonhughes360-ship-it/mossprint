import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { DevPerfOverlay } from './components/DevPerfOverlay'
import { AppShell } from './components/AppShell'
import { CalendarPage } from './pages/CalendarPage'
import { CapturePage } from './pages/CapturePage'
import { DashboardPage } from './pages/DashboardPage'
import { InboxPage } from './pages/InboxPage'
import { NotesPage } from './pages/NotesPage'
import { MoneyPage } from './pages/MoneyPage'
import { NutritionPage } from './pages/NutritionPage'
import { ProfilePicker } from './pages/ProfilePicker'
import { SetupWizard } from './pages/SetupWizard'
import { ShellPlaceholderPage } from './pages/ShellPlaceholderPage'
import { useProfile } from './context/ProfileProvider'
import { usePreferences } from './context/PreferencesProvider'

function AppRoutes(): React.JSX.Element {
  const { phase } = useProfile()
  const { ready: prefsReady, preferences } = usePreferences()
  const location = useLocation()

  // Quick-capture window: its own tiny surface, never the shell or the picker.
  if (location.pathname === '/capture') {
    return <CapturePage />
  }

  if (phase === 'loading') {
    return <div className="moss-boot-screen">Loading…</div>
  }

  if (phase === 'picker') {
    return (
      <Routes>
        <Route path="/setup" element={<SetupWizard />} />
        <Route path="*" element={<ProfilePicker />} />
      </Routes>
    )
  }

  if (phase === 'none') {
    return (
      <Routes>
        <Route path="/setup" element={<SetupWizard />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    )
  }

  if (!prefsReady) {
    return <div className="moss-boot-screen">Loading…</div>
  }

  return (
    <Routes>
      <Route
        path="/setup"
        element={
          preferences.setup.completedAt ? <Navigate to="/" replace /> : <SetupWizard />
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

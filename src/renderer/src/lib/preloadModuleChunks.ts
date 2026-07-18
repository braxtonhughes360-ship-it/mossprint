/**
 * Warm route chunks after the dashboard paints so the first module click
 * doesn't pay a fetch+parse roundtrip. Mirrors App.tsx lazy() targets.
 */
export function preloadModuleChunks(): void {
  void import('../pages/CalendarPage')
  void import('../pages/MoneyPage')
  void import('../pages/NutritionPage')
  void import('../pages/InboxPage')
  void import('../pages/NotesPage')
  void import('../pages/SettingsPage')
  void import('../pages/SetupWizard')
  void import('../pages/CapturePage')
}

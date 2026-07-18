import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import '@fontsource-variable/jetbrains-mono'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { MotionProvider } from './components/MotionProvider'
import { ProfileProvider } from './context/ProfileProvider'
import { PreferencesProvider } from './context/PreferencesProvider'
import { queryClient } from './queryClient'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ProfileProvider>
          <PreferencesProvider>
            <HashRouter>
              <MotionProvider>
                <App />
              </MotionProvider>
            </HashRouter>
          </PreferencesProvider>
        </ProfileProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>
)

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { ApiError } from './api/client'
import { AppRoutes } from './app-routes'
import { bootstrapLegacyTokenFromUrl } from './auth/bootstrap-legacy-token'
import { AuthProvider } from './auth/session'
import './index.css'

// Must run before BrowserRouter reads the URL, so an old ?token= bookmark never
// shows up in a route or a redirect.
bootstrapLegacyTokenFromUrl()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 4xx answers won't change on retry; a 401 is already redirecting to /login.
      retry: (failureCount, error) =>
        !(error instanceof ApiError && error.status < 500) && failureCount < 1,
      refetchOnWindowFocus: false
    }
  }
})

const container = document.getElementById('root')
if (container) {
  createRoot(container).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>
  )
}

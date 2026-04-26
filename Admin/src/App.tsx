import { Suspense, lazy } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom'
import { Layout } from './components/layout/Layout'
import { useAuthStore } from './stores/authStore'

// Lazy load pages
const LoginPage = lazy(() => import('./app/(auth)/login/page'))
const DashboardPage = lazy(() => import('./app/dashboard/page'))
const StudioPage = lazy(() => import('./app/studio/page'))
const ProjectsPage = lazy(() => import('./app/projects/page'))
const ProjectDetailsPage = lazy(() => import('./app/projects/details/page'))
const UsersPage = lazy(() => import('./app/users/page'))
const UserDetailsPage = lazy(() => import('./app/users/details/page'))
const CreditsPage = lazy(() => import('./app/credits/page'))
const PaymentsPage = lazy(() => import('./app/payments/page'))
const ObservabilityPage = lazy(() => import('./app/observability/page'))
const SettingsPage = lazy(() => import('./app/settings/page'))

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center h-screen bg-bg-primary">
      <div className="text-center">
        <div className="h-12 w-12 rounded-lg bg-gradient-to-br from-accent-primary to-accent-secondary animate-pulse mx-auto mb-4" />
        <p className="text-text-secondary">Chargement…</p>
      </div>
    </div>
  )
}

function RequireAuth() {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn)
  const mustChangePassword = useAuthStore((s) => !!s.user?.must_change_password)
  const location = useLocation()
  if (!isLoggedIn) return <Navigate to="/login" replace />
  if (mustChangePassword && location.pathname !== '/settings') return <Navigate to="/settings" replace />
  return <Outlet />
}

export default function App() {
  return (
    <Router>
      <Suspense fallback={<LoadingFallback />}>
        <Routes>
          {/* Public */}
          <Route path="/login" element={<LoginPage />} />

          {/* Private */}
          <Route element={<RequireAuth />}>
            <Route element={<Layout />}>
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="dashboard" element={<DashboardPage />} />
              <Route path="studio" element={<StudioPage />} />
              <Route path="projects" element={<ProjectsPage />} />
              <Route path="projects/:projectId" element={<ProjectDetailsPage />} />
              <Route path="users" element={<UsersPage />} />
              <Route path="users/:userId" element={<UserDetailsPage />} />
              <Route path="credits" element={<CreditsPage />} />
              <Route path="payments" element={<PaymentsPage />} />
              <Route path="observability" element={<ObservabilityPage />} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Suspense>
    </Router>
  )
}

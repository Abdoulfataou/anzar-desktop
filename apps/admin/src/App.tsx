import { Suspense, lazy } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom'
import { Toaster } from 'sonner'
import { Layout } from './components/layout/Layout'
import { useAuthStore } from './stores/authStore'
import type { Role } from './api/backend'

const LoginPage = lazy(() => import('./app/(auth)/login/page'))
const DashboardPage = lazy(() => import('./app/dashboard/page'))
const UsersPage = lazy(() => import('./app/users/page'))
const UserDetailsPage = lazy(() => import('./app/users/details/page'))
const CreditsPage = lazy(() => import('./app/credits/page'))
const PaymentsPage = lazy(() => import('./app/payments/page'))
const UsagePage = lazy(() => import('./app/usage/page'))
const AuditPage = lazy(() => import('./app/audit/page'))
const AdminsPage = lazy(() => import('./app/admins/page'))
const SettingsPage = lazy(() => import('./app/settings/page'))

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-accent-primary to-accent-secondary animate-pulse" />
    </div>
  )
}

function RequireAuth() {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn)
  const mustChangePassword = useAuthStore((s) => !!s.user?.must_change_password)
  const location = useLocation()
  if (!isLoggedIn) return <Navigate to="/login" replace />
  if (mustChangePassword && location.pathname !== '/settings') return <Navigate to="/settings?tab=security" replace />
  return <Outlet />
}

/** Page réservée à certains rôles (le serveur vérifie aussi : ceci évite juste une page vide). */
function RequireRole({ roles }: { roles: Role[] }) {
  const role = useAuthStore((s) => s.user?.role)
  if (!role || !roles.includes(role)) return <Navigate to="/dashboard" replace />
  return <Outlet />
}

export default function App() {
  return (
    <Router>
      <Toaster theme="dark" position="top-right" richColors closeButton />
      <Suspense fallback={<LoadingFallback />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<RequireAuth />}>
            <Route element={<Layout />}>
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="dashboard" element={<DashboardPage />} />
              <Route path="users" element={<UsersPage />} />
              <Route path="users/:userId" element={<UserDetailsPage />} />
              <Route path="credits" element={<CreditsPage />} />
              <Route path="payments" element={<PaymentsPage />} />
              <Route path="usage" element={<UsagePage />} />
              <Route element={<RequireRole roles={['owner', 'admin']} />}>
                <Route path="audit" element={<AuditPage />} />
              </Route>
              <Route element={<RequireRole roles={['owner']} />}>
                <Route path="admins" element={<AdminsPage />} />
              </Route>
              <Route path="settings" element={<SettingsPage />} />
              {/* anciennes adresses */}
              <Route path="observability" element={<Navigate to="/usage" replace />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Suspense>
    </Router>
  )
}

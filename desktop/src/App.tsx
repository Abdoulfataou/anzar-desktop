/**
 * ANZAR - Composant racine
 * Interface unifiée: Vue principale (chat + projets) | Workspace | Paramètres
 * Auth guard: redirige vers /login si non authentifié
 */
import React, { lazy, Suspense, useEffect, useState } from 'react';
import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import AppLayout from '@/components/layout/AppLayout';
import ErrorBoundary from '@/components/ErrorBoundary';
import { useAccountStore } from '@/stores/accountStore';
import { authService } from '@/services/infra/auth';
import { autoCheckOncePerDay } from '@/services/infra/updateService';

// Lazy-load des pages
const ChatPage = lazy(() => import('@/pages/ChatPage'));
const ProjectWorkspacePage = lazy(() => import('@/pages/ProjectWorkspacePage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));
const LoginPage = lazy(() => import('@/pages/LoginPage'));

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center h-full min-h-[200px] bg-bg-primary">
      <div className="text-center space-y-4">
        <div className="w-12 h-12 mx-auto rounded-2xl gradient-bg flex items-center justify-center shadow-lg animate-pulse">
          <span className="text-white text-lg font-bold">A</span>
        </div>
        <Loader2 className="w-5 h-5 text-accent-primary animate-spin mx-auto" />
        <p className="text-xs text-text-muted">Chargement...</p>
      </div>
    </div>
  );
}

/** Auth guard — redirects to /login if not logged in */
function RequireAuth() {
  const isLoggedIn = useAccountStore((s) => s.isLoggedIn);
  if (!isLoggedIn) return <Navigate to="/login" replace />;
  return <Outlet />;
}

export default function App() {
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await authService.bootstrapSession();
      } finally {
        if (alive) setBooting(false);
      }
    })();
    // Non-bloquant: check update (Tauri) max 1/jour
    void autoCheckOncePerDay();
    return () => {
      alive = false;
    };
  }, []);

  if (booting) return <LoadingFallback />;

  return (
    <ErrorBoundary>
      <Suspense fallback={<LoadingFallback />}>
        <Routes>
          {/* Public route */}
          <Route path="login" element={<LoginPage />} />

          {/* Protected routes */}
          <Route element={<RequireAuth />}>
            <Route element={<AppLayout />}>
              {/* Vue principale unifiée (chat + accueil) */}
              <Route index element={<ChatPage />} />

              {/* Workspace projet (éditeur + chat contextuel) */}
              <Route path="projects/:id" element={<ProjectWorkspacePage />} />

              {/* Paramètres */}
              <Route path="settings" element={<SettingsPage />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}

/**
 * ANZAR - Composant racine
 * Interface unifiée: Vue principale (chat + projets) | Workspace | Paramètres
 * Auth guard: redirige vers /login si non authentifié
 */
import React, { lazy, Suspense, useEffect, useState } from 'react';
import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import AppLayout from '@/components/layout/AppLayout';
import { useAccountStore } from '@/stores/accountStore';
import { authService } from '@/services/auth';

// Lazy-load des pages
const ChatPage = lazy(() => import('@/pages/ChatPage'));
const ProjectWorkspacePage = lazy(() => import('@/pages/ProjectWorkspacePage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));
const LoginPage = lazy(() => import('@/pages/LoginPage'));

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center h-full min-h-[200px]">
      <Loader2 className="w-6 h-6 text-accent-primary animate-spin" />
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
    return () => {
      alive = false;
    };
  }, []);

  if (booting) return <LoadingFallback />;

  return (
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
  );
}

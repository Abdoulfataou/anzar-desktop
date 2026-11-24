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
import { startUpdateWatcher } from '@/services/infra/updateService';
import { useChatStore } from '@/stores/chatStore';
import { useProjectStore } from '@/stores/projectStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useThemeStore } from '@/stores/themeStore';
import { pullCommandPolicy } from '@/services/runtime/commandPolicy';

/** L'historique est lu sur le disque (asynchrone) : on attend qu'il soit chargé avant d'afficher l'app. */
function storesHydrated(): Promise<void> {
  const wait = (store: { persist: { hasHydrated: () => boolean; onFinishHydration: (fn: () => void) => () => void } }) =>
    store.persist.hasHydrated() ? Promise.resolve() : new Promise<void>((resolve) => store.persist.onFinishHydration(() => resolve()));
  const all = Promise.all([
    wait(useChatStore),
    wait(useProjectStore),
    // Indispensable avant l'auth : la clé de coffre historique et l'URL du
    // backend sont lues dans les réglages persistés.
    wait(useSettingsStore),
  ]).then(() => undefined);
  // Garde-fou : on n'attend jamais plus de 6 s
  return Promise.race([all, new Promise<void>((resolve) => setTimeout(resolve, 6000))]);
}

// Lazy-load des pages
const ChatPage = lazy(() => import('@/pages/ChatPage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));
const SkillsPage = lazy(() => import('@/pages/SkillsPage'));
const ConnectorsPage = lazy(() => import('@/pages/ConnectorsPage'));
const TicketsPage = lazy(() => import('@/pages/TicketsPage'));
const AutomationsPage = lazy(() => import('@/pages/AutomationsPage'));
const LoginPage = lazy(() => import('@/pages/LoginPage'));
const WelcomePage = lazy(() => import('@/pages/WelcomePage'));

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

/** Auth guard — renvoie vers l'accueil prompt-first (idée d'abord, login ensuite) */
function RequireAuth() {
  const isLoggedIn = useAccountStore((s) => s.isLoggedIn);
  if (!isLoggedIn) return <Navigate to="/welcome" replace />;
  return <Outlet />;
}

export default function App() {
  const [booting, setBooting] = useState(true);
  const fontSize = useSettingsStore((s) => s.settings.fontSize);

  // La taille de texte est un réglage persisté : on l'applique au DOM.
  useEffect(() => {
    const n = Math.min(18, Math.max(11, Number(fontSize) || 14));
    document.documentElement.style.setProperty('--ui-font-size', `${n}px`);
  }, [fontSize]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // L'hydratation d'abord : la restauration de session lit les réglages
        // (URL backend, ancienne clé de coffre) et ne doit pas travailler sur
        // les valeurs par défaut.
        await storesHydrated();
        // Les réglages sont hydratés : on réapplique le thème persisté au DOM.
        useThemeStore.getState().initializeTheme();
        // Réglages de sécurité des commandes : la référence est côté Rust.
        await pullCommandPolicy();
        await authService.bootstrapSession();
      } finally {
        if (alive) setBooting(false);
      }
    })();
    // Mises à jour : au lancement puis toutes les 6 h ; affichées dans le bandeau de l'app
    const stopUpdates = startUpdateWatcher();
    return () => {
      alive = false;
      stopUpdates();
    };
  }, []);

  if (booting) return <LoadingFallback />;

  return (
    <ErrorBoundary>
      <Suspense fallback={<LoadingFallback />}>
        <Routes>
          {/* Public routes — accueil prompt-first (idée saisie avant auth) + login */}
          <Route path="welcome" element={<WelcomePage />} />
          <Route path="login" element={<LoginPage />} />

          {/* Protected routes */}
          <Route element={<RequireAuth />}>
            <Route element={<AppLayout />}>
              {/* Vue principale unifiée (chat + accueil) */}
              <Route index element={<ChatPage />} />

              {/* Projet → redirige vers le chat (le Studio s'ouvre depuis ChatView) */}
              <Route path="projects/:id" element={<ChatPage />} />

              {/* Paramètres */}
              <Route path="settings" element={<SettingsPage />} />
              <Route path="skills" element={<SkillsPage />} />
              <Route path="connectors" element={<ConnectorsPage />} />
              <Route path="tickets" element={<TicketsPage />} />
              <Route path="automations" element={<AutomationsPage />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}

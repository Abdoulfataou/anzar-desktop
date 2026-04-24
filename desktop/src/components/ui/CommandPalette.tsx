/**
 * CommandPalette - Palette de commandes (Ctrl+K / Cmd+K)
 * Navigation rapide et actions depuis le clavier
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  MessageSquare,
  Settings,
  Plus,
  Sun,
  Moon,
  Zap,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useThemeStore } from '@/stores/themeStore';

interface CommandItem {
  id: string;
  label: string;
  description?: string;
  icon: React.ElementType;
  shortcut?: string;
  action: () => void;
  category: string;
}

export default function CommandPalette() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { theme, toggleTheme } = useThemeStore();

  const commands: CommandItem[] = useMemo(() => [
    // Actions
    {
      id: 'new-task',
      label: 'Nouvelle tâche',
      description: 'Démarrer une nouvelle conversation',
      icon: Plus,
      shortcut: '⌘N',
      action: () => { navigate('/'); setIsOpen(false); },
      category: 'Actions',
    },
    {
      id: 'nav-home',
      label: 'Accueil',
      description: 'Retour à la vue principale',
      icon: MessageSquare,
      shortcut: '⌘1',
      action: () => { navigate('/'); setIsOpen(false); },
      category: 'Navigation',
    },
    {
      id: 'nav-settings',
      label: 'Paramètres',
      description: 'Compte, IA, interface',
      icon: Settings,
      shortcut: '⌘,',
      action: () => { navigate('/settings'); setIsOpen(false); },
      category: 'Navigation',
    },
    {
      id: 'toggle-theme',
      label: theme === 'dark' ? 'Activer le mode clair' : 'Activer le mode sombre',
      description: 'Changer le thème de l\'interface',
      icon: theme === 'dark' ? Sun : Moon,
      action: () => { toggleTheme(); setIsOpen(false); },
      category: 'Actions',
    },
    // AI
    {
      id: 'model-fast',
      label: 'Mode Rapide',
      description: 'Réponses rapides et efficaces',
      icon: Zap,
      action: () => setIsOpen(false),
      category: 'Modèle IA',
    },
    {
      id: 'model-thinking',
      label: 'Mode Réflexion',
      description: 'Raisonnement avancé et détaillé',
      icon: Sparkles,
      action: () => setIsOpen(false),
      category: 'Modèle IA',
    },
  ], [navigate, theme, toggleTheme]);

  const filteredCommands = useMemo(() => {
    if (!query) return commands;
    const q = query.toLowerCase();
    return commands.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(q) ||
        cmd.description?.toLowerCase().includes(q) ||
        cmd.category.toLowerCase().includes(q)
    );
  }, [commands, query]);

  const groupedCommands = useMemo(() => {
    const groups: Record<string, CommandItem[]> = {};
    filteredCommands.forEach((cmd) => {
      if (!groups[cmd.category]) groups[cmd.category] = [];
      groups[cmd.category].push(cmd);
    });
    return groups;
  }, [filteredCommands]);

  // Keyboard handler
  const handleGlobalKeyDown = useCallback((e: KeyboardEvent) => {
    // Open: Cmd+K or Ctrl+K
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      setIsOpen((prev) => !prev);
      setQuery('');
      setSelectedIndex(0);
    }

    // Navigation shortcuts
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey) {
      switch (e.key) {
        case '1': e.preventDefault(); navigate('/'); break;
        case ',': e.preventDefault(); navigate('/settings'); break;
      }
    }

    // Close on Escape
    if (e.key === 'Escape' && isOpen) {
      setIsOpen(false);
    }
  }, [isOpen, navigate]);

  useEffect(() => {
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [handleGlobalKeyDown]);

  // Focus input when open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Arrow key navigation in palette
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, filteredCommands.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      filteredCommands[selectedIndex]?.action();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => setIsOpen(false)}
      />

      {/* Palette */}
      <div className="relative w-full max-w-lg mx-4 animate-scale-in">
        <div className="rounded-xl border border-border-medium bg-bg-secondary/95 backdrop-blur-xl shadow-2xl overflow-hidden">
          {/* Search input */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border-subtle">
            <Search size={18} className="text-text-tertiary flex-shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
              onKeyDown={handleKeyDown}
              placeholder="Rechercher une commande..."
              className="flex-1 bg-transparent text-text-primary placeholder:text-text-muted outline-none text-sm"
            />
            <span className="kbd">ESC</span>
          </div>

          {/* Commands */}
          <div className="max-h-80 overflow-y-auto py-2">
            {filteredCommands.length === 0 ? (
              <div className="px-4 py-8 text-center text-text-muted text-sm">
                Aucun résultat pour "{query}"
              </div>
            ) : (
              Object.entries(groupedCommands).map(([category, items]) => (
                <div key={category}>
                  <div className="px-4 py-1.5 text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                    {category}
                  </div>
                  {items.map((cmd) => {
                    const globalIdx = filteredCommands.indexOf(cmd);
                    const Icon = cmd.icon;
                    return (
                      <button
                        key={cmd.id}
                        onClick={cmd.action}
                        onMouseEnter={() => setSelectedIndex(globalIdx)}
                        className={cn(
                          'w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors',
                          globalIdx === selectedIndex
                            ? 'bg-accent-primary/10 text-text-primary'
                            : 'text-text-secondary hover:bg-surface-hover'
                        )}
                      >
                        <div className={cn(
                          'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
                          globalIdx === selectedIndex
                            ? 'bg-accent-primary/20 text-accent-primary'
                            : 'bg-bg-tertiary text-text-tertiary'
                        )}>
                          <Icon size={16} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{cmd.label}</div>
                          {cmd.description && (
                            <div className="text-xs text-text-muted truncate">{cmd.description}</div>
                          )}
                        </div>
                        {cmd.shortcut && (
                          <span className="kbd flex-shrink-0">{cmd.shortcut}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center gap-4 px-4 py-2.5 border-t border-border-subtle text-[11px] text-text-muted">
            <span className="flex items-center gap-1"><span className="kbd">↑↓</span> naviguer</span>
            <span className="flex items-center gap-1"><span className="kbd">↵</span> sélectionner</span>
            <span className="flex items-center gap-1"><span className="kbd">ESC</span> fermer</span>
          </div>
        </div>
      </div>
    </div>
  );
}
/**
 * StudioSkills — Catalogue de skills prédéfinis et custom pour le VibeCoding Studio.
 *
 * Inspiré de TRAE SOLO qui propose des skills builtin + gérés par l'utilisateur
 * pour accélérer les itérations courantes.
 *
 * Chaque skill encapsule:
 *  - Un prompt template optimisé
 *  - Le mode CoderAgent optimal (iterate, refactor, patch, etc.)
 *  - Une catégorie et une icône
 *  - Des variables substituables ({{file}}, {{project}})
 */

import type { IterationMode } from './iterationRouter';

// ============================================================================
// TYPES
// ============================================================================

export type SkillCategory = 'ui' | 'perf' | 'quality' | 'feature' | 'fix' | 'test' | 'custom';

export interface StudioSkill {
  id: string;
  name: string;
  description: string;
  /** The prompt template sent to the AI */
  prompt: string;
  /** Optimal CoderAgent mode */
  mode: IterationMode;
  /** Category for filtering */
  category: SkillCategory;
  /** Emoji icon */
  icon: string;
  /** Whether this is a builtin skill (vs user-created) */
  builtin: boolean;
  /** Keyboard shortcut (optional) */
  shortcut?: string;
}

// ============================================================================
// BUILTIN SKILLS
// ============================================================================

const BUILTIN_SKILLS: StudioSkill[] = [
  // ── UI ──
  {
    id: 'dark-mode',
    name: 'Mode Sombre',
    description: 'Ajouter le support dark/light mode avec toggle',
    prompt: 'Ajoute un mode sombre (dark mode) complet au projet. Crée un système de thème avec toggle dark/light qui persiste dans localStorage. Utilise des CSS variables pour les couleurs. Ajoute un bouton toggle dans le header/navbar.',
    mode: 'iterate',
    category: 'ui',
    icon: '🌙',
    builtin: true,
  },
  {
    id: 'responsive',
    name: 'Responsive Mobile',
    description: 'Rendre toutes les pages responsive mobile-first',
    prompt: 'Rends le projet entièrement responsive mobile-first. Adapte tous les layouts pour mobile (< 768px), tablette (768-1024px) et desktop (> 1024px). Utilise des media queries ou des utilitaires CSS. Vérifie la navigation, les grilles, les formulaires et les tableaux.',
    mode: 'refactor',
    category: 'ui',
    icon: '📱',
    builtin: true,
  },
  {
    id: 'animations',
    name: 'Animations',
    description: 'Ajouter des animations subtiles aux interactions',
    prompt: 'Ajoute des micro-animations subtiles et professionnelles : transitions de page (fade-in), hover effects sur les boutons et cartes, animations d\'entrée pour les éléments (stagger), loading skeletons. Utilise CSS transitions/animations ou Framer Motion si React.',
    mode: 'iterate',
    category: 'ui',
    icon: '✨',
    builtin: true,
  },
  {
    id: 'accessibility',
    name: 'Accessibilité',
    description: 'Améliorer l\'accessibilité (a11y) du projet',
    prompt: 'Améliore l\'accessibilité du projet : ajoute les attributs ARIA manquants, assure le contraste des couleurs (WCAG AA), rends tous les éléments interactifs accessibles au clavier (focus visible, tabindex), ajoute des labels aux formulaires, et des alt text aux images.',
    mode: 'refactor',
    category: 'ui',
    icon: '♿',
    builtin: true,
  },

  // ── Performance ──
  {
    id: 'optimize-perf',
    name: 'Optimiser Perf',
    description: 'Optimiser les performances (lazy load, memo, code split)',
    prompt: 'Optimise les performances du projet : ajoute du lazy loading pour les composants lourds et les images, utilise React.memo/useMemo/useCallback pour éviter les re-renders inutiles, implémente le code splitting avec dynamic imports, et optimise les re-renders des listes.',
    mode: 'refactor',
    category: 'perf',
    icon: '⚡',
    builtin: true,
  },
  {
    id: 'caching',
    name: 'Cache & Storage',
    description: 'Ajouter du caching intelligent (localStorage, IndexedDB)',
    prompt: 'Ajoute un système de caching intelligent : cache les appels API avec une stratégie stale-while-revalidate, utilise localStorage pour les préférences utilisateur, et ajoute un service worker basique pour le cache des assets statiques.',
    mode: 'iterate',
    category: 'perf',
    icon: '💾',
    builtin: true,
  },

  // ── Quality ──
  {
    id: 'error-handling',
    name: 'Gestion d\'Erreurs',
    description: 'Ajouter try/catch, error boundaries, fallbacks',
    prompt: 'Améliore la gestion d\'erreurs dans tout le projet : ajoute des try/catch autour des appels API et opérations async, crée un Error Boundary React global avec un fallback élégant, ajoute des états d\'erreur dans les composants, et affiche des messages d\'erreur user-friendly.',
    mode: 'refactor',
    category: 'quality',
    icon: '🛡️',
    builtin: true,
  },
  {
    id: 'typescript-strict',
    name: 'TypeScript Strict',
    description: 'Renforcer le typage TypeScript (any → types stricts)',
    prompt: 'Renforce le typage TypeScript dans tout le projet : remplace tous les `any` par des types stricts, ajoute des interfaces pour les props de composants, type les réponses API, et ajoute des types utilitaires (Pick, Omit, Partial) où pertinent. Active strict mode.',
    mode: 'refactor',
    category: 'quality',
    icon: '🔒',
    builtin: true,
  },
  {
    id: 'clean-code',
    name: 'Clean Code',
    description: 'Nettoyer le code (DRY, nommage, structure)',
    prompt: 'Nettoie le code du projet : élimine la duplication (DRY), améliore le nommage des variables et fonctions, extrait les constantes magiques, simplifie les conditions complexes, et réorganise les imports. Garde la même fonctionnalité.',
    mode: 'refactor',
    category: 'quality',
    icon: '🧹',
    builtin: true,
  },

  // ── Features ──
  {
    id: 'seo',
    name: 'SEO',
    description: 'Ajouter les meta tags, sitemap, et optimisations SEO',
    prompt: 'Ajoute les optimisations SEO au projet : meta tags (title, description, og:image, twitter:card), balises sémantiques HTML5 (header, main, nav, article), attributs alt sur les images, sitemap.xml, robots.txt, et structured data (JSON-LD) pour la page d\'accueil.',
    mode: 'iterate',
    category: 'feature',
    icon: '🔍',
    builtin: true,
  },
  {
    id: 'i18n',
    name: 'Internationalisation',
    description: 'Préparer le projet pour le multi-langue',
    prompt: 'Prépare le projet pour l\'internationalisation (i18n) : extrais toutes les chaînes de caractères hardcodées dans un fichier de traduction (JSON), crée un hook/service useTranslation, ajoute un sélecteur de langue dans le header, et crée les fichiers de traduction FR et EN.',
    mode: 'iterate',
    category: 'feature',
    icon: '🌍',
    builtin: true,
  },
  {
    id: 'auth',
    name: 'Authentification',
    description: 'Ajouter un système d\'auth basique (login/register)',
    prompt: 'Ajoute un système d\'authentification basique : page de login avec email/password, page de register, stockage du token JWT, protection des routes privées, et un composant AuthGuard. Utilise un contexte/store pour l\'état d\'authentification.',
    mode: 'iterate',
    category: 'feature',
    icon: '🔐',
    builtin: true,
  },
  {
    id: 'contact-form',
    name: 'Formulaire Contact',
    description: 'Ajouter un formulaire de contact avec validation',
    prompt: 'Ajoute un formulaire de contact professionnel : champs nom, email, sujet, message avec validation côté client (required, email format, longueur min/max), feedback visuel des erreurs, état de soumission (loading, success, error), et design responsive.',
    mode: 'iterate',
    category: 'feature',
    icon: '📧',
    builtin: true,
  },

  // ── Fix ──
  {
    id: 'fix-all-errors',
    name: 'Corriger Toutes les Erreurs',
    description: 'Corriger toutes les erreurs TypeScript/ESLint',
    prompt: 'Corrige TOUTES les erreurs TypeScript et ESLint dans le projet. Vérifie chaque fichier et corrige les types manquants, les imports cassés, les variables non utilisées, et les problèmes de syntaxe.',
    mode: 'debug',
    category: 'fix',
    icon: '🐛',
    builtin: true,
  },
  {
    id: 'fix-imports',
    name: 'Corriger les Imports',
    description: 'Nettoyer et corriger tous les imports',
    prompt: 'Nettoie tous les imports du projet : supprime les imports inutilisés, corrige les chemins cassés, trie les imports par catégorie (libs externes, puis internes), et ajoute les imports manquants.',
    mode: 'patch',
    category: 'fix',
    icon: '📦',
    builtin: true,
  },

  // ── Test ──
  {
    id: 'unit-tests',
    name: 'Tests Unitaires',
    description: 'Générer des tests unitaires pour les composants clés',
    prompt: 'Génère des tests unitaires pour les composants et fonctions clés du projet. Utilise Jest/Vitest avec React Testing Library. Couvre les cas nominaux, les edge cases, et les états d\'erreur. Cible une couverture de 80%.',
    mode: 'test',
    category: 'test',
    icon: '🧪',
    builtin: true,
  },
];

// ============================================================================
// SERVICE
// ============================================================================

class StudioSkillsService {
  private customSkills: StudioSkill[] = [];

  /**
   * Get all available skills (builtin + custom).
   */
  getAll(): StudioSkill[] {
    return [...BUILTIN_SKILLS, ...this.customSkills];
  }

  /**
   * Get skills filtered by category.
   */
  getByCategory(category: SkillCategory): StudioSkill[] {
    return this.getAll().filter(s => s.category === category);
  }

  /**
   * Get a skill by ID.
   */
  getById(id: string): StudioSkill | undefined {
    return this.getAll().find(s => s.id === id);
  }

  /**
   * Get all categories with their labels.
   */
  getCategories(): Array<{ id: SkillCategory; label: string; icon: string }> {
    return [
      { id: 'ui', label: 'Interface', icon: '🎨' },
      { id: 'perf', label: 'Performance', icon: '⚡' },
      { id: 'quality', label: 'Qualité', icon: '✅' },
      { id: 'feature', label: 'Features', icon: '🚀' },
      { id: 'fix', label: 'Corrections', icon: '🔧' },
      { id: 'test', label: 'Tests', icon: '🧪' },
      { id: 'custom', label: 'Custom', icon: '⭐' },
    ];
  }

  /**
   * Add a custom skill.
   */
  addCustomSkill(skill: Omit<StudioSkill, 'id' | 'builtin'>): string {
    const id = `custom-${Date.now()}`;
    this.customSkills.push({ ...skill, id, builtin: false });
    this.saveCustomSkills();
    return id;
  }

  /**
   * Remove a custom skill.
   */
  removeCustomSkill(id: string): boolean {
    const idx = this.customSkills.findIndex(s => s.id === id);
    if (idx === -1) return false;
    this.customSkills.splice(idx, 1);
    this.saveCustomSkills();
    return true;
  }

  /**
   * Resolve a skill's prompt with variables.
   */
  resolvePrompt(skill: StudioSkill, vars?: { file?: string; project?: string }): string {
    let prompt = skill.prompt;
    if (vars?.file) prompt = prompt.replace(/\{\{file\}\}/g, vars.file);
    if (vars?.project) prompt = prompt.replace(/\{\{project\}\}/g, vars.project);
    return prompt;
  }

  /**
   * Load custom skills from localStorage.
   */
  loadCustomSkills(): void {
    try {
      const stored = localStorage.getItem('anzar-studio-custom-skills');
      if (stored) {
        this.customSkills = JSON.parse(stored);
      }
    } catch {
      // ignore
    }
  }

  /**
   * Save custom skills to localStorage.
   */
  private saveCustomSkills(): void {
    try {
      localStorage.setItem('anzar-studio-custom-skills', JSON.stringify(this.customSkills));
    } catch {
      // ignore
    }
  }
}

export const studioSkills = new StudioSkillsService();

// Load custom skills on import
studioSkills.loadCustomSkills();

# 🚨 PROMPT POUR CLINE : FIX PROFIL INVISIBLE

## ❌ PROBLÈME
Le profil utilisateur en bas à gauche (avatar "JD") est **INVISIBLE** dans l'application ANZAR. L'utilisateur ne voit pas le bouton de profil avant de cliquer.

## 📍 CONTEXTE TECHNIQUE
- **Framework** : Tauri + React + TypeScript + Tailwind CSS
- **Layout principal** : `CoworkLayout.tsx` (layout trois panneaux)
- **Composant profil** : `SidebarFooter.tsx`
- **État actuel** : Le profil est rendu mais invisible à l'écran

## 🔍 DIAGNOSTIC
Le problème vient probablement de :
1. **Classes CSS cachantes** (`hidden`, `opacity-0`, `overflow-hidden`)
2. **Positionnement incorrect** (z-index, absolute/relative)
3. **Conditions de rendu** qui cachent le composant
4. **Problème de flexbox** (shrink, grow, flex)

## 📁 FICHIERS À INSPECTER
1. `/src/components/layout/CoworkLayout.tsx` - Layout principal
2. `/src/components/layout/SidebarFooter.tsx` - Composant profil
3. `/src/components/layout/IconSidebar.tsx` - Sidebar iconique
4. `/src/App.tsx` - Routes et wrappers

## 🎯 EXIGENCES FIX
Le profil doit être **TOUJOURS VISIBLE** dans ces scénarios :
- ✅ Sur la page chat (`/`)
- ✅ Sur la page fichiers (`/files`)
- ✅ Sur la page paramètres (`/settings`)
- ✅ Quand la sidebar est ouverte (`w-64`)
- ✅ Quand la sidebar est réduite (`w-16`)
- ✅ Sur desktop (≥ 768px)
- ✅ Sur mobile (< 768px) - version alternative

## 🛠️ CORRECTIONS À APPLIQUER

### 1. **SUPPRIMER TOUTES LES CLASSES QUI CACHENT**
```tsx
// À SUPPRIMER :
- hidden (md:flex, lg:hidden, etc.)
- opacity-0
- overflow-hidden (sauf si nécessaire)
- w-0 (jamais réduire à 0)
```

### 2. **GARANTIR LA VISIBILITÉ DU CONTENEUR**
```tsx
// Sidebar gauche DOIT avoir :
className="h-full flex flex-col bg-[var(--anzar-surface)] border-r border-[var(--anzar-border)] overflow-visible"

// Footer DOIT être :
<div className="mt-auto shrink-0">
  <SidebarFooter collapsed={!leftSidebarOpen} />
</div>
```

### 3. **SIDEBARFOOTER - STRUCTURE SIMPLIFIÉE**
```tsx
// AVOIR :
- Pas de `hidden md:flex` dans le conteneur principal
- Avatar avec couleurs VIVES (débogage : jaune + bordure rouge)
- Menu qui s'ouvre VERS LE HAUT (bottom-full)
- Z-index élevé (z-[9999])
```

### 4. **NAVIGATION CORRECTE**
```tsx
// TOUTES les routes `/chat` doivent être `/`
- handleNewChat() → navigate('/')
- location.pathname === '/' (pas '/chat')
```

## 🧪 TESTS À EFFECTUER
1. **Build TypeScript** : `npm run build` (doit réussir)
2. **Vérifier console** : `console.log('SidebarFooter rendered')` doit apparaître
3. **Inspecter éléments** : Avatar doit avoir dimensions visibles (w-9 h-9)
4. **Cliquer** : Menu doit s'ouvrir VERS LE HAUT

## 🎨 STYLE FINAL (après débogage)
```tsx
// Avatar final (après confirmation de visibilité) :
<div className="w-9 h-9 rounded-full bg-gradient-to-br from-[var(--anzar-accent)] to-[var(--anzar-accent-light)] flex items-center justify-center text-white text-sm font-bold ring-2 ring-[var(--anzar-border)] ring-offset-2 ring-offset-[var(--anzar-bg)] shadow-lg shadow-[var(--anzar-accent)]/20">
  JD
  <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 border-2 border-[var(--anzar-bg)] rounded-full" />
</div>
```

## 📝 INSTRUCTIONS POUR CLINE
1. **Examine tous les fichiers listés**
2. **Cherche les classes `hidden`, `opacity-0`, `w-0`**
3. **Vérifie les conditions de rendu** (`{leftSidebarOpen && ...}`)
4. **Assure-toi que le `SidebarFooter` est TOUJOURS dans le DOM**
5. **Teste avec des couleurs VIVES d'abord** (jaune/rouge)
6. **Une fois visible, restaure les couleurs ANZAR**
7. **Vérifie la navigation** (toutes les routes `/` pas `/chat`)

## 🚨 URGENCE
L'utilisateur ne peut pas accéder à son profil. C'est un bug CRITIQUE qui bloque l'utilisation de l'application. Priorité MAXIMALE.
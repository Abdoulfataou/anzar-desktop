# ISSALAN Admin Desktop

Interface d'administration desktop pour ISSALAN, l'agent IA multi-agent pour l'Afrique.

## 🚀 Fonctionnalités

### 1. Tableau de bord (Dashboard)
- Cartes de métriques: utilisateurs, projets actifs, revenus, taux conversion
- Graphique des activités (derniers 7 jours)
- Dernières actions (logs récents)
- Alertes système (stockage, API, etc.)

### 2. Gestion des utilisateurs
- Liste des utilisateurs (nom, email, pays, date inscription, statut)
- Recherche et filtres (par pays, statut, date)
- Modifier/suspendre/supprimer un utilisateur
- Voir le détail d'un utilisateur (ses projets, son usage API)

### 3. Gestion des projets
- Liste des projets générés par l'agent
- Filtres par utilisateur, date, statut
- Voir le code généré
- Forcer une régénération ou annulation

### 4. Analytique
- Graphiques: utilisation API (DeepSeek), coûts, projets par pays
- Top 10 utilisateurs les plus actifs
- Période sélectionnable (7j, 30j, 90j)

### 5. Configuration système
- Clé API DeepSeek (masquée, modifiable)
- Limites par défaut (projets gratuits, etc.)
- Paramètres offline (taille max queue, etc.)
- Langue (français/anglais)

### 6. Logs système
- Console en temps réel des actions agents
- Niveaux: INFO, WARNING, ERROR
- Export logs (CSV/JSON)

## 🛠️ Technologies

- **Framework**: Tauri (Rust + React + TypeScript)
- **UI**: shadcn/ui + Tailwind CSS
- **Base de données**: SQLite (via Tauri plugin)
- **Graphiques**: Recharts
- **Icônes**: Lucide React
- **Routing**: React Router DOM
- **Notifications**: Sonner

## 📦 Installation

### Prérequis

- Node.js 18+ et npm
- Rust et Cargo (pour Tauri)
- SQLite

### Installation

1. Cloner le projet :
```bash
cd "/Users/agahmadou/Desktop/ISSALAN/Admin Desktop"
```

2. Installer les dépendances :
```bash
npm install
```

3. Installer Tauri CLI :
```bash
npm install @tauri-apps/cli
```

4. Démarrer en mode développement :
```bash
npm run tauri dev
```

### Commandes disponibles

- `npm run dev` : Démarrer le serveur de développement Vite
- `npm run build` : Construire l'application pour la production
- `npm run tauri dev` : Démarrer Tauri en mode développement
- `npm run tauri build` : Construire l'application desktop

## 🏗️ Architecture

### Structure des fichiers

```
Admin Desktop/
├── src/
│   ├── components/     # Composants React réutilisables
│   ├── pages/         # Pages de l'application
│   ├── api/           # API et services
│   ├── stores/        # State management
│   ├── types/         # Types TypeScript
│   ├── lib/           # Utilitaires
│   └── utils/         # Fonctions utilitaires
├── src-tauri/         # Code Rust pour Tauri
│   ├── src/           # Code source Rust
│   ├── Cargo.toml     # Configuration Rust
│   └── tauri.conf.json # Configuration Tauri
└── public/            # Fichiers statiques
```

### Base de données SQLite

L'application utilise SQLite pour le stockage local avec les tables suivantes :

- `users` : Informations des utilisateurs ISSALAN
- `projects` : Projets générés par l'agent IA
- `system_logs` : Logs système
- `settings` : Paramètres de configuration

### Synchronisation avec le backend

L'application se synchronise avec le backend FastAPI d'ISSALAN :
- Mode online : Synchronisation automatique des données
- Mode offline : Utilisation des données locales
- Synchronisation incrémentielle

## 🔧 Configuration

### Variables d'environnement

Créez un fichier `.env` à la racine :

```env
VITE_BACKEND_URL=http://localhost:8000
VITE_APP_NAME=ISSALAN Admin
VITE_APP_VERSION=1.0.0
```

### Configuration Tauri

Modifiez `src-tauri/tauri.conf.json` pour :
- Changer le nom de l'application
- Modifier les permissions
- Configurer le bundle (icônes, identifiant, etc.)

## 📱 Build pour différentes plateformes

### Windows
```bash
npm run tauri build -- --target x86_64-pc-windows-msvc
```

### macOS
```bash
npm run tauri build -- --target aarch64-apple-darwin
```

### Linux
```bash
npm run tauri build -- --target x86_64-unknown-linux-gnu
```

## 🧪 Tests

### Tests unitaires
```bash
npm test
```

### Tests d'intégration
```bash
npm run test:e2e
```

## 🤝 Contribution

1. Fork le projet
2. Créer une branche (`git checkout -b feature/amazing-feature`)
3. Commit les changements (`git commit -m 'Add amazing feature'`)
4. Push vers la branche (`git push origin feature/amazing-feature`)
5. Ouvrir une Pull Request

## 📄 Licence

MIT License - voir le fichier [LICENSE](LICENSE) pour plus de détails.

## 👥 Équipe

- **ISSALAN Team** - Développement et maintenance

## 📞 Support

Pour le support, ouvrez une issue sur le repository ou contactez l'équipe ISSALAN.

---

**ISSALAN Admin Desktop** - Interface d'administration moderne pour l'agent IA africain 🚀
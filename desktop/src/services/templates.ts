/**
 * Modèles prêts à l'emploi pour les automatisations et les tickets.
 * Chaque consigne est écrite pour un agent qui travaille seul : objectif clair,
 * ce qu'il ne doit pas faire, et la forme du compte rendu attendu.
 */
import type { AutomationMode, AutomationSchedule } from '@/stores/automationStore';
import type { AIModel } from '@/types';

export interface AutomationTemplate {
  id: string;
  name: string;
  hint: string;
  prompt: string;
  mode: AutomationMode;
  model: AIModel;
  schedule: AutomationSchedule;
}

const WEEKDAYS = [1, 2, 3, 4, 5];

export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  {
    id: 'nightly-check',
    name: 'Build et tests de la nuit',
    hint: 'Chaque nuit : le projet compile-t-il, les tests passent-ils ?',
    mode: 'full',
    model: 'fast',
    schedule: { kind: 'daily', time: '02:30', days: [] },
    prompt: `Vérifie l'état du projet, sans modifier aucun fichier.
1. Trouve les commandes de build et de test (package.json, pyproject.toml, README).
2. Lance le build, puis les tests.
3. Compte rendu court : ce qui passe, ce qui échoue (fichier, erreur exacte), et la cause probable de chaque échec.
Si tout passe, dis-le en une ligne.`,
  },
  {
    id: 'security-review',
    name: 'Revue de sécurité hebdomadaire',
    hint: 'Le lundi : failles dans le code ajouté ou modifié récemment',
    mode: 'plan',
    model: 'max',
    schedule: { kind: 'daily', time: '08:30', days: [1] },
    prompt: `Fais une revue de sécurité du projet (charge la skill revue-de-code si elle est disponible), sans rien modifier.
Concentre-toi sur : authentification et droits d'accès (un utilisateur peut-il voir les données d'un autre ?), validation des entrées côté serveur, injections (SQL, commandes), secrets dans le code, paiements et webhooks.
Compte rendu : chaque problème avec le fichier et la ligne, le scénario d'attaque concret, et la correction proposée, classé bloquant / important / suggestion. Ne signale pas de problème que tu n'as pas vérifié dans le code.`,
  },
  {
    id: 'dependencies',
    name: 'Dépendances et vulnérabilités',
    hint: 'Le vendredi : paquets en retard et failles connues',
    mode: 'full',
    model: 'fast',
    schedule: { kind: 'daily', time: '17:30', days: [5] },
    prompt: `Fais l'inventaire des dépendances, sans rien installer ni modifier.
1. npm outdated et npm audit (ou pip list --outdated pour Python).
2. Compte rendu : les failles connues d'abord (gravité, paquet, version corrigée), puis les mises à jour majeures en attente, avec ce qui risque de casser.
Termine par les 3 mises à jour que tu conseilles de faire en premier.`,
  },
  {
    id: 'daily-summary',
    name: 'Résumé du travail de la veille',
    hint: 'Chaque matin de semaine : ce qui a changé dans le projet',
    mode: 'full',
    model: 'fast',
    schedule: { kind: 'daily', time: '08:00', days: WEEKDAYS },
    prompt: `Résume ce qui a changé dans le projet depuis hier, sans rien modifier.
Utilise git log --since=yesterday --stat (et git diff si utile).
Compte rendu en 10 lignes au plus : fonctionnalités ajoutées, corrections, fichiers les plus touchés, et ce qui semble inachevé ou risqué.`,
  },
  {
    id: 'todo-hunt',
    name: 'Chasse aux TODO',
    hint: 'Le mercredi : TODO, FIXME et code laissé en plan',
    mode: 'plan',
    model: 'fast',
    schedule: { kind: 'daily', time: '10:00', days: [3] },
    prompt: `Recense les TODO, FIXME, HACK et le code laissé en plan (fonctions vides, console.log de débogage, code commenté), sans rien modifier.
Classe-les du plus urgent au moins urgent, avec le fichier, la ligne et une phrase sur le risque. 15 éléments au plus.`,
  },
  {
    id: 'docs-check',
    name: 'Documentation à jour',
    hint: 'Une fois par semaine : le README dit-il encore la vérité ?',
    mode: 'plan',
    model: 'thinking',
    schedule: { kind: 'daily', time: '16:00', days: [4] },
    prompt: `Compare le README (et la documentation du dossier docs s'il existe) avec le code actuel, sans rien modifier.
Liste ce qui est faux ou manquant : commandes d'installation et de lancement, variables d'environnement, routes d'API, fonctionnalités.
Pour chaque écart, propose le texte corrigé.`,
  },
];

export interface TicketTemplate {
  id: string;
  label: string;
  title: string;
  description: string;
}

export const TICKET_TEMPLATES: TicketTemplate[] = [
  {
    id: 'bug',
    label: 'Corriger un bug',
    title: 'Corriger : ',
    description: `Symptôme : (ce qui se passe, et ce qui devrait se passer)
Pour reproduire : (étapes, page, données)
Message d'erreur : (colle-le si tu l'as)

Terminé quand :
- la cause est trouvée et corrigée (pas seulement le symptôme) ;
- un test reproduit le bug et passe maintenant ;
- le build et les tests existants passent.`,
  },
  {
    id: 'screen',
    label: 'Ajouter un écran',
    title: 'Ajouter la page « » ',
    description: `Page : (nom et adresse, ex. /mes-commandes)
Contenu : (ce qu'elle affiche, d'où viennent les données)
Actions : (boutons, formulaires, ce qu'ils font)
Accès : (qui peut la voir)

Terminé quand :
- la page est accessible depuis la navigation ;
- états gérés : chargement, vide, erreur ;
- vérifiée dans le navigateur (check_page), console sans erreur.`,
  },
  {
    id: 'endpoint',
    label: "Ajouter une route d'API",
    title: 'Ajouter la route ',
    description: `Route : (méthode et chemin, ex. GET /api/orders)
Entrée : (paramètres, corps)
Sortie : (format de la réponse)
Droits : (qui peut l'appeler ; un utilisateur ne voit que ses données)

Terminé quand :
- validation des entrées et erreurs claires (400, 401, 403, 404) ;
- tests du cas normal et des cas d'erreur ;
- build et tests passent.`,
  },
  {
    id: 'tests',
    label: 'Écrire des tests',
    title: 'Écrire les tests de ',
    description: `Partie à tester : (module, fonctions, routes)

Terminé quand :
- les cas normaux, les cas limites et les erreurs sont couverts ;
- les tests vérifient un comportement visible, pas le détail interne ;
- tous les tests passent, sans modifier le code testé (sauf bug trouvé, signalé dans le rapport).`,
  },
  {
    id: 'perf',
    label: 'Améliorer la vitesse',
    title: 'Accélérer ',
    description: `Ce qui est lent : (page, requête, action — et combien de temps)

Terminé quand :
- la cause est mesurée avant de corriger (requête en trop, boucle, données trop lourdes…) ;
- l'amélioration est mesurée après ;
- aucun comportement n'a changé (tests verts).`,
  },
  {
    id: 'docs',
    label: 'Mettre à jour la documentation',
    title: 'Mettre à jour le README',
    description: `Terminé quand le README explique, à jour avec le code :
- ce que fait le projet ;
- l'installation et le lancement (commandes exactes) ;
- les variables d'environnement (sans valeurs secrètes) ;
- la structure des dossiers principaux.`,
  },
];

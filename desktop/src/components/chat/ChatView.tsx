/**
 * ChatView - Vue principale unifiée ANZAR
 * Accueil original + cartes fonctionnalités + chat
 * Routage multi-providers (via backend ANZAR)
 * Câblage agents: détection d'intention projet → pipeline multi-agents
 */
import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Code2, BarChart3, GraduationCap,
  Globe, FileText, BookOpen, PenTool,
  ListChecks, Layout, BookMarked, Presentation,
  X, Wand2,
  // Data analysis icons
  Table2, TrendingUp, PieChart, Filter,
  // Search icons
  Search, Newspaper, HelpCircle, Scale,
  // Document icons
  Mail, FileCheck, Megaphone, ScrollText, Briefcase, Pen,
  FolderOpen,
  WifiOff,
  // Student assistant new features
  Quote, BrainCircuit, ClipboardCheck,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import MessageList from './MessageList';
import ChatInput from './ChatInput';
import { cn } from '@/lib/utils';
import { AIModel, type Message, type ChatAttachment } from '@/types';
import { aiRouter } from '@/services/router';
import { aiService } from '@/services/ai';
import { projectGeneration, type PlanResult, type ExecutionEvent } from '@/services/projectGeneration';
import { fileSystemService } from '@/services/fileSystem';
import { useUsageStore } from '@/stores/usageStore';
import { useActivityStore } from '@/stores/activityStore';
import { useProjectStore } from '@/stores/projectStore';
import { useActiveConversation, useChatStore } from '@/stores/chatStore';
import { documentDir } from '@tauri-apps/api/path';
import BackgroundTasksDock from './BackgroundTasksDock';
import { useCommandStore } from '@/stores/commandStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { commandCardService } from '@/services/commandCardService';
import { shouldAutoRunCommand } from '@/services/commandAutoPolicy';
import VerifyFixNotice from './VerifyFixNotice';
import ProjectWizardModal from './ProjectWizardModal';
import { runService } from '@/services/runService';
import { isAllowedProjectRoot, showPathNotAllowedMessage } from '@/lib/allowedProjectRoots';
import { generationTracker } from '@/services/generationTracker';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

interface ChatViewProps {
  onlineStatus?: boolean;
  showWelcome?: boolean;
}

/* ===== Feature Cards ===== */
const FEATURES = [
  {
    title: 'Générer un projet',
    description: 'Choisis le type, donne un nom et ANZAR code tout pour toi.',
    icon: Code2,
    color: 'from-violet-500 to-indigo-500',
    prompt: '',
  },
  {
    title: 'Importer un dossier',
    description: 'Travaille sur un projet existant en important un dossier local dans ANZAR.',
    icon: FolderOpen,
    color: 'from-slate-500 to-gray-600',
    // Pas de prompt: action locale (dialog)
    prompt: '',
  },
  {
    title: 'Assistant Étudiant',
    description: 'Mémoires, rapports, exposés, révisions : plan, rédaction et correction.',
    icon: GraduationCap,
    color: 'from-pink-500 to-rose-500',
    prompt: 'Aide-moi avec mon travail académique',
  },
  {
    title: 'Analyser des données',
    description: 'Importe, explore, visualise : graphiques et insights en quelques secondes.',
    icon: BarChart3,
    color: 'from-emerald-500 to-teal-500',
    prompt: 'Je veux analyser des données',
  },
  {
    title: 'Recherche intelligente',
    description: 'Pose ta question : ANZAR cherche, compare et synthétise avec sources.',
    icon: Globe,
    color: 'from-blue-500 to-cyan-500',
    prompt: 'Recherche sur internet',
  },
  {
    title: 'Rédiger un document',
    description: 'Rapports, présentations, emails : clairs, structurés, prêts à envoyer.',
    icon: FileText,
    color: 'from-orange-500 to-amber-500',
    prompt: 'Aide-moi à rédiger un document',
  },
];

/* ===== Suggested Prompts (quick start) ===== */
const QUICK_STARTS = [
  'Crée une application de gestion de stock avec React et SQLite',
  'Corrige et reformule mon mémoire de fin d\'études',
  'Recherche les dernières tendances en intelligence artificielle',
  'Génère un plan détaillé pour mon rapport de stage',
  'Écris un script Python pour automatiser mes tâches',
  'Prépare un exposé sur les énergies renouvelables en Afrique',
];

/* ===== Assistant Étudiant - Menu interactif ===== */
const STUDENT_OPTIONS = [
  {
    id: 'memoire',
    title: 'Rédiger un mémoire',
    description: 'Plan complet, rédaction section par section, bibliographie — guidé de A à Z.',
    icon: BookOpen,
    color: 'from-pink-500 to-rose-500',
    tag: 'Populaire',
    prompt: `Tu es un directeur de mémoire expérimenté. Je veux rédiger un mémoire de fin d'études et j'ai besoin d'un accompagnement structuré.

Pose-moi ces 5 questions UNE PAR UNE (attends ma réponse avant la suivante) :
1. Quel est ton sujet ou ta problématique ?
2. Quel est ton niveau (Licence, Master, Doctorat) et ta filière ?
3. Combien de pages sont attendues et y a-t-il des consignes spécifiques ?
4. As-tu déjà un brouillon, un plan ou des recherches ?
5. Quelle est ta date de rendu ?

Après mes réponses, génère directement :

**PLAN DÉTAILLÉ DU MÉMOIRE**

Pour chaque partie (Introduction, Chapitre I, II, III..., Conclusion) :
- Titre et sous-titre
- Objectif de la section (1 phrase)
- Contenu attendu (3-5 points clés à développer)
- Estimation du nombre de pages
- Sources recommandées (types de sources à chercher)

**PROCHAINES ÉTAPES** : liste numérotée des 5 actions concrètes à faire cette semaine.

Propose-moi ensuite de rédiger la première section (introduction) directement.

Format : titres en ## et ###, listes à puces, pas de tableaux ASCII.`,
  },
  {
    id: 'rapport',
    title: 'Rapport de stage',
    description: 'De la page de garde à la conclusion — structure pro avec exemples de contenu.',
    icon: PenTool,
    color: 'from-violet-500 to-purple-500',
    prompt: `Tu es un tuteur universitaire spécialisé dans les rapports de stage. Accompagne-moi pour rédiger un rapport professionnel.

Pose-moi ces questions UNE PAR UNE :
1. Dans quelle entreprise/organisation as-tu fait ton stage ? (nom, secteur, taille)
2. Quelles étaient tes missions principales ?
3. Quelle était la durée du stage et ton niveau d'études ?
4. Y a-t-il des consignes spécifiques de ton école ? (nombre de pages, plan imposé, annexes)
5. As-tu déjà rédigé des parties ou pris des notes ?

Après mes réponses, génère :

**PLAN COMPLET DU RAPPORT**

Structure type avec pour CHAQUE section :
- Page de garde (éléments requis)
- Remerciements (modèle de 5-6 lignes)
- Sommaire
- Introduction (contexte + problématique + annonce du plan)
- Partie 1 : Présentation de l'entreprise (historique, organigramme, activités)
- Partie 2 : Déroulement du stage (missions, outils, méthodologie)
- Partie 3 : Bilan et analyse (résultats, compétences acquises, difficultés)
- Conclusion (synthèse + ouverture professionnelle)
- Bibliographie / Annexes

Pour chaque section : objectif + contenu attendu + estimation pages + un EXEMPLE de paragraphe d'ouverture.

Propose-moi ensuite de rédiger la section de mon choix.

Format : titres en ## et ###, pas de tableaux ASCII.`,
  },
  {
    id: 'correction',
    title: 'Corriger / Reformuler',
    description: 'Upload ton fichier ou colle ton texte — choisis le type de correction en un clic.',
    icon: ListChecks,
    color: 'from-emerald-500 to-green-500',
    tag: 'Upload',
    prompt: '', // Remplacé par subOptions ci-dessous
    opensFileDialog: true,
    subOptions: [
      {
        id: 'correction_langue',
        label: 'Correction langue',
        description: 'Orthographe, grammaire, conjugaison, ponctuation',
        emoji: '✏️',
        prompt: `Tu es un correcteur professionnel et pédagogue. Corrige ce texte en te concentrant sur la LANGUE : orthographe, grammaire, conjugaison, accords, ponctuation.

Format STRICT pour chaque modification :
~~texte original~~ → **texte corrigé** (règle : explication courte)

Les passages corrects : reproduis-les tels quels pour que le texte reste complet.

À LA FIN :
### Bilan de correction
- Nombre total de modifications
- Top 3 des erreurs récurrentes
- Note du texte original : X/20
- 3 conseils pour s'améliorer en orthographe/grammaire

IMPORTANT : pas de tableau ASCII, pas de barres "|".`,
      },
      {
        id: 'correction_reformulation',
        label: 'Reformulation',
        description: 'Style, fluidité, phrases plus claires et élégantes',
        emoji: '💎',
        prompt: `Tu es un styliste littéraire. Reformule ce texte pour améliorer le STYLE : fluidité, clarté, élégance, suppression des répétitions, phrases plus percutantes.

Format STRICT pour chaque modification :
~~phrase originale~~ → **phrase reformulée** (amélioration : raison stylistique)

Les passages déjà bien écrits : reproduis-les tels quels.

À LA FIN :
### Bilan de reformulation
- Nombre de passages reformulés
- Axes d'amélioration principaux (lourdeurs, répétitions, registre)
- Note de qualité stylistique : X/20
- 3 conseils pour mieux écrire

IMPORTANT : pas de tableau ASCII, pas de barres "|".`,
      },
      {
        id: 'correction_academique',
        label: 'Mise en forme académique',
        description: 'Registre soutenu, transitions, structure universitaire',
        emoji: '🎓',
        prompt: `Tu es un relecteur universitaire. Transforme ce texte en document ACADÉMIQUE : registre soutenu, transitions entre paragraphes, structure logique, vocabulaire précis, formulations impersonnelles.

Format STRICT pour chaque modification :
~~formulation originale~~ → **formulation académique** (registre : explication)

Les passages déjà académiques : reproduis-les tels quels.

Ajoute aussi :
- Des connecteurs logiques manquants (en outre, néanmoins, par conséquent...)
- Des transitions entre les parties
- Des reformulations du "je" en tournures impersonnelles si nécessaire

À LA FIN :
### Bilan académique
- Modifications de registre effectuées
- Niveau académique atteint (L1-L3, Master, Doctorat)
- Note de rigueur académique : X/20
- 3 conseils pour un style plus universitaire

IMPORTANT : pas de tableau ASCII, pas de barres "|".`,
      },
      {
        id: 'correction_tout',
        label: 'Tout corriger',
        description: 'Langue + style + structure — correction complète (recommandé)',
        emoji: '🚀',
        prompt: `Tu es un correcteur professionnel complet. Corrige ce texte sur TOUS les plans : orthographe, grammaire, style, fluidité, registre académique, transitions, structure.

Format STRICT pour chaque modification :
~~texte original~~ → **texte corrigé** (explication courte : type de correction)

Les passages corrects : reproduis-les tels quels pour que le texte reste complet et lisible.

À LA FIN :
### Bilan complet
- Nombre total de modifications (langue / style / structure)
- Top 3 des problèmes récurrents
- Note du texte original : X/20
- 3 conseils prioritaires pour progresser

L'étudiant pourra exporter en "Word propre" (texte corrigé seul) ou "Word annoté" (avec les explications).

IMPORTANT : pas de tableau ASCII, pas de barres "|".`,
      },
    ],
  },
  {
    id: 'plan',
    title: 'Plan détaillé',
    description: 'Plan structuré avec numérotation académique, objectifs et estimation de pages.',
    icon: Layout,
    color: 'from-blue-500 to-indigo-500',
    prompt: `Tu es un méthodologue universitaire. Aide-moi à construire un plan détaillé et rigoureux.

Demande-moi :
1. Sujet ou problématique exacte
2. Type de travail (mémoire, rapport, dissertation, exposé, thèse, article)
3. Nombre de pages / durée attendue
4. Consignes spécifiques (si imposées par le prof)

Puis génère un plan avec la NUMÉROTATION ACADÉMIQUE (I, A, 1, a) :

**PLAN DÉTAILLÉ**

Pour chaque partie et sous-partie :
I. Titre de la partie
   - Objectif : (1 phrase — ce que cette partie doit démontrer)
   - Pages estimées : X-Y pages
   A. Sous-partie 1
      - Points à développer : (3-4 éléments)
      1. Sous-sous-partie (si nécessaire)
   B. Sous-partie 2
      - Points à développer

**CONSEIL MÉTHODOLOGIQUE** pour chaque grande partie : quelle approche adopter (analyse, comparaison, étude de cas, revue de littérature…)

**TRANSITIONS** : propose une phrase de transition entre chaque grande partie.

À la fin, propose :
- "Tu veux que je rédige l'introduction ?"
- "Tu veux que je développe une section en particulier ?"
- "Tu veux exporter ce plan en Word ?"

Format : numérotation I.A.1.a, titres en ##, pas de tableaux ASCII.`,
  },
  {
    id: 'resume',
    title: 'Résumé de cours',
    description: 'Fiche de révision structurée — définitions, formules, schémas, points clés.',
    icon: BookMarked,
    color: 'from-amber-500 to-yellow-500',
    tag: 'Upload',
    prompt: `Tu es un assistant de révision expert. Je veux créer une fiche de révision à partir d'un cours.

Si je n'ai pas encore envoyé de contenu, dis-moi :
"Envoie-moi ton cours (colle le texte, uploade un PDF/Word, ou dis-moi juste le sujet)."

Puis demande-moi quel format je préfère :
1. **Fiche express** — 1-2 pages, uniquement l'essentiel à retenir
2. **Fiche complète** — structurée avec définitions, exemples, formules
3. **Carte mentale** — en format Mermaid (diagramme visuel)
4. **Fiche + Quiz** — fiche de révision + 10 questions pour tester

Génère la fiche avec cette structure :

### [Titre du cours/chapitre]

**Concepts clés** (les 5-8 notions essentielles, chacune en 1-2 phrases)

**Définitions à retenir**
- **Terme** : définition claire et concise

**Formules / Règles** (si applicable)
- Formule : explication + quand l'utiliser

**Schéma récapitulatif** (si le format carte mentale est choisi : utilise un bloc \`\`\`mermaid avec un mindmap ou flowchart)

**Points pièges** — les erreurs classiques à éviter

**À retenir absolument** — les 3 choses à savoir si tu n'as que 5 minutes avant l'examen

Propose ensuite : "Tu veux que je génère un quiz de révision à partir de cette fiche ?" → si oui, enchaîne directement avec 10 questions.

Format : titres en ### et ####, listes à puces, pas de tableaux ASCII.`,
    opensFileDialog: true,
  },
  {
    id: 'expose',
    title: 'Préparer un exposé',
    description: 'Plan, contenu par slide, notes orales — et export PowerPoint direct.',
    icon: Presentation,
    color: 'from-teal-500 to-cyan-500',
    prompt: `Tu es un coach de présentation orale. Aide-moi à préparer un exposé complet.

Demande-moi :
1. Sujet de l'exposé
2. Durée (5, 10, 15, 20, 30 minutes)
3. Public (classe, jury, prof, conférence)
4. Support attendu (PowerPoint, oral seul, poster)

Puis génère :

**PLAN DE L'EXPOSÉ** (adapté à la durée)

Pour CHAQUE slide/section :

**Slide X : [Titre]** (durée estimée : X min)
- Contenu visuel : ce qu'il faut mettre sur la slide (bullet points, image, graphique)
- Ce que tu DIS à l'oral : 3-5 phrases de script naturel (pas du texte lu, du parlé)
- Transition vers la slide suivante : 1 phrase

**CONSEILS POUR L'ORAL :**
- Comment commencer (accroche)
- Comment gérer le stress
- Comment répondre aux questions
- Timing : quand accélérer, quand ralentir

**ANTI-SÈCHE** : résumé en 10 bullet points de tout l'exposé (à garder sous les yeux)

À la fin, propose :
"Tu veux que j'exporte ces slides en PowerPoint ? Clique sur le bouton PPTX dans la barre d'export."

Format : titres en ## et ###, pas de tableaux ASCII.`,
  },
  {
    id: 'citations',
    title: 'Générer des citations',
    description: 'Bibliographie APA, MLA, Chicago, Harvard — formatée et prête à copier.',
    icon: Quote,
    color: 'from-orange-500 to-red-500',
    tag: 'Nouveau',
    prompt: `Tu es un bibliothécaire universitaire expert en normes de citation. Aide-moi à créer ma bibliographie.

Demande-moi :
1. Style de citation (APA 7e, MLA 9e, Chicago 17e, Harvard, IEEE, Vancouver)
2. Mes sources (je vais te les donner une par une ou en lot)

Pour chaque source, génère :

**Source : [titre court]**
- Citation complète (bibliographie) :
  [citation formatée selon le style choisi]
- Citation in-text (dans le texte) :
  [format court à insérer dans une phrase]
- Exemple dans une phrase :
  "Selon [citation in-text], les résultats montrent que..."

Exemple concret en APA 7e pour un livre :
- Bibliographie : Dupont, J.-P. (2023). *Introduction à la méthodologie*. Éditions Universitaires.
- In-text : (Dupont, 2023, p. 45)

Quand j'ai fini de donner mes sources, compile automatiquement :

### Bibliographie complète
(toutes les sources triées alphabétiquement, formatées, avec retrait de 2e ligne — prêtes à copier-coller dans Word)

Si je donne juste un titre ou un lien web, cherche les informations manquantes (auteur, éditeur, date, URL, DOI).

IMPORTANT : respecte STRICTEMENT les règles du style choisi (italique, majuscules, ponctuation, alinéa). Pas de tableaux ASCII.`,
  },
  {
    id: 'quiz',
    title: 'Quiz de révision',
    description: 'QCM interactif — réponds d\'abord, puis découvre les corrections et explications.',
    icon: BrainCircuit,
    color: 'from-fuchsia-500 to-pink-500',
    tag: 'Nouveau',
    prompt: `Tu es un professeur qui crée des quiz de révision engageants et pédagogiques.

Si je n'ai pas envoyé de cours, demande-moi :
"Envoie-moi ton cours (texte, PDF ou Word) ou dis-moi le sujet."

Puis demande :
1. Combien de questions ? (5, 10, 15, 20)
2. Difficulté ? (facile / moyen / difficile / progressif)

MODE INTERACTIF — Pose les questions UNE PAR UNE :

**Question 1/X : [Titre court du thème]**

[Énoncé de la question]

a) Option A
b) Option B
c) Option C
d) Option D

"Quelle est ta réponse ? (tape a, b, c ou d)"

Quand je réponds, donne :
- ✅ **Correct !** ou ❌ **Incorrect — la bonne réponse est X**
- **Explication** : pourquoi c'est la bonne réponse (2-3 phrases pédagogiques)
- Passe à la question suivante

À LA FIN du quiz :

### Résultat
- Score : X/Y (pourcentage)
- Points forts : les thèmes maîtrisés
- À revoir : les thèmes à retravailler
- Conseil : prochaine étape pour progresser

Propose : "Tu veux un nouveau quiz plus difficile sur les thèmes ratés ?"

IMPORTANT : une seule question à la fois, attends ma réponse. Pas de tableaux ASCII.`,
    opensFileDialog: true,
  },
  {
    id: 'evaluer',
    title: 'Mode Professeur',
    description: 'Note /20 détaillée, grille par critère, erreurs critiques et conseils pour progresser.',
    icon: ClipboardCheck,
    color: 'from-red-500 to-rose-600',
    tag: 'Upload',
    prompt: `Tu es un professeur universitaire exigeant mais bienveillant. Je vais te soumettre un travail à évaluer.

Si je n'ai pas encore envoyé de document, dis-moi :
"Envoie-moi ton travail (colle le texte ou uploade un fichier PDF/Word avec le bouton 📎)."

Puis demande :
1. Type de travail (mémoire, rapport, dissertation, exposé, exercice, lettre de motivation)
2. Niveau (L1, L2, L3, Master 1, Master 2, Doctorat)
3. Matière / discipline

Utilise la grille adaptée à la discipline. Voici les grilles prédéfinies :

**Pour les sciences humaines / lettres :**
- Problématique et pertinence : /4
- Argumentation et logique : /5
- Maîtrise de la langue : /4
- Sources et références : /3
- Originalité et esprit critique : /2
- Présentation et mise en forme : /2

**Pour les sciences / technique :**
- Compréhension du sujet : /4
- Rigueur méthodologique : /5
- Exactitude des résultats : /4
- Interprétation et analyse : /3
- Clarté de la rédaction : /2
- Présentation (figures, tableaux) : /2

**Pour le droit / économie :**
- Maîtrise des concepts juridiques/économiques : /5
- Structure du raisonnement : /4
- Qualité des références : /4
- Rédaction et précision du vocabulaire : /3
- Cas pratiques / exemples : /2
- Présentation : /2

Génère :

### Évaluation — [Type de travail]

**Note globale : XX/20** [avec appréciation : Insuffisant / Passable / Bien / Très bien / Excellent]

**Grille détaillée :** (chaque critère avec note + justification en 1 phrase)

**Points forts** (cite des passages précis du travail — entre guillemets)

**Points à améliorer** (pour chaque point : le problème + comment le corriger concrètement)

**Erreurs critiques** (s'il y en a : hors-sujet, contresens, incohérence, source manquante)

**Version améliorée** : propose de réécrire les 2-3 passages les plus faibles pour montrer la différence.

**Conseils pour progresser** (3 actions concrètes pour la prochaine fois)

IMPORTANT : sois PRÉCIS, cite le travail. Pas de tableaux ASCII.`,
    opensFileDialog: true,
  },
];

/* ===== Analyser des données - Menu interactif ===== */
const DATA_OPTIONS = [
  {
    id: 'csv_excel',
    title: 'Analyser un fichier CSV/Excel',
    description: 'Importe ton fichier de données et obtiens statistiques, tendances et insights.',
    icon: Table2,
    color: 'from-emerald-500 to-green-500',
    prompt: `Je veux analyser un fichier de données (CSV/Excel). À partir du fichier, commence par me donner un aperçu (colonnes, types, 5 premières lignes), puis propose : résumé statistique, tendances/corrélations, nettoyage, tableaux croisés et recommandations.`,
    opensFileDialog: true,
  },
  {
    id: 'visualize',
    title: 'Créer des graphiques',
    description: 'Génère des visualisations claires à partir de tes données.',
    icon: TrendingUp,
    color: 'from-blue-500 to-indigo-500',
    prompt: `Je veux créer des graphiques à partir de mes données. Demande-moi le type de graphique (courbe/barres/camembert/scatter/histogramme) et ce que je veux montrer, puis propose 2-3 graphiques pertinents + explication (et si possible le code Python).`,
    opensFileDialog: true,
  },
  {
    id: 'survey',
    title: 'Analyser un sondage/enquête',
    description: 'Traite les résultats d\'un sondage, questionnaire ou formulaire.',
    icon: PieChart,
    color: 'from-violet-500 to-purple-500',
    prompt: `Je veux analyser les résultats d'un sondage. À partir du fichier, résume d'abord (nb répondants si présent, questions, types de réponses), puis donne : pourcentages, tendances, points surprenants et recommandations.`,
    opensFileDialog: true,
  },
  {
    id: 'compare',
    title: 'Comparer des données',
    description: 'Compare des périodes, des groupes ou des produits entre eux.',
    icon: Filter,
    color: 'from-amber-500 to-orange-500',
    prompt: `Je veux comparer des données (groupes/périodes/produits). À partir du fichier, fais une comparaison claire (écarts, points forts/faibles) puis une recommandation finale.`,
    opensFileDialog: true,
  },
];

/* ===== Recherche intelligente - Menu interactif ===== */
const SEARCH_OPTIONS = [
  {
    id: 'research',
    title: 'Recherche approfondie',
    description: 'Recherche complète sur un sujet avec sources, synthèse et analyse.',
    icon: Search,
    color: 'from-blue-500 to-cyan-500',
    prompt: `Fais une recherche approfondie sur mon sujet avec des sources. Commence par me demander le sujet, le niveau de profondeur et l'angle, puis donne une synthèse structurée + sources + conclusion.`,
  },
  {
    id: 'news',
    title: 'Actualités et tendances',
    description: 'Les dernières nouvelles et tendances sur un sujet précis.',
    icon: Newspaper,
    color: 'from-red-500 to-pink-500',
    prompt: `Donne-moi les dernières actualités sur mon sujet (période + domaine). Résume les 5-10 infos clés, avec sources, tendances et points à retenir.`,
  },
  {
    id: 'factcheck',
    title: 'Vérifier une information',
    description: 'Vérifie si une affirmation, une rumeur ou un chiffre est vrai.',
    icon: HelpCircle,
    color: 'from-amber-500 to-yellow-500',
    prompt: `Je veux vérifier une information. Demande-moi l'affirmation exacte et la source, puis donne un verdict (vrai/faux/partiel/non vérifiable) avec preuves et sources.`,
  },
  {
    id: 'compare_options',
    title: 'Comparer des options',
    description: 'Compare des produits, services, technologies ou solutions.',
    icon: Scale,
    color: 'from-green-500 to-emerald-500',
    prompt: `Compare des options (produits/services/technos). Demande-moi les critères, puis fais une comparaison claire (sans tableau ASCII) + recommandation + sources.`,
  },
];

/* ===== Rédiger un document - Menu interactif ===== */
const DOCUMENT_OPTIONS = [
  {
    id: 'email_pro',
    title: 'Email professionnel',
    description: 'Rédige un email clair, professionnel et adapté au contexte.',
    icon: Mail,
    color: 'from-blue-500 to-indigo-500',
    prompt: `Aide-moi à rédiger un email professionnel. Demande-moi le destinataire, l'objectif, le ton et les points à inclure, puis propose un email complet (objet + corps + formule de politesse).`,
  },
  {
    id: 'rapport_pro',
    title: 'Rapport professionnel',
    description: 'Rapport d\'activité, de mission, d\'analyse ou de projet.',
    icon: FileCheck,
    color: 'from-emerald-500 to-green-500',
    prompt: `Aide-moi à rédiger un rapport professionnel. Demande-moi le type, le destinataire, la période et les points clés, puis propose une structure complète + un exemple de rédaction section par section.`,
  },
  {
    id: 'lettre',
    title: 'Lettre officielle',
    description: 'Lettre de motivation, de réclamation, administrative ou de demande.',
    icon: ScrollText,
    color: 'from-violet-500 to-purple-500',
    prompt: `Aide-moi à rédiger une lettre officielle. Demande-moi le type de lettre, le destinataire, le contexte et les infos obligatoires, puis rédige une lettre complète (date, objet, corps, formule, signature).`,
  },
  {
    id: 'article',
    title: 'Article / Post',
    description: 'Article de blog, post LinkedIn, contenu marketing ou éditorial.',
    icon: Megaphone,
    color: 'from-pink-500 to-rose-500',
    prompt: `Aide-moi à écrire un article/post. Demande-moi le format (blog/LinkedIn/etc.), le sujet, la cible, le ton et la longueur, puis rédige un contenu structuré (titre → intro → sections → conclusion).`,
  },
  {
    id: 'cv',
    title: 'CV et lettre de motivation',
    description: 'Crée ou améliore ton CV et ta lettre de motivation.',
    icon: Briefcase,
    color: 'from-amber-500 to-orange-500',
    prompt: `Aide-moi à créer/améliorer mon CV et/ou ma lettre de motivation. Demande-moi le poste visé, mon expérience, mes formations/compétences et (si j'ai déjà un CV) analyse-le puis propose une version améliorée.`,
    opensFileDialog: true,
  },
  {
    id: 'contrat',
    title: 'Document contractuel',
    description: 'Devis, contrat simple, CGV, facture ou accord de confidentialité.',
    icon: Pen,
    color: 'from-slate-500 to-gray-600',
    prompt: `Tu es un assistant juridique. L'utilisateur veut rédiger un document contractuel. Demande-lui :
1. Quel type de document ? (devis, contrat de prestation, CGV, facture, NDA, accord de partenariat)
2. Entre quelles parties ?
3. Quel est l'objet du contrat/document ?
4. Y a-t-il des clauses spécifiques à inclure ?

Rédige un document professionnel avec les clauses standards. ATTENTION : précise toujours que ce document est un modèle et qu'il est recommandé de le faire valider par un professionnel du droit avant signature.`,
  },
];

// ============================================================================
// INTENT DETECTION - Détecte si le message demande une génération de projet
// ============================================================================

function detectProjectIntent(message: string): boolean {
  const msg = (message || '').trim()
  if (msg.length < 18) return false

  // Heuristiques "anti-faux-positifs"
  if (msg.includes('```')) return false // souvent un extrait de code / logs
  if (/\b(stack trace|traceback|exception)\b/i.test(msg)) return false

  const questionLike = /(\bcomment\b|\bpourquoi\b|\bexplique\b|\bexpliquer\b|\bwhat\b|\bwhy\b|\bhow\b)\b/i.test(msg)
  const asksToCreate = /\b(cr[ée]{1,2}[es]?\b|cr[ée]{1,2}[- ]?moi|g[ée]n[eè]re|développe|construis|build|create|generate|make|develop)\b/i.test(msg)
  if (questionLike && !asksToCreate) return false

  const verb = /\b(cr[ée]{1,2}[es]?\b|cr[ée]{1,2}[- ]?moi|g[ée]n[eè]re|développe|construis|fais|monte|build|create|generate|make|develop)\b/i
  const obj = /\b(app|application|projet|site|api|dashboard|plateforme|système|logiciel|outil|saas|mvp|prototype|backend|frontend|page web|landing|project|website|platform)\b/i
  const scope = /\b(complet|from scratch|de zéro|entier|full\s*stack|crud|auth|authentification|base de données|database)\b/i
  const domain = /\b(stock|inventaire|crm|facturation|billing|e-?commerce|boutique|restaurant|réservation|booking|gestion)\b/i

  let score = 0
  if (verb.test(msg)) score += 1
  if (obj.test(msg)) score += 1
  if (scope.test(msg)) score += 1
  if (domain.test(msg)) score += 1

  // Si ça ressemble à une demande de debug/correction, on ne déclenche pas le builder
  const looksLikeFix =
    /\b(corrige|corriger|fix|débug|debug|bug|erreur|errors?|refactor|optimise|lint|tests?|build)\b/i.test(msg) &&
    !asksToCreate
  if (looksLikeFix) return false

  // Appui du classifieur local (0 coût, heuristique)
  try {
    const cls = aiRouter.classifyTask([{ role: 'user', content: msg } as any], { hasImages: false })
    if (cls.type === 'planning' || cls.type === 'code_gen') score += 1
    if (cls.type === 'code_review' || cls.type === 'debug_visual') score -= 1
  } catch {
    // ignore
  }

  return score >= 3
}

// ══════════════════════════════════════════════════════════════════════
// DÉTECTION D'INTENTION VISUELLE — route vers Kimi pour images/diagrammes
// ══════════════════════════════════════════════════════════════════════
function detectVisualIntent(message: string): boolean {
  const msg = (message || '').trim().toLowerCase();
  if (msg.length < 8) return false;

  // Mots-clés visuels (FR + EN)
  const visualKeywords =
    /\b(image|images|photo|photos|illustration|illustrations|diagramme|diagrammes|schéma|schémas|schema|schemas|graphique|graphiques|graph|graphs|chart|charts|dessin|dessins|dessine|dessiner|illustre|illustrer|visuel|visuels|visualise|visualiser|infographie|infographies|organigramme|organigrammes|flowchart|mind\s?map|carte\s?mentale|arbre|figure|figures|tableau\s?visuel|mermaid|svg|uml|sequence\s?diagram|class\s?diagram|diag)\b/i;

  // Verbes de création visuelle
  const visualVerbs =
    /\b(génère|genere|génerer|generer|crée|cree|créer|créée|créées|creer|fais|faire|montre|montrer|trace|tracer|représente|represente|représenter|representer|draw|create|generate|make|show|plot|sketch|render|design)\b/i;

  // Contexte visuel fort (demande explicite d'image/diagramme)
  const strongVisual =
    /\b(fais[- ]?moi\s+(un|une|le|la|des)\s+(image|diagramme|schéma|schema|graphique|dessin|illustration|organigramme|infographie|flowchart|figure|svg|mermaid)|dessine[- ]?moi|illustre[- ]?moi|génère[- ]?moi\s+(un|une)\s+(image|diagramme|schéma|schema|graphique)|create\s+(a|an|the)\s+(image|diagram|chart|graph|flowchart|figure))\b/i;

  if (strongVisual.test(msg)) return true;

  // Combinaison verbe + mot-clé visuel
  if (visualVerbs.test(msg) && visualKeywords.test(msg)) return true;

  // Demande directe de type de diagramme
  const diagramTypes =
    /\b(diagramme\s+(de\s+)?(classe|séquence|sequence|flux|activité|activite|état|etat|cas\s+d'utilisation|use\s+case|entité|entite|relation|er)|class\s+diagram|sequence\s+diagram|flowchart|er\s+diagram|state\s+diagram|activity\s+diagram|use\s+case\s+diagram)\b/i;
  if (diagramTypes.test(msg)) return true;

  return false;
}

/** Extrait un nom de projet court depuis le message */
function extractProjectName(message: string): string {
  // Essayer d'extraire après "de gestion de", "pour", etc.
  const match = message.match(
    /(?:de gestion de|pour|d'|de)\s+([a-zàâéèêëïîôùûüæœç\s]{2,30})/i
  );
  if (match) {
    return match[1].trim().replace(/\s+/g, '_').slice(0, 30);
  }
  // Fallback: premiers mots significatifs
  const words = message
    .replace(/[^\w\sàâéèêëïîôùûüæœç]/gi, '')
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 3);
  return words.join('_').slice(0, 30) || 'mon_projet';
}

// ============================================================================
// COMPONENT
// ============================================================================

export default function ChatView({ onlineStatus = true, showWelcome = true }: ChatViewProps) {
  const navigate = useNavigate();
  const [selectedModel, setSelectedModel] = useState<AIModel>('fast');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  // When Sidebar clicks "Nouvelle tache" it sets activeProjectId to null.
  // Listen to that and clear the local state so the old project stops following.
  const storeActiveProjectId = useProjectStore((s) => s.activeProjectId);
  const prevStoreRef = useRef(storeActiveProjectId);
  useEffect(() => {
    if (prevStoreRef.current !== null && storeActiveProjectId === null) {
      setSelectedProjectId(null);
    }
    prevStoreRef.current = storeActiveProjectId;
  }, [storeActiveProjectId]);
  const [showStudentMenu, setShowStudentMenu] = useState(false);
  const [showDataMenu, setShowDataMenu] = useState(false);
  const [showSearchMenu, setShowSearchMenu] = useState(false);
  const [showDocumentMenu, setShowDocumentMenu] = useState(false);
  const [showProjectWizard, setShowProjectWizard] = useState(false);
  const forceProjectGenerationOnceRef = useRef(false);
  const wizardMetaRef = useRef<{ projectType: string; techs: string[] } | null>(null);
  const projectBaseDirOverrideRef = useRef<string | null>(null);
  const lastProjectGenerationWasUserActionRef = useRef(false);

  const prepareProjectGeneration = useCallback(async () => {
    lastProjectGenerationWasUserActionRef.current = true;
    projectBaseDirOverrideRef.current = null;

    // En mode non-tauri (web), pas de choix de dossier
    try {
      const docsDir = await documentDir();
      const defaultBase = `${docsDir}ANZAR/Projects`;
      // Crée le dossier par défaut si possible (non bloquant)
      try {
        await fileSystemService.createDirectory(defaultBase);
      } catch {
        // ignore
      }

      // Proposer (sans insister) le dossier par défaut. Si non, laisser l'utilisateur choisir.
      try {
        const { confirm, open } = await import('@tauri-apps/api/dialog');
        const okDefault = await confirm(
          `Où veux-tu créer le projet ?\n\nPar défaut:\n${defaultBase}\n\nUtiliser cet emplacement ?`,
          { title: 'Emplacement du projet', type: 'info' as any }
        );
        if (okDefault) {
          projectBaseDirOverrideRef.current = defaultBase;
          return;
        }
        const selected = await open({
          directory: true,
          multiple: false,
          title: 'Choisir le dossier de sortie (dans ANZAR)',
        });
        if (selected && typeof selected === 'string') {
          const allowed = await isAllowedProjectRoot(selected);
          if (!allowed) {
            toast.error('Dossier non autorisé. Choisis un dossier dans ton répertoire personnel.');
            projectBaseDirOverrideRef.current = defaultBase;
            return;
          }
          projectBaseDirOverrideRef.current = selected.replace(/\\/g, '/').replace(/\/+$/, '');
          return;
        }
      } catch {
        // ignore - fallback default
      }

      projectBaseDirOverrideRef.current = defaultBase;
    } catch {
      // Pas de documentDir / tauri: fallback sans override
      projectBaseDirOverrideRef.current = null;
    }
  }, []);

  // Chat store (source de vérité pour l'historique / sélection via Sidebar)
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const activeConversation = useActiveConversation();
  const createConversation = useChatStore((s) => s.createConversation);
  const addConversationMessage = useChatStore((s) => s.addMessage);
  const updateConversationMessage = useChatStore((s) => s.updateMessage);
  const isLoading = useChatStore((s) => s.isGenerating);
  const setIsGenerating = useChatStore((s) => s.setIsGenerating);
  const pendingRetry = useChatStore((s) => s.pendingRetry);
  const setPendingRetry = useChatStore((s) => s.setPendingRetry);
  const startStreamingMessage = useChatStore((s) => s.startStreamingMessage);
  const appendStreamingContent = useChatStore((s) => s.appendStreamingContent);
  const finalizeStreamingMessage = useChatStore((s) => s.finalizeStreamingMessage);
  const updateStreamingContent = useChatStore((s) => s.updateStreamingContent);
  const projects = useProjectStore((s) => s.projects);
  const selectedProjectPath = projects.find((p) => p.id === selectedProjectId)?.metadata?.localPath as string | undefined;
  const settings = useSettingsStore((s) => s.settings);
  const [isBrowserOnline, setIsBrowserOnline] = useState<boolean>(() => globalThis.navigator?.onLine ?? true);

  // Network listeners (grand public) - n'affiche pas d'alert, juste un état
  useEffect(() => {
    const onOnline = () => setIsBrowserOnline(true);
    const onOffline = () => setIsBrowserOnline(false);
    globalThis.addEventListener?.('online', onOnline);
    globalThis.addEventListener?.('offline', onOffline);
    return () => {
      globalThis.removeEventListener?.('online', onOnline);
      globalThis.removeEventListener?.('offline', onOffline);
    };
  }, []);

  const isEffectivelyOnline = onlineStatus && isBrowserOnline && !settings.offlineMode;

  // Messages affichés (on masque les messages 'tool' pour l'UI actuelle)
  const messages: Message[] = (activeConversation?.messages || []).filter((m) => m.role !== 'tool');

  // ────────────────────────────────────────────────────────────────────────────
  // Import d'un dossier local (projet existant)
  // ────────────────────────────────────────────────────────────────────────────
  const ensureActiveConversation = useCallback(() => {
    // Crée une conversation par défaut si aucune n'est active (sinon addMessage ne fait rien)
    if (!useChatStore.getState().activeConversationId) {
      createConversation(undefined, selectedModel);
    }
  }, [createConversation, selectedModel]);

  const handleImportFolder = useCallback(async () => {
    try {
      const { open } = await import('@tauri-apps/api/dialog');
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Importer un dossier (projet existant)',
      });

      if (!selected || typeof selected !== 'string') return;

      const allowed = await isAllowedProjectRoot(selected);
      if (!allowed) {
        toast.error('Dossier non autorisé. Choisis un dossier dans ton répertoire personnel.');
        return;
      }

      const folderName = selected.split(/[/\\]/).pop() || 'Projet importé';
      const project = useProjectStore.getState().createProject(folderName, `Projet importé: ${selected}`, selectedModel);
      useProjectStore.getState().updateProject(project.id, {
        status: 'complete',
        metadata: { localPath: selected, imported: true },
      } as any);
      // Optionnel: rendre le projet actif immédiatement
      useProjectStore.getState().setActiveProject(project.id);
      setSelectedProjectId(project.id);
      toast.success(`Projet importé : ${folderName}`);

      // UX "pro": proposer d'ouvrir le workspace, sans insister
      try {
        const { confirm } = await import('@tauri-apps/api/dialog');
        const ok = await confirm(
          `Projet importé : ${folderName}\n\nChemin:\n${selected}\n\nOuvrir le projet maintenant ?`,
          { title: 'Projet importé', type: 'info' as any }
        );
        if (ok) navigate(`/projects/${project.id}`);
      } catch {
        // Fallback web: pas de dialog natif, rester non-intrusif
      }
    } catch (err) {
      console.error('Import folder failed:', err);
      // Feedback minimal dans le chat
      ensureActiveConversation();
      const msgId = `msg_${Date.now()}`;
      const content = `Impossible d'ouvrir le selecteur de dossier. (Fonction disponible sur l'app desktop Tauri.)`;
      addConversationMessage({
        id: msgId,
        role: 'assistant',
        content,
        timestamp: Date.now(),
        model: selectedModel,
        isError: true,
      });
      toast.error("Impossible d'importer le dossier");
    }
  }, [selectedModel, ensureActiveConversation, addConversationMessage, navigate]);

  // Auto-init au premier montage
  useEffect(() => {
    if (!activeConversationId) {
      createConversation(undefined, selectedModel);
    }
  }, [activeConversationId, createConversation, selectedModel]);

  // Project store actions
  const createProject = useProjectStore((s) => s.createProject);
  const updateAgentStatus = useProjectStore((s) => s.updateAgentStatus);
  const setProjectStatus = useProjectStore((s) => s.setProjectStatus);
  const setProjectProgress = useProjectStore((s) => s.setProjectProgress);
  const updateProject = useProjectStore((s) => s.updateProject);
  const addFile = useProjectStore((s) => s.addFile);
  const loadProjectFromDisk = useProjectStore((s) => s.loadProjectFromDisk);

  // Usage tracking
  const addUsageRecord = useUsageStore((s) => s.addRecord);

  // Activity tracking
  const startSession = useActivityStore((s) => s.startSession);
  const endSession = useActivityStore((s) => s.endSession);
  const addStep = useActivityStore((s) => s.addStep);
  const completeStep = useActivityStore((s) => s.completeStep);

  // ========================================================================
  // PROJECT GENERATION HANDLER
  // ========================================================================

  const handleProjectGeneration = useCallback(async (
    content: string,
    userMessageId: string,
    sessionId: string,
  ) => {
    setIsGenerating(true);
    const projectName = extractProjectName(content);

    // Create project in store
    const project = createProject(projectName, content, selectedModel);
    const projectId = project.id;

    // ── Create local directory for the project ──
    let localPath: string | undefined;
    try {
      const docsDir = await documentDir();
      const base = projectBaseDirOverrideRef.current || `${docsDir}ANZAR/Projects`;
      // Ensure base dir exists
      try {
        await fileSystemService.createDirectory(base);
      } catch {
        // ignore
      }
      localPath = `${base}/${projectName}`;
      await fileSystemService.createDirectory(localPath);
      // Persist localPath in project metadata
      updateProject(projectId, { metadata: { ...project.metadata, localPath } });
    } catch (fsErr) {
      // Non-blocking: project can still be generated in-memory
      console.warn('Could not create local project directory:', fsErr);
    }

    // AI placeholder message for generation progress
    const aiMessageId = `msg_${Date.now() + 1}`;
    ensureActiveConversation();
    // Persist dans l'historique (source unique)
    addConversationMessage({
      id: aiMessageId,
      role: 'assistant',
      content: `**${projectName}** - Preparation en cours...`,
      timestamp: Date.now(),
      model: selectedModel,
      isStreaming: true,
      activitySessionId: sessionId,
    });

    const startTime = Date.now();

    try {
      const planStepId = addStep(sessionId, {
        type: 'planning',
        label: 'Architecture du projet',
      });

      let lastPlan: PlanResult | null = null;
      const addedSteps = new Set<string>();

      const wizardMeta = wizardMetaRef.current;
      wizardMetaRef.current = null;

      const plan = await projectGeneration.generate(
        {
          description: content,
          project_name: projectName,
          project_type: wizardMeta?.projectType || 'other',
          tech_stack: wizardMeta?.techs || [],
        },
        {
          onPhaseChange: (phase, message) => {
            if (phase === 'planning') {
              addStep(sessionId, { type: 'understanding', label: 'Analyse de ta demande' });
              updateConversationMessage(aiMessageId, { content: `**${projectName}**\n\nAnalyse et enrichissement de ta demande...` });
            } else if (phase === 'planned') {
              updateConversationMessage(aiMessageId, { content: `**${projectName}**\n\n${message || 'Plan pret.'}` });
            } else if (phase === 'executing') {
              updateConversationMessage(aiMessageId, { content: `**${projectName}**\n\nGeneration du code en cours...` });
            }
          },

          onPlanReady: (p) => {
            lastPlan = p;
            completeStep(sessionId, planStepId);
            updateAgentStatus(projectId, 'orchestrator', { status: 'done', progress: 100, message: 'Architecture definie' });
            updateAgentStatus(projectId, 'planner', { status: 'done', progress: 100, message: p.files.length + ' fichiers planifies' });
            setProjectProgress(projectId, 30);

            // Persist backend project id for reference
            updateProject(projectId, {
              metadata: { ...(project.metadata as any), localPath, backendProjectId: p.project_id },
            });

            // Register background tracker so generation survives navigation
            generationTracker.track(projectId, p.project_id, p.title || projectName);

            addStep(sessionId, { type: 'complete', label: 'Architecture: ' + p.files.length + ' fichiers planifies' });
            addStep(sessionId, { type: 'writing', label: 'Generation du code' });

            const nextContent =
              '**' + (p.title || projectName) + '**\n\n' +
              'Architecture validee - ' + p.files.length + ' fichiers prevus.\n\n' +
              'Generation du code en cours...';
            updateConversationMessage(aiMessageId, { content: nextContent });

            updateAgentStatus(projectId, 'coder', { status: 'working', progress: 10, message: 'Generation du code...' });
          },

          onAgentUpdate: (event: ExecutionEvent) => {
            for (const agent of event.agents) {
              updateAgentStatus(projectId, agent.name, {
                status: agent.status === 'done' ? 'done' : agent.status === 'error' ? 'error' : agent.status === 'running' ? 'working' : 'idle',
                progress: agent.progress,
                message: agent.message || '',
              });

              // Add granular timeline steps (deduplicated)
              const stepKey = agent.name + ':' + agent.status;
              if (!addedSteps.has(stepKey)) {
                addedSteps.add(stepKey);
                if (agent.status === 'running' && agent.name === 'tester') {
                  addStep(sessionId, { type: 'testing', label: 'Tests qualite du code' });
                } else if (agent.status === 'running' && agent.name === 'executor') {
                  addStep(sessionId, { type: 'creating', label: 'Ecriture des fichiers sur disque' });
                } else if (agent.status === 'done' && agent.name === 'coder') {
                  addStep(sessionId, { type: 'complete', label: 'Code genere' });
                } else if (agent.status === 'done' && agent.name === 'executor') {
                  addStep(sessionId, { type: 'complete', label: 'Fichiers ecrits' });
                } else if (agent.status === 'done' && agent.name === 'tester') {
                  addStep(sessionId, { type: 'complete', label: 'Tests valides' });
                }
              }
            }

            const totalProgress = event.agents.reduce((sum, a) => sum + a.progress, 0);
            const overallProgress = Math.round(30 + (totalProgress / event.agents.length) * 0.7);
            setProjectProgress(projectId, overallProgress);

            const doneAgents = event.agents.filter((a) => a.status === 'done');
            const runningAgent = event.agents.find((a) => a.status === 'running');
            const total = event.agents.length;
            const pct = total > 0 ? Math.round((doneAgents.length / total) * 100) : 0;

            const statusLine = runningAgent
              ? (runningAgent.name === 'coder' ? 'Generation du code...'
                : runningAgent.name === 'tester' ? 'Tests qualite...'
                : runningAgent.name === 'executor' ? 'Ecriture des fichiers...'
                : runningAgent.message || runningAgent.name)
              : doneAgents.length === total ? 'Finalisation...' : 'En cours...';

            const nextContent =
              '**' + (lastPlan?.title || projectName) + '**\n\n' +
              statusLine + ' ' + pct + '%\n\n' +
              doneAgents.length + '/' + total + ' etapes terminees';
            updateConversationMessage(aiMessageId, { content: nextContent });
          },

          onComplete: async () => {
            // SSE stream completed — stop background tracker (no longer needed)
            generationTracker.untrack(projectId);

            // Sync generated files into the store
            if (localPath) {
              try {
                await loadProjectFromDisk(projectId);
              } catch (syncErr) {
                console.warn('Could not sync project files from disk:', syncErr);
              }
            }

            // Auto-verify after generation
            if (localPath) {
              try {
                await runService.executeVerifyPipeline({ projectId, projectPath: localPath });
              } catch (verifyErr) {
                console.warn('Auto verify failed to start:', verifyErr);
              }
            }
          },

          onError: (errorMsg) => {
            generationTracker.untrack(projectId);
            throw new Error(errorMsg);
          },
        },
        localPath
      );

      if (!plan) throw new Error('Erreur lors de la génération');

      // Done
      setProjectStatus(projectId, 'complete');
      setProjectProgress(projectId, 100);
      updateProject(projectId, {
        name: plan.title || projectName,
        description: plan.overview || content,
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      addStep(sessionId, { type: 'complete', label: `Projet genere en ${elapsed}s` });
      endSession(sessionId, 'done');

      const nextContent =
        `**${plan.title || projectName}** - Projet pret !\n\n` +
        `${plan.files.length} fichiers crees en ${elapsed}s.\n\n` +
        `Tu peux ouvrir le projet depuis la barre laterale pour explorer les fichiers et le code.`;
      updateConversationMessage(aiMessageId, {
        content: nextContent,
        isStreaming: false,
        activitySessionId: sessionId,
        routingInfo: {
          provider: 'deepseek',
          taskType: 'project_generation',
          wasFallback: false,
          reason: 'multi-agent pipeline',
        },
      });

      useProjectStore.getState().setActiveProject(projectId);
      setSelectedProjectId(projectId);

      // UX pro: proposer d'ouvrir le workspace seulement si l'utilisateur a cliqué sur "Générer un projet"
      if (lastProjectGenerationWasUserActionRef.current) {
        lastProjectGenerationWasUserActionRef.current = false;
        try {
          const { confirm } = await import('@tauri-apps/api/dialog');
          const ok = await confirm(
            `Projet généré : ${plan.title || projectName}\n\nOuvrir le workspace maintenant ?`,
            { title: 'Projet prêt', type: 'info' as any }
          );
          if (ok) navigate(`/projects/${projectId}`);
        } catch {
          // ignore
        }
      }

    } catch (error: any) {
      const isAbort = error?.name === 'AbortError';
      const errorMsg = error?.message || 'Erreur lors de la generation';

      if (isAbort) {
        // User explicitly cancelled — stop tracking, backend will also stop
        generationTracker.untrack(projectId);
      } else {
        // Real error (network, credits, etc.) — stop tracking
        generationTracker.untrack(projectId);
      }

      addStep(sessionId, { type: 'error', label: errorMsg.slice(0, 80) });
      endSession(sessionId, 'error');
      setProjectStatus(projectId, 'error', errorMsg);

      const isCredit = /solde|insuffisant|credit|402|epuis/i.test(errorMsg);
      const nextContent = isAbort
        ? 'Generation annulee.'
        : isCredit
          ? 'Credits insuffisants. Recharge ton compte pour continuer.'
          : 'Une erreur est survenue. Verifie ta connexion et reessaie.';
      updateConversationMessage(aiMessageId, {
        content: nextContent,
        isStreaming: false,
        isError: true,
        activitySessionId: sessionId,
      });
    } finally {
      // Reset l'override après usage (évite de réutiliser un vieux dossier par accident)
      projectBaseDirOverrideRef.current = null;
      setIsGenerating(false);
    }
  }, [
    selectedModel,
    createProject,
    updateAgentStatus,
    setProjectStatus,
    setProjectProgress,
    updateProject,
    loadProjectFromDisk,
    addStep,
    completeStep,
    endSession,
    ensureActiveConversation,
    addConversationMessage,
    updateConversationMessage,
    setIsGenerating,
    navigate,
  ]);

  // ========================================================================
  // MAIN MESSAGE HANDLER
  // ========================================================================

  const handleSendMessage = useCallback(async (
    content: string,
    hasImages = false,
    opts?: { skipUserMessage?: boolean; userMessageId?: string; attachments?: ChatAttachment[] }
  ): Promise<boolean> => {
    if (!content.trim()) return false;

    // Assure une conversation active (sinon l'historique Sidebar ne suivra pas)
    ensureActiveConversation();
    setIsGenerating(true);

    const userMessageId = opts?.userMessageId || `msg_${Date.now()}`;

    if (!isEffectivelyOnline) {
      // En mode "retry" (pas de doublon dans le chat) => toast uniquement
      if (opts?.skipUserMessage) {
        toast.error("Hors ligne - impossible d'envoyer pour le moment.");
        setPendingRetry({
          userMessageId,
          content,
          hasImages,
          model: selectedModel,
          attempts: 1,
          lastError: 'offline',
        });
        setIsGenerating(false);
        return false;
      }
      addConversationMessage({
        id: `msg_${Date.now() + 1}`,
        role: 'assistant',
        content: 'Hors ligne - connecte-toi à internet pour continuer. Tu peux préparer ton message et réessayer.',
        timestamp: Date.now(),
        isError: true,
        model: selectedModel,
      });
      setIsGenerating(false);
      return false;
    }

    if (!opts?.skipUserMessage) {
      const atts = (opts?.attachments || []).slice(0, 8).map((a, idx) => ({
        ...a,
        ref: String.fromCharCode(65 + idx),
      }));
      const userMessage: Message = {
        id: userMessageId,
        content,
        role: 'user',
        timestamp: Date.now(),
        model: selectedModel,
        attachments: atts.length > 0 ? atts : undefined,
      };
      addConversationMessage(userMessage);
    }
    const startTime = Date.now();

    // ── Start activity session ──
    const sessionId = `chat-${Date.now()}`;
    const sessionLabel = content.length > 60 ? content.slice(0, 60) + '...' : content;
    startSession(sessionId, sessionLabel);

    // ══════════════════════════════════════════════════════════════
    // INTENT DETECTION: est-ce une demande de génération de projet ?
    // ══════════════════════════════════════════════════════════════
    const forceProject = forceProjectGenerationOnceRef.current;
    if (forceProject) forceProjectGenerationOnceRef.current = false;

    if (forceProject || detectProjectIntent(content)) {
      const detectStepId = addStep(sessionId, {
        type: 'understanding',
        label: 'Preparation du projet',
      });
      completeStep(sessionId, detectStepId);

      // Route vers le pipeline multi-agents
      await handleProjectGeneration(content, userMessageId, sessionId);
      return true;
    }

    // ══════════════════════════════════════════════════════════════
    // INTENT DETECTION: demande visuelle → routage vers Kimi
    // ══════════════════════════════════════════════════════════════
    const isVisualRequest = detectVisualIntent(content);

    // ══════════════════════════════════════════════════════════════
    // DEFAULT: Chat normal avec tool calling
    // ══════════════════════════════════════════════════════════════

    // Step 1: Understanding
    const understandStepId = addStep(sessionId, {
      type: 'understanding',
      label: isVisualRequest ? 'Détection de demande visuelle' : 'Compréhension de la demande',
    });

      // Build API messages - le routeur injecte le prompt système optimisé pour le cache
    const history = useChatStore
      .getState()
      .getMessagesForAPI()
      .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'system');

    const systemPrompt = isVisualRequest
      ? `Tu es ANZAR, un assistant IA expert en création de contenu visuel. Tu es spécialisé dans la génération d'images, diagrammes, schémas, graphiques et illustrations.

Quand on te demande un diagramme ou schéma :
- Utilise le format Mermaid (entre des blocs \`\`\`mermaid) pour les diagrammes de flux, séquence, classe, état, ER, Gantt, pie charts, mind maps, etc.
- Utilise SVG (entre des blocs \`\`\`svg ou \`\`\`html) pour les illustrations personnalisées, infographies ou visuels complexes.
- Structure le diagramme de manière claire et lisible avec des labels en français.

Quand on te demande une image ou illustration :
- Décris l'image en détail et génère un SVG si possible.
- Pour les graphiques de données, utilise Mermaid pie/bar/line charts.

Quand on te demande un organigramme, flowchart ou carte mentale :
- Utilise Mermaid flowchart (graph TD/LR) ou mindmap.

Réponds TOUJOURS avec le contenu visuel demandé (Mermaid ou SVG), accompagné d'une brève explication. Ne te contente jamais de décrire — génère le visuel.`
      : "Tu es ANZAR, un assistant IA intelligent. Tu peux chercher des informations sur le web. Si tu proposes des commandes, mets-les dans un bloc ```bash```.";

      const rawMessages = [
      {
        role: 'system' as const,
        content: systemPrompt,
      },
      ...history.map((m) => ({ role: m.role as any, content: m.content })),
    ];
    const apiMessages = aiRouter.prepareMessages(rawMessages);

    completeStep(sessionId, understandStepId);

    // Create placeholder AI message for streaming with activity link
    const aiMessageId = `msg_${Date.now() + 1}`;
    addConversationMessage({
      id: aiMessageId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      model: selectedModel,
      isStreaming: true,
      activitySessionId: sessionId,
    });
    // Real-time streaming state in store (token-by-token)
    startStreamingMessage(aiMessageId);
    updateStreamingContent('');

    // Routing info captured during stream
    let routingProvider = isVisualRequest ? 'kimi' : 'deepseek';
    let routingTaskType = isVisualRequest ? 'visual' : 'chat';
    let routingReason = isVisualRequest ? 'visual-intent-detected' : '';
    let routingWasFallback = false;

    try {
      let fullContent = '';
      let reasoningContent = '';

      // Step 2: Routing / Classification
      const routingStepId = addStep(sessionId, {
        type: 'analyzing',
        label: isVisualRequest ? 'Routage vers Kimi (visuel)' : 'Classification de la tache',
      });

      completeStep(sessionId, routingStepId);
      addStep(sessionId, { type: 'planning', label: isVisualRequest ? 'Génération du contenu visuel' : 'Recherche et redaction' });

      // Route: Kimi pour le visuel, DeepSeek smartChat pour le reste
      if (isVisualRequest) {
        const resp = await aiService.chat(apiMessages as any, {
          provider: 'kimi',
          model: selectedModel,
          temperature: 0.7,
        });
        fullContent = resp?.choices?.[0]?.message?.content || '';
      } else {
        const modelId = aiService.resolveModel('deepseek', selectedModel);

        const resp = await aiService.smartChat(apiMessages as any, {
          model: modelId,
          temperature: 0.7,
        });

        fullContent = resp?.choices?.[0]?.message?.content || '';
        reasoningContent = resp?.choices?.[0]?.message?.reasoning_content || '';

        // Extract bash commands from response and create command cards
        const ensureCard = useCommandStore.getState().ensureCard;
        const bashRegex = /```(?:bash|sh|shell)\n([\s\S]*?)```/g;
        let cmdMatch: RegExpExecArray | null;
        let cardIdx = 0;
        while ((cmdMatch = bashRegex.exec(fullContent)) !== null) {
          const cmds = cmdMatch[1].trim().split('\n').filter((l: string) => l.trim() && !l.trim().startsWith('#'));
          for (const cmd of cmds) {
            const cardId = `${aiMessageId}::tool::${cardIdx++}`;
            ensureCard({
              id: cardId,
              messageId: aiMessageId,
              command: cmd.trim(),
              title: 'Commande proposee',
              projectId: selectedProjectId,
              projectPath: selectedProjectPath,
            });
            if (selectedProjectPath) {
              const auto = shouldAutoRunCommand(cmd.trim(), settings);
              if (auto.ok) void commandCardService.run(cardId);
            }
          }
        }
      } // end else (DeepSeek path)

      addStep(sessionId, { type: 'complete', label: `Terminé (${((Date.now() - startTime) / 1000).toFixed(1)}s)` });
      endSession(sessionId, 'done');

      // Stream the final content progressively (token-by-token UX)
      // Note: tool calling itself is non-streaming, but we still render the answer incrementally.
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      if (fullContent.length <= 420) {
        // Réponse courte => afficher immédiatement (plus fluide)
        updateStreamingContent(fullContent);
      } else {
        // Réponse longue => incrémental mais rapide (évite une attente artificielle)
        const chunkSize = 80;
        for (let i = 0; i < fullContent.length; i += chunkSize) {
          if (!useChatStore.getState().isGenerating) break;
          appendStreamingContent(fullContent.slice(i, i + chunkSize));
          // Yield de temps en temps pour garder l'UI réactive
          if (i % (chunkSize * 6) === 0) await sleep(0);
        }
      }
      // Finalize (marks message as non-streaming + clears streamingContent/isGenerating)
      finalizeStreamingMessage();
      // Persist metadata after finalize (routing/activity + reasoning)
      const msgUpdate: Record<string, any> = {
        activitySessionId: sessionId,
        routingInfo: {
          provider: routingProvider,
          taskType: routingTaskType,
          wasFallback: routingWasFallback,
          reason: routingReason || 'smart-chat-with-search',
        },
      };
      if (reasoningContent) {
        msgUpdate.reasoning = [reasoningContent];
        msgUpdate.thinking = true;
      }
      updateConversationMessage(aiMessageId, msgUpdate);

      // Track usage (approx)
      const inputTokens = Math.ceil(apiMessages.reduce((sum, m) => sum + (m.content?.length || 0), 0) / 4);
      const outputTokens = Math.ceil(fullContent.length / 4);
      const cost = aiRouter.estimateCost(routingProvider as any, selectedModel, inputTokens, outputTokens);
      addUsageRecord({
        timestamp: Date.now(),
        provider: routingProvider as any,
        model: selectedModel,
        taskType: routingTaskType,
        inputTokens,
        outputTokens,
        costUSD: cost.costUSD,
        costFCFA: cost.costFCFA,
        wasFallback: routingWasFallback,
        durationMs: Date.now() - startTime,
      });

      // Si un retry était en attente et qu'on a réussi, on le clear
      if (useChatStore.getState().pendingRetry?.userMessageId === userMessageId) {
        setPendingRetry(null);
      }
      return true;

    } catch (error: any) {
      // End activity session with error
      addStep(sessionId, {
        type: 'error',
        label: error.name === 'AbortError' ? 'Arrêté par l\'utilisateur' : `Erreur: ${error.message?.slice(0, 80) || 'Connexion échouée'}`,
      });
      endSession(sessionId, 'error');

      const isCreditErr = /solde|insuffisant|credit|402|epuis/i.test(error.message || '');
      const errorContent = error.name === 'AbortError'
        ? "Generation annulee."
        : isCreditErr
          ? "Credits insuffisants. Recharge ton compte pour continuer."
          : "Une erreur est survenue. Verifie ta connexion et reessaie.";

      // Stop any pending UI streaming
      useChatStore.getState().stopGeneration();
      updateConversationMessage(aiMessageId, {
        content: errorContent,
        isStreaming: false,
        isError: true,
        activitySessionId: sessionId,
      });

      // Si c'est un problème réseau, on prépare un retry automatique (discret)
      const msg = String(error?.message || '');
      const looksNetwork =
        /hors ligne/i.test(msg) ||
        /failed to fetch/i.test(msg) ||
        /timeout/i.test(msg) ||
        /connexion échouée/i.test(msg) ||
        /network/i.test(msg);
      if (looksNetwork) {
        const prev = useChatStore.getState().pendingRetry;
        const prevAttempts = prev?.userMessageId === userMessageId ? prev.attempts : 0;
        if (prevAttempts < 2) {
          setPendingRetry({
            userMessageId,
            content,
            hasImages,
            model: selectedModel,
            attempts: prevAttempts + 1,
            lastError: msg,
          });
        }
        if (!prev) {
          toast('Connexion instable - réessai automatique dès que possible.', { id: 'net-auto' });
        }
      }
      return false;
    } finally {
      setIsGenerating(false);
    }
  }, [
    selectedModel,
    addUsageRecord,
    startSession,
    endSession,
    addStep,
    completeStep,
    handleProjectGeneration,
    ensureActiveConversation,
    addConversationMessage,
    updateConversationMessage,
    selectedProjectId,
    selectedProjectPath,
    settings,
    setIsGenerating,
    startStreamingMessage,
    updateStreamingContent,
    appendStreamingContent,
    finalizeStreamingMessage,
    isEffectivelyOnline,
    setPendingRetry,
  ]);

  /**
   * Réessayer depuis un message assistant (souvent un message d'erreur)
   * - retrouve le dernier message user avant ce message assistant
   * - relance sans re-poster le message user (évite les doublons)
   */
  const handleRegenerateMessage = useCallback(async (assistantMessageId: string) => {
    const conv = useChatStore.getState().getActiveConversation();
    const list = (conv?.messages || []).filter((m) => m.role !== 'tool');
    const idx = list.findIndex((m) => m.id === assistantMessageId);
    if (idx <= 0) {
      toast.error('Impossible de retrouver le message à réessayer.');
      return;
    }
    const prevUser = [...list.slice(0, idx)].reverse().find((m) => m.role === 'user');
    if (!prevUser) {
      toast.error('Impossible de retrouver la question précédente.');
      return;
    }
    // On efface un retry en attente (l'utilisateur reprend la main)
    setPendingRetry(null);
    await handleSendMessage(prevUser.content, false, { skipUserMessage: true, userMessageId: prevUser.id });
  }, [handleSendMessage, setPendingRetry]);

  /**
   * Auto-retry discret: dès que l'on redevient online, relancer une fois.
   */
  const autoRetryInFlightRef = useRef(false);
  useEffect(() => {
    if (!isEffectivelyOnline) return;
    if (!pendingRetry) return;
    if (isLoading) return;
    if (pendingRetry.attempts >= 2) return;
    if (autoRetryInFlightRef.current) return;

    autoRetryInFlightRef.current = true;
    toast.loading("Reconnexion... Reessai en cours", { id: 'net-retry' });
    void (async () => {
      try {
        const ok = await handleSendMessage(pendingRetry.content, pendingRetry.hasImages, {
          skipUserMessage: true,
          userMessageId: pendingRetry.userMessageId,
        });
        if (ok) {
          setPendingRetry(null);
          toast.success('Reconnexion OK', { id: 'net-retry' });
        } else {
          toast.dismiss('net-retry');
        }
      } finally {
        autoRetryInFlightRef.current = false;
      }
    })();
  }, [isEffectivelyOnline, pendingRetry, isLoading, handleSendMessage, setPendingRetry]);

  const handleStopGeneration = useCallback(() => {
    // Stop normal chat streaming
    aiRouter.stopStream();
    // Also abort any running project generation (SSE stream + planning fetch)
    projectGeneration.abort();
    useChatStore.getState().stopGeneration();
    setIsGenerating(false);
  }, [setIsGenerating]);

  const handleQuickStart = useCallback((prompt: string) => {
    handleSendMessage(prompt);
  }, [handleSendMessage]);




  return (
    <div className="h-full min-h-0 flex flex-col bg-bg-primary">
      {/* Chat area */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {!isEffectivelyOnline && (
          <div className="px-4 pt-3">
            <div className="max-w-4xl mx-auto rounded-xl border border-border-subtle bg-surface-default/70 backdrop-blur px-4 py-2 flex items-center gap-2 text-xs text-text-secondary">
              <WifiOff size={14} className="text-text-muted" />
              <span>
                {settings.offlineMode ? 'Mode hors ligne activé.' : 'Hors ligne.'} Certaines fonctionnalités réseau sont désactivées.
              </span>
            </div>
          </div>
        )}
        {messages.length === 0 && showWelcome ? (
          /* ===== WELCOME SCREEN ===== */
          <div className="flex-1 flex flex-col items-center justify-center px-6 overflow-y-auto">
            {/* Hero section */}
            <div className="text-center mb-10 max-w-2xl">
              {/* Logo */}
              <div className="relative inline-block mb-6">
                <div className="w-16 h-16 rounded-2xl gradient-bg flex items-center justify-center animate-float shadow-lg">
                  <Wand2 className="w-8 h-8 text-white" />
                </div>
                <div className="absolute inset-0 w-16 h-16 rounded-2xl gradient-bg opacity-25 blur-xl" />
              </div>

              {/* Title */}
              <h1 className="text-3xl sm:text-4xl font-bold text-text-primary mb-3">
                Imagine. <span className="gradient-text">ANZAR</span> construit.
              </h1>

              <p className="text-base text-text-secondary max-w-md mx-auto">
                Dis ce que tu veux créer. Ton assistant IA transforme chaque idée en réalité.
              </p>
            </div>

            {/* Feature cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 w-full max-w-6xl mb-10">
              {FEATURES.map((feature, idx) => {
                const Icon = feature.icon;
                return (
                  <button
                    key={idx}
                    onClick={() => {
                      if (feature.title === 'Assistant Étudiant') {
                        setShowStudentMenu(true);
                      } else if (feature.title === 'Analyser des données') {
                        setShowDataMenu(true);
                      } else if (feature.title === 'Recherche intelligente') {
                        setShowSearchMenu(true);
                      } else if (feature.title === 'Rédiger un document') {
                        setShowDocumentMenu(true);
                      } else if (feature.title === 'Importer un dossier') {
                        void handleImportFolder();
                      } else if (feature.title === 'Générer un projet') {
                        setShowProjectWizard(true);
                      } else {
                        handleQuickStart(feature.prompt || feature.title);
                      }
                    }}
                    className={cn(
                      'group p-4 rounded-xl border border-border-subtle',
                      'bg-surface-default hover:bg-surface-hover',
                      'transition-all duration-300 text-left',
                      'hover:border-accent-primary/30 hover:shadow-lg',
                      'card-hover',
                    )}
                  >
                    <div className={cn(
                      'w-10 h-10 rounded-xl bg-gradient-to-br flex items-center justify-center mb-3',
                      'group-hover:scale-110 transition-transform duration-300 shadow-md',
                      feature.color
                    )}>
                      <Icon size={20} className="text-white" />
                    </div>
                    <p className="text-sm font-semibold text-text-primary mb-1">
                      {feature.title}
                    </p>
                    <p className="text-[11px] text-text-muted leading-relaxed">
                      {feature.description}
                    </p>
                  </button>
                );
              })}
            </div>

            {/* Quick start suggestions */}
            <div className="flex flex-wrap justify-center gap-2 w-full max-w-4xl">
              {QUICK_STARTS.map((prompt, idx) => (
                <button
                  key={idx}
                  onClick={() => handleQuickStart(prompt)}
                  className={cn(
                    'px-3 py-1.5 rounded-full text-xs',
                    'bg-surface-default border border-border-subtle',
                    'text-text-secondary hover:text-text-primary',
                    'hover:bg-surface-hover hover:border-accent-primary/30',
                    'transition-all duration-200',
                  )}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* ===== MESSAGE LIST ===== */
          <MessageList
            messages={messages}
            isLoading={isLoading}
            selectedProjectId={selectedProjectId}
            selectedProjectPath={selectedProjectPath}
            onRegenerateMessage={handleRegenerateMessage}
          />
        )}
      </div>

      {/* ===== INPUT BAR ===== */}
      <div className="flex-shrink-0">
        <VerifyFixNotice />
        <ChatInput
          onSendMessage={async (msg, attachments) => { await handleSendMessage(msg, false, { attachments }); }}
          onStopGeneration={handleStopGeneration}
          isLoading={isLoading}
          isOnline={isEffectivelyOnline}
          selectedModel={selectedModel}
          onModelChange={setSelectedModel}
          selectedProjectId={selectedProjectId}
          onSelectProject={setSelectedProjectId}
          placeholder="Décris ta tâche, ANZAR s'en occupe..."
        />
      </div>

      <BackgroundTasksDock />

      {/* ===== STUDENT ASSISTANT MENU (modal overlay) ===== */}
      {showStudentMenu && (
        <FeatureMenuModal
          title="Assistant Étudiant"
          subtitle="Choisis ce dont tu as besoin"
          icon={GraduationCap}
          iconColor="from-pink-500 to-rose-500"
          options={STUDENT_OPTIONS}
          onSelect={(opt) => {
            setShowStudentMenu(false);
            // Pour "Corriger / Reformuler": on évite d'envoyer un message séparé
            // puis un second "Analyse les pièces jointes.".
            // On demande au ChatInput d'ouvrir le picker puis d'envoyer UN seul message
            // (prompt + pièces jointes) dès qu'un fichier est ajouté.
            if ((opt as any).opensFileDialog) {
              window.dispatchEvent(new CustomEvent('anzar:compose-with-attachments', {
                detail: { text: opt.prompt, autoSend: true },
              }));
              return;
            }
            handleSendMessage(opt.prompt);
          }}
          onClose={() => setShowStudentMenu(false)}
        />
      )}

      {/* ===== DATA ANALYSIS MENU (modal overlay) ===== */}
      {showDataMenu && (
        <FeatureMenuModal
          title="Analyser des données"
          subtitle="Choisis ton type d'analyse"
          icon={BarChart3}
          iconColor="from-emerald-500 to-teal-500"
          options={DATA_OPTIONS}
          onSelect={(opt) => {
            setShowDataMenu(false);
            if ((opt as any).opensFileDialog) {
              window.dispatchEvent(new CustomEvent('anzar:compose-with-attachments', {
                detail: { text: opt.prompt, autoSend: true },
              }));
              return;
            }
            handleSendMessage(opt.prompt);
          }}
          onClose={() => setShowDataMenu(false)}
        />
      )}

      {/* ===== SEARCH MENU (modal overlay) ===== */}
      {showSearchMenu && (
        <FeatureMenuModal
          title="Recherche intelligente"
          subtitle="Quel type de recherche ?"
          icon={Globe}
          iconColor="from-blue-500 to-cyan-500"
          options={SEARCH_OPTIONS}
          onSelect={(opt) => { setShowSearchMenu(false); handleSendMessage(opt.prompt); }}
          onClose={() => setShowSearchMenu(false)}
        />
      )}

      {/* ===== PROJECT WIZARD (modal overlay) ===== */}
      {showProjectWizard && (
        <ProjectWizardModal
          onClose={() => setShowProjectWizard(false)}
          onGenerate={async (prompt, projectName, projectType, techs) => {
            setShowProjectWizard(false);
            await prepareProjectGeneration();
            forceProjectGenerationOnceRef.current = true;
            wizardMetaRef.current = { projectType, techs };

            // Show a clean user message instead of the full technical prompt
            const displayMessage = `Genere le projet "${projectName}"`;
            ensureActiveConversation();
            const userMsgId = `msg_${Date.now()}`;
            addConversationMessage({
              id: userMsgId,
              content: displayMessage,
              role: 'user',
              timestamp: Date.now(),
              model: selectedModel,
            });

            // Send the full prompt to the pipeline but skip adding another user message
            handleSendMessage(prompt, false, { skipUserMessage: true, userMessageId: userMsgId });
          }}
        />
      )}

      {/* ===== DOCUMENT MENU (modal overlay) ===== */}
      {showDocumentMenu && (
        <FeatureMenuModal
          title="Rédiger un document"
          subtitle="Quel document veux-tu créer ?"
          icon={FileText}
          iconColor="from-orange-500 to-amber-500"
          options={DOCUMENT_OPTIONS}
          onSelect={(opt) => {
            setShowDocumentMenu(false);
            if ((opt as any).opensFileDialog) {
              window.dispatchEvent(new CustomEvent('anzar:compose-with-attachments', {
                detail: { text: opt.prompt, autoSend: true },
              }));
              return;
            }
            handleSendMessage(opt.prompt);
          }}
          onClose={() => setShowDocumentMenu(false)}
        />
      )}
    </div>
  );
}

/* ===== Reusable Feature Menu Modal ===== */
interface SubOption {
  id: string;
  label: string;
  description: string;
  emoji: string;
  prompt: string;
}

interface FeatureOption {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  color: string;
  prompt: string;
  opensFileDialog?: boolean;
  tag?: string;
  subOptions?: SubOption[];
}

function FeatureMenuModal({
  title, subtitle, icon: TitleIcon, iconColor, options, onSelect, onClose,
}: {
  title: string;
  subtitle: string;
  icon: React.ElementType;
  iconColor: string;
  options: FeatureOption[];
  onSelect: (option: FeatureOption) => void;
  onClose: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const [expandedSub, setExpandedSub] = useState<string | null>(null);
  const idsRef = useRef({
    titleId: `modal_title_${Math.random().toString(16).slice(2)}`,
    descId: `modal_desc_${Math.random().toString(16).slice(2)}`,
  });

  // UX grand public: Escape ferme le modal + focus initial sur "fermer" + focus trap Tab
  useEffect(() => {
    closeButtonRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const root = modalRef.current;
        if (!root) return;
        const focusables = Array.from(
          root.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => !el.hasAttribute('disabled') && el.tabIndex !== -1);
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey) {
          if (!active || active === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (active === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={modalRef}
        className="bg-bg-primary border border-border-subtle rounded-2xl shadow-2xl w-full max-w-2xl mx-4 p-6 animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idsRef.current.titleId}
        aria-describedby={idsRef.current.descId}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className={cn('w-10 h-10 rounded-xl bg-gradient-to-br flex items-center justify-center shadow-md', iconColor)}>
              <TitleIcon size={20} className="text-white" />
            </div>
            <div>
              <h2 id={idsRef.current.titleId} className="text-lg font-bold text-text-primary">{title}</h2>
              <p id={idsRef.current.descId} className="text-xs text-text-muted">{subtitle}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            ref={closeButtonRef}
            className="p-2 rounded-lg hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Options grid — or sub-options panel when expanded */}
        {expandedSub ? (
          (() => {
            const parent = options.find((o) => o.id === expandedSub);
            if (!parent?.subOptions) return null;
            return (
              <div className="space-y-3">
                {/* Back button */}
                <button
                  onClick={() => setExpandedSub(null)}
                  className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary transition-colors mb-1"
                >
                  <ChevronLeft size={14} />
                  Retour aux options
                </button>
                <p className="text-sm font-semibold text-text-primary mb-2">
                  {parent.title} — choisis le type :
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {parent.subOptions.map((sub) => (
                    <button
                      key={sub.id}
                      onClick={() => {
                        // Build a synthetic FeatureOption from the sub-option
                        onSelect({
                          ...parent,
                          id: sub.id,
                          title: sub.label,
                          description: sub.description,
                          prompt: sub.prompt,
                          opensFileDialog: true,
                        });
                      }}
                      className={cn(
                        'group flex items-start gap-3 p-4 rounded-xl border border-border-subtle',
                        'bg-surface-default hover:bg-surface-hover',
                        'transition-all duration-200 text-left',
                        'hover:border-emerald-500/40 hover:shadow-md',
                      )}
                    >
                      <span className="text-2xl flex-shrink-0 group-hover:scale-110 transition-transform duration-200">
                        {sub.emoji}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-text-primary mb-0.5">
                          {sub.label}
                        </p>
                        <p className="text-[11px] text-text-muted leading-relaxed">
                          {sub.description}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            );
          })()
        ) : (
          <div className={cn(
            'grid gap-3',
            options.length <= 4 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
          )}>
            {options.map((option) => {
              const Icon = option.icon;
              return (
                <button
                  key={option.id}
                  onClick={() => {
                    if (option.subOptions && option.subOptions.length > 0) {
                      setExpandedSub(option.id);
                    } else {
                      onSelect(option);
                    }
                  }}
                  className={cn(
                    'group flex items-start gap-3 p-4 rounded-xl border border-border-subtle',
                    'bg-surface-default hover:bg-surface-hover',
                    'transition-all duration-200 text-left',
                    'hover:border-accent-primary/30 hover:shadow-md',
                  )}
                >
                  <div className={cn(
                    'w-9 h-9 rounded-lg bg-gradient-to-br flex items-center justify-center flex-shrink-0',
                    'group-hover:scale-110 transition-transform duration-200 shadow-sm',
                    option.color,
                  )}>
                    <Icon size={16} className="text-white" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-sm font-semibold text-text-primary">
                        {option.title}
                      </p>
                      {option.tag && (
                        <span className={cn(
                          'text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full',
                          option.tag === 'Nouveau' && 'bg-accent-primary/15 text-accent-primary',
                          option.tag === 'Upload' && 'bg-emerald-500/15 text-emerald-500',
                          option.tag === 'Populaire' && 'bg-amber-500/15 text-amber-500',
                        )}>
                          {option.tag}
                        </span>
                      )}
                      {option.subOptions && (
                        <ChevronRight size={12} className="text-text-muted ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                      )}
                    </div>
                    <p className="text-[11px] text-text-muted leading-relaxed">
                      {option.description}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

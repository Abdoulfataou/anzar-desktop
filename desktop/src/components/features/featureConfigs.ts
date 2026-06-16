/**
 * Feature configurations for the autonomous FeatureAssistant components.
 * Extracted from ChatView's DATA_OPTIONS, SEARCH_OPTIONS, DOCUMENT_OPTIONS.
 */

import {
  BarChart3, Table2, TrendingUp, PieChart, Filter,
  Globe, Search, Newspaper, HelpCircle, Scale,
  FileText, Mail, FileCheck, ScrollText, Megaphone, Briefcase, Pen,
} from 'lucide-react';
import type { FeatureConfig } from './FeatureAssistant';

export const DATA_CONFIG: FeatureConfig = {
  title: 'Analyser des données',
  subtitle: 'Choisis ton type d\'analyse',
  icon: BarChart3,
  iconColor: 'from-emerald-500 to-teal-500',
  options: [
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
  ],
};

export const SEARCH_CONFIG: FeatureConfig = {
  title: 'Recherche intelligente',
  subtitle: 'Quel type de recherche ?',
  icon: Globe,
  iconColor: 'from-blue-500 to-cyan-500',
  options: [
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
  ],
};

export const DOCUMENT_CONFIG: FeatureConfig = {
  title: 'Rédiger un document',
  subtitle: 'Quel document veux-tu créer ?',
  icon: FileText,
  iconColor: 'from-orange-500 to-amber-500',
  options: [
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
  ],
};

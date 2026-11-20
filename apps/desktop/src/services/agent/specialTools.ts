/**
 * Outils spéciaux de l'agent qui ne passent pas par l'exécuteur local :
 * questions à l'utilisateur, chargement de skill et proposition de plan.
 * La partie décisionnelle est ici ; l'UI (setQuestion, updateMessage) reste
 * dans l'adaptateur de chat.
 */
import type { AgentQuestion, QuestionAnswer } from './questions';
import { formatAnswers, parseQuestions } from './questions';
import { findSkill, readSkillFile, skillToolOutput, type Skill } from '@/services/skills';
import { SKILL_RESULT_PREFIX } from './history';

export interface ToolOutput {
  output: string;
  isError?: boolean;
}

export interface AskUserOptions {
  background: boolean;
  /** Appelé avant l'attente, pour afficher les questions et le résumé. */
  onQuestions?: (questions: AgentQuestion[], summary: string) => void;
  requestAnswers: (questions: AgentQuestion[]) => Promise<QuestionAnswer[] | null>;
}

/** Outil ask_user : attend les réponses, ou choisit le recommandé en arrière-plan. */
export async function askUser(args: Record<string, any>, options: AskUserOptions): Promise<ToolOutput> {
  const questions = parseQuestions(args);
  if (!questions.length) {
    return {
      output: "Erreur : il faut au moins une question avec 2 options (questions[].question, questions[].options[].label).",
      isError: true,
    };
  }
  if (options.background) {
    return {
      output: "Personne n'est là pour répondre : prends l'option recommandée (ou la plus prudente), continue, et note ce choix dans ton résumé.",
    };
  }

  options.onQuestions?.(questions, questions.map((q) => q.question).join(' · ').slice(0, 140));
  const answers = await options.requestAnswers(questions);
  return {
    output: answers
      ? formatAnswers(answers)
      : "L'utilisateur a passé ces questions : décide toi-même (option recommandée), et indique tes choix dans ta réponse.",
  };
}

/** Outil load_skill : lit une skill du projet ou une de ses pièces jointes. */
export async function loadSkill(args: Record<string, any>, skills: Skill[]): Promise<ToolOutput> {
  const wanted = String(args.name || '').trim();
  const skill = findSkill(skills, wanted);
  const file = typeof args.file === 'string' ? args.file.trim() : '';

  if (!skill) {
    return {
      output: `Skill « ${wanted} » introuvable. Skills disponibles : ${skills.map((sk) => sk.name).join(', ') || 'aucune'}.`,
      isError: true,
    };
  }
  if (!file) return { output: skillToolOutput(skill, SKILL_RESULT_PREFIX) };

  try {
    return { output: `${SKILL_RESULT_PREFIX}${skill.name} » — fichier ${file}\n\n${await readSkillFile(skill, file)}` };
  } catch (e: any) {
    return { output: `Lecture impossible de « ${file} » : ${e?.message || e}`, isError: true };
  }
}

export interface ProposedPlan {
  title: string;
  markdown: string;
  output: string;
}

/** Outil propose_plan : normalise le plan affiché et le texte renvoyé au modèle. */
export function parsePlan(args: Record<string, any>): ProposedPlan {
  return {
    title: String(args.title || 'Plan').slice(0, 80),
    markdown: String(args.plan || '').trim(),
    output: "Plan affiché à l'utilisateur. Arrête-toi ici : il va le valider ou demander des changements.",
  };
}

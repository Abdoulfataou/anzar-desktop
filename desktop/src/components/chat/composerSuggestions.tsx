/**
 * Suggestions de la saisie, comme dans ZCode :
 * - « @ » propose les fichiers du projet ; le fichier choisi est joint au message
 * - « / » en début de message propose des commandes (demandes enregistrées)
 * Les commandes du projet se trouvent dans .anzar/commands/<nom>.md.
 */
import { FileText, Terminal, Wand2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SlashCommand {
  name: string;
  description: string;
  /** Texte de la demande inséré dans la saisie */
  prompt?: string;
  /** Action de l'app au lieu d'un texte (ex. passer en mode plan) */
  action?: 'plan';
  /** Commande définie par le projet (.anzar/commands) */
  custom?: boolean;
}

export const BUILTIN_COMMANDS: SlashCommand[] = [
  { name: 'plan', description: "Passer en mode plan : l'agent explore et propose un plan sans rien modifier", action: 'plan' },
  { name: 'expliquer', description: 'Expliquer le projet : rôle, architecture, fichiers clés',
    prompt: "Explique ce projet : à quoi il sert, son architecture, ses fichiers clés et comment le lancer. Ne modifie rien." },
  { name: 'build', description: 'Lancer le build et corriger les erreurs',
    prompt: "Lance le build du projet. S'il échoue, corrige les erreurs puis relance-le jusqu'à ce qu'il passe." },
  { name: 'test', description: 'Lancer les tests et corriger ce qui échoue',
    prompt: "Lance les tests du projet. S'il y a des échecs, corrige le code (pas les tests, sauf s'ils sont faux) puis relance-les." },
  { name: 'revue', description: 'Revue des changements en cours (bugs, sécurité), sans modifier',
    prompt: "Fais une revue des changements en cours (git diff) : bugs, failles de sécurité, cas oubliés, lisibilité. Classe les problèmes par gravité. Ne modifie rien." },
  { name: 'commit', description: 'Préparer un commit des changements en cours',
    prompt: "Regarde les changements en cours (git status, git diff), puis crée un commit avec un message clair en français qui décrit ce qui a changé et pourquoi." },
];

export type SuggestionQuery =
  | { kind: 'mention'; query: string; start: number }
  | { kind: 'slash'; query: string; start: number };

/** Repère un « @mot » juste avant le curseur, ou un « /mot » en tout début de message. */
export function findSuggestionQuery(text: string, caret: number): SuggestionQuery | null {
  const before = text.slice(0, caret);
  const slash = /^\/([\w-]*)$/.exec(before);
  if (slash) return { kind: 'slash', query: slash[1].toLowerCase(), start: 0 };
  const mention = /(^|\s)@([^\s@]*)$/.exec(before);
  if (mention) return { kind: 'mention', query: mention[2].toLowerCase(), start: before.length - mention[2].length - 1 };
  return null;
}

/** Lettres de la requête présentes dans l'ordre (« src/wal » trouve « src/store/walletStore.js »). */
function isSubsequence(query: string, text: string): boolean {
  let i = 0;
  for (const ch of text) if (ch === query[i]) i++;
  return i === query.length;
}

/** Classement : nom qui commence par la requête, nom qui la contient, chemin qui la contient, lettres dans l'ordre. */
export function rankFiles(files: string[], query: string, limit = 8): string[] {
  if (!query) return files.slice(0, limit);
  const scored: Array<[number, string]> = [];
  for (const f of files) {
    const p = f.toLowerCase();
    const name = p.split('/').pop() || p;
    const score = name.startsWith(query) ? 0 : name.includes(query) ? 1 : p.includes(query) ? 2 : isSubsequence(query, p) ? 3 : -1;
    if (score >= 0) scored.push([score * 1000 + f.length, f]);
  }
  return scored.sort((a, b) => a[0] - b[0]).slice(0, limit).map(([, f]) => f);
}

export function rankCommands(commands: SlashCommand[], query: string): SlashCommand[] {
  return commands.filter((c) => c.name.toLowerCase().startsWith(query) || (query && c.name.toLowerCase().includes(query)));
}

export interface SuggestionItem {
  key: string;
  label: string;
  detail?: string;
  icon: 'file' | 'command' | 'custom';
}

export function SuggestionMenu({
  items, activeIndex, onPick, onHover, title,
}: {
  items: SuggestionItem[];
  activeIndex: number;
  onPick: (index: number) => void;
  onHover: (index: number) => void;
  title: string;
}) {
  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 p-1 rounded-lg border border-border-medium bg-surface-elevated shadow-lg z-50 max-h-72 overflow-y-auto">
      <p className="px-2.5 pt-1.5 pb-1 text-ui-sm text-text-muted">{title}</p>
      <div className="flex flex-col gap-0.5">
        {items.map((it, i) => {
          const Icon = it.icon === 'file' ? FileText : it.icon === 'custom' ? Wand2 : Terminal;
          return (
            <button
              key={it.key}
              type="button"
              // mousedown : choisir sans faire perdre le focus à la saisie
              onMouseDown={(e) => { e.preventDefault(); onPick(i); }}
              onMouseEnter={() => onHover(i)}
              className={cn(
                'flex items-center gap-2.5 h-9 px-2.5 rounded-md text-left transition-colors',
                i === activeIndex ? 'bg-hover-fill' : ''
              )}
            >
              <Icon size={15} className="flex-shrink-0 text-text-secondary" />
              <span className={cn('flex-shrink-0 text-ui-base text-text-primary', it.icon === 'file' ? 'font-mono text-ui-caption' : '')}>
                {it.label}
              </span>
              {it.detail && <span className="min-w-0 truncate text-ui-sm text-text-muted">{it.detail}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

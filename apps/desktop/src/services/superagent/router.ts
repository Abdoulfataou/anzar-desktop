/**
 * Routeur du super-agent : découpe un objectif en tickets indépendants, chacun faisable
 * par un exécutant seul en moins d'une demi-heure. Les tickets proposés arrivent en
 * brouillon : l'utilisateur les relit avant de les mettre en file.
 */
import { aiService } from '@/services/ai/ai';
import type { TicketPriority } from '@/stores/ticketStore';

export interface ProposedTicket {
  title: string;
  description: string;
  priority: TicketPriority;
}

const ROUTER_PROMPT = `Tu es le routeur du super-agent ANZAR. Tu découpes l'objectif de l'utilisateur en tickets pour des exécutants autonomes.

Chaque exécutant travaille SEUL, sans pouvoir poser de question, dans une copie isolée du projet, pendant 30 minutes au plus. Donc chaque ticket :
- est faisable seul et en une fois, et livre quelque chose de vérifiable ;
- a une description autonome : le contexte utile, ce qu'il faut faire, et des critères d'acceptation (liste « Terminé quand : … ») ;
- touche si possible des fichiers différents des autres tickets (ils sont fusionnés l'un après l'autre).
Ordonne les tickets dans l'ordre où ils doivent être faits. Entre 1 et 8 tickets ; un seul si l'objectif est petit. N'invente pas de travail non demandé.
priority : "high" pour ce qui débloque les autres, "normal" sinon, "low" pour le confort.

Réponds UNIQUEMENT en JSON : {"tickets":[{"title":"…","description":"…","priority":"high|normal|low"}]}. Titres courts, à l'infinitif, en français.`;

/** Lit la réponse du modèle de façon tolérante (bloc de code, texte autour). */
export function parseTickets(raw: string): ProposedTicket[] {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  let data: any;
  try { data = JSON.parse(text.slice(start, end + 1)); } catch { return []; }
  const list = Array.isArray(data?.tickets) ? data.tickets : Array.isArray(data) ? data : [];
  return list
    .filter((t: any) => t && typeof t.title === 'string' && t.title.trim())
    .slice(0, 8)
    .map((t: any) => ({
      title: String(t.title).trim().slice(0, 140),
      description: String(t.description || t.title).trim().slice(0, 4_000),
      priority: (['high', 'normal', 'low'].includes(t.priority) ? t.priority : 'normal') as TicketPriority,
    }));
}

export async function splitIntoTickets(goal: string, project: { name: string; codeMap?: string; memory?: string }, signal?: AbortSignal): Promise<{ tickets: ProposedTicket[]; costFCFA?: number }> {
  const context = [
    `# Projet : ${project.name}`,
    project.memory ? `# Mémoire du projet\n${project.memory.slice(0, 4_000)}` : '',
    project.codeMap ? `# Carte du code\n${project.codeMap}` : '',
  ].filter(Boolean).join('\n\n');
  const res: any = await aiService.chat(
    [
      { role: 'system', content: `${ROUTER_PROMPT}\n\n${context}` },
      { role: 'user', content: goal },
    ],
    { model: 'thinking', responseFormat: { type: 'json_object' }, signal },
  );
  const content = res?.choices?.[0]?.message?.content || '';
  const tickets = parseTickets(content);
  if (!tickets.length) throw new Error("Le découpage n'a rien donné. Reformule l'objectif plus concrètement.");
  return { tickets, costFCFA: res?.anzar?.cost_fcfa };
}

/**
 * Conflits d'écriture entre agents.
 *
 * Harness ne détecte pas les écritures concurrentes (voir packages/subagent/tool-subagent :
 * « Bash, formatters, code generators, and scripts can overwrite concurrent edits without
 * conflict detection »). On ajoute le minimum : un agent qui a lu un fichier ne peut pas
 * l'écraser si un **autre** agent l'a modifié depuis cette lecture. Il doit le relire.
 *
 * Le registre est par conversation, en mémoire. Il ne couvre pas les modifications faites
 * hors des outils de l'agent (script, formateur, commande) : ce n'est pas une frontière.
 */
interface FileState {
  version: number;
  writer: string;
}

interface ConversationState {
  files: Map<string, FileState>;
  reads: Map<string, Map<string, number>>;
}

const states = new Map<string, ConversationState>();

function stateFor(convId: string): ConversationState {
  let state = states.get(convId);
  if (!state) {
    state = { files: new Map(), reads: new Map() };
    states.set(convId, state);
  }
  return state;
}

function normalize(path: string): string {
  return String(path || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function currentVersion(state: ConversationState, path: string): number {
  return state.files.get(path)?.version ?? 0;
}

/**
 * Refuse une écriture si un autre agent a modifié le fichier depuis la dernière lecture
 * de cet agent. Retourne le message à renvoyer au modèle, ou null.
 */
export function fileConflict(convId: string, agentId: string, path: string): string | null {
  const rel = normalize(path);
  if (!rel) return null;
  const state = stateFor(convId);
  const readVersion = state.reads.get(agentId)?.get(rel);
  if (readVersion === undefined) return null;
  const file = state.files.get(rel);
  if (!file || file.version === readVersion) return null;
  if (file.writer === agentId) return null;
  return `Le fichier « ${rel} » a été modifié par un autre agent (${file.writer}) depuis ta dernière lecture. `
    + `Relis-le avec read_file avant de l'écrire, puis réapplique ta modification.`;
}

/** Mémorise la version lue par un agent. */
export function noteFileRead(convId: string, agentId: string, path: string): void {
  const rel = normalize(path);
  if (!rel) return;
  const state = stateFor(convId);
  if (!state.reads.has(agentId)) state.reads.set(agentId, new Map());
  state.reads.get(agentId)!.set(rel, currentVersion(state, rel));
}

/** Enregistre une écriture réussie et met à jour la lecture de son auteur. */
export function noteFileWrite(convId: string, agentId: string, path: string): void {
  const rel = normalize(path);
  if (!rel) return;
  const state = stateFor(convId);
  const previous = state.files.get(rel)?.version ?? 0;
  const next = previous + 1;
  state.files.set(rel, { version: next, writer: agentId });
  if (!state.reads.has(agentId)) state.reads.set(agentId, new Map());
  state.reads.get(agentId)!.set(rel, next);
}

/** Tests / fin de conversation. */
export function clearFileConflicts(convId?: string): void {
  if (convId) states.delete(convId);
  else states.clear();
}

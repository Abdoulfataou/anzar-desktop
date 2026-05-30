import type { FileOperation } from '@/types'
import { useChangeStore } from '@/stores/changeStore'

/**
 * Tool executor (A-mode): au lieu d'écrire sur disque, on queue un changeset
 * pour preview/apply par l'utilisateur.
 */
export function createChangeToolExecutor(projectId: string) {
  let batchChangeSetId: string | null = null
  return async (name: string, args: Record<string, any>): Promise<string> => {
    const op = toolCallToOperation(name, args)
    if (!op) {
      return JSON.stringify({ ok: false, error: `Tool inconnu: ${name}` })
    }

    // Batch: regrouper toutes les opérations d'un même message IA dans un seul changeset
    if (!batchChangeSetId) {
      const title = `IA: changements proposés`
      const cs = useChangeStore.getState().queue(projectId, title, [op])
      batchChangeSetId = cs.id
    } else {
      useChangeStore.getState().appendOperations(projectId, batchChangeSetId, [op])
    }

    return JSON.stringify({
      ok: true,
      queued: true,
      changeSetId: batchChangeSetId,
      operation: op,
      message: "Changements en attente (batch). Ouvre 'Runs' → Preview → Appliquer.",
    })
  }
}

function toolCallToOperation(name: string, args: Record<string, any>): FileOperation | null {
  if (name === 'create_file') {
    if (!args?.path || typeof args?.content !== 'string') return null
    return { type: 'create', path: String(args.path), content: String(args.content) }
  }

  if (name === 'edit_file') {
    if (!args?.path || typeof args?.content !== 'string') return null
    return { type: 'edit', path: String(args.path), content: String(args.content) }
  }

  if (name === 'delete_file') {
    if (!args?.path) return null
    return { type: 'delete', path: String(args.path) }
  }

  // Not supported in V1
  return null
}

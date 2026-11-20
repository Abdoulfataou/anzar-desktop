/**
 * Nouvelle tâche — point d'entrée unique (bouton, ⌘N, palette de commandes).
 * Page vierge, pré-remplie avec le projet donné (par défaut : le dernier utilisé) ;
 * le sélecteur au-dessus de la saisie permet d'en changer tant que rien n'est envoyé.
 * Une tâche vide existante est réutilisée plutôt que d'en empiler une autre.
 */
import { useChatStore } from '@/stores/chatStore';
import { useProjectStore } from '@/stores/projectStore';
import { useSettingsStore } from '@/stores/settingsStore';

export function startNewTask(projectId: string | null = useProjectStore.getState().activeProjectId): string {
  const projects = useProjectStore.getState().projects;
  const target = projectId && projects.some((p) => p.id === projectId) ? projectId : null;
  useProjectStore.getState().setActiveProject(target);
  const chat = useChatStore.getState();
  const empty = chat.conversations.find((c) => c.messages.length === 0);
  const convId = empty ? empty.id : chat.createConversation(undefined, useSettingsStore.getState().settings.model).id;
  useChatStore.setState((s) => ({
    activeConversationId: convId,
    conversations: s.conversations.map((c) => {
      if (c.id !== convId) return c;
      const { projectId: _old, ...rest } = c;
      return target ? { ...rest, projectId: target } : rest;
    }),
  }));
  return convId;
}

/**
 * Liste des souvenirs groupés par date
 */
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trash2, MessageSquare } from 'lucide-react';
import { useMemoryStore } from '@/stores/memoryStore';
import { MemoryItem } from '@/types';
import { cn } from '@/lib/utils';

interface ConversationListProps {
  memories: MemoryItem[];
}

function groupByDate(items: MemoryItem[]): Record<string, MemoryItem[]> {
  const now = Date.now();
  const day = 86400000;
  const groups: Record<string, MemoryItem[]> = {};

  for (const item of items) {
    const diff = now - item.timestamp;
    let label: string;
    if (diff < day) label = "Aujourd'hui";
    else if (diff < 2 * day) label = 'Hier';
    else if (diff < 7 * day) label = 'Cette semaine';
    else label = 'Plus ancien';

    if (!groups[label]) groups[label] = [];
    groups[label].push(item);
  }
  return groups;
}

export default function ConversationList({ memories }: ConversationListProps) {
  const { deleteMemory } = useMemoryStore();
  const navigate = useNavigate();

  const grouped = useMemo(() => groupByDate(memories), [memories]);

  const handleClick = (memory: MemoryItem) => {
    // Naviguer vers le chat et charger la conversation
    if (memory.conversationId) {
      navigate('/');
    }
  };

  return (
    <div className="divide-y divide-border-subtle">
      {Object.entries(grouped).map(([label, items]) => (
        <div key={label}>
          <div className="px-6 py-2 text-xs font-medium text-text-muted uppercase tracking-wider bg-surface-default">
            {label}
          </div>
          {items.map((memory) => (
            <div
              key={memory.id}
              onClick={() => handleClick(memory)}
              className={cn(
                'px-6 py-3 flex items-start gap-3 cursor-pointer group',
                'hover:bg-surface-hover transition-colors'
              )}
            >
              <MessageSquare size={16} className="text-text-tertiary mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-primary truncate">{memory.title}</p>
                <p className="text-xs text-text-tertiary mt-0.5 line-clamp-1">{memory.summary}</p>
                {memory.tags.length > 0 && (
                  <div className="flex gap-1 mt-1.5">
                    {memory.tags.slice(0, 3).map((tag) => (
                      <span key={tag} className="px-1.5 py-0.5 text-[10px] rounded bg-surface-default text-text-muted">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); deleteMemory(memory.id); }}
                className="p-1 rounded opacity-0 group-hover:opacity-100 text-text-muted hover:text-accent-error transition-all"
                title="Supprimer"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

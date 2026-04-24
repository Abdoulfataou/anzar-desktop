/**
 * Vue principale du module Mémoire
 * Affiche les souvenirs avec recherche et filtrage par tags
 */
import { useMemo, useState } from 'react';
import { Brain, Search, Tag } from 'lucide-react';
import { useMemoryStore } from '@/stores/memoryStore';
import { MemoryItem } from '@/types';
import ConversationList from './ConversationList';
import { cn } from '@/lib/utils';

export default function MemoryView() {
  const { memories, searchQuery, setSearchQuery, getSearchResults, getAllTags } = useMemoryStore();
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  const results: MemoryItem[] = useMemo(() => {
    let items = getSearchResults();
    if (selectedTag) {
      items = items.filter((m: MemoryItem) => m.tags.includes(selectedTag));
    }
    return items;
  }, [getSearchResults, selectedTag, searchQuery, memories]);

  const allTags: string[] = useMemo(() => getAllTags(), [getAllTags, memories]);

  const totalTokens = useMemo(() => {
    return memories.reduce((sum: number, m: MemoryItem) => sum + (m.summary?.length ?? 0), 0);
  }, [memories]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-border-subtle px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <Brain size={22} className="text-accent-primary" />
            <h1 className="text-lg font-semibold text-text-primary">Mémoire</h1>
          </div>
          <div className="flex items-center gap-3 text-xs text-text-tertiary">
            <span>{memories.length} souvenirs</span>
            <span>~{Math.ceil(totalTokens / 4)} tokens</span>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" size={16} />
          <input
            type="text"
            placeholder="Rechercher dans la mémoire..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={cn(
              'w-full pl-10 pr-4 py-2 rounded-lg text-sm',
              'bg-surface-default border border-border-subtle',
              'text-text-primary placeholder:text-text-muted',
              'focus:outline-none focus:ring-1 focus:ring-accent-primary'
            )}
          />
        </div>

        {/* Tags */}
        {allTags.length > 0 && (
          <div className="flex gap-2 mt-3 flex-wrap">
            {allTags.slice(0, 8).map((tag: string) => (
              <button
                key={tag}
                onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                className={cn(
                  'px-2.5 py-1 rounded-full text-xs font-medium transition-colors',
                  selectedTag === tag
                    ? 'bg-accent-primary text-white'
                    : 'bg-surface-default text-text-secondary hover:bg-surface-hover'
                )}
              >
                <Tag size={10} className="inline mr-1" />
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {results.length > 0 ? (
          <ConversationList memories={results} />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <Brain size={40} className="text-text-muted mb-3 opacity-30" />
            <p className="text-text-secondary text-sm font-medium">Aucun souvenir</p>
            <p className="text-text-muted text-xs mt-1">
              Tes conversations seront sauvegardées ici automatiquement.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

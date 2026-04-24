/**
 * Barre de recherche pour la mémoire
 * Debounced, avec raccourci clavier Cmd+K
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X } from 'lucide-react';
import { useMemoryStore } from '@/stores/memoryStore';
import { cn } from '@/lib/utils';

interface SearchBarProps {
  className?: string;
}

export default function SearchBar({ className }: SearchBarProps) {
  const { searchQuery, setSearchQuery, clearSearch } = useMemoryStore();
  const [localQuery, setLocalQuery] = useState(searchQuery);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Debounce search
  const handleChange = useCallback((value: string) => {
    setLocalQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearchQuery(value), 300);
  }, [setSearchQuery]);

  // Cmd+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const handleClear = () => {
    setLocalQuery('');
    clearSearch();
    inputRef.current?.focus();
  };

  return (
    <div className={cn('relative', className)}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" size={16} />
      <input
        ref={inputRef}
        type="text"
        placeholder="Rechercher... (⌘K)"
        value={localQuery}
        onChange={(e) => handleChange(e.target.value)}
        className={cn(
          'w-full pl-10 pr-10 py-2 rounded-lg text-sm',
          'bg-surface-default border border-border-subtle',
          'text-text-primary placeholder:text-text-muted',
          'focus:outline-none focus:ring-1 focus:ring-accent-primary'
        )}
      />
      {localQuery && (
        <button onClick={handleClear} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary">
          <X size={14} />
        </button>
      )}
    </div>
  );
}

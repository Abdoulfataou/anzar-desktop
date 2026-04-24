import React from 'react';

const TypingIndicator: React.FC = () => {
  return (
    <div className="flex items-center gap-2 px-4 py-3">
      <div className="flex items-center gap-1">
        <div className="w-2 h-2 rounded-full bg-[var(--anzar-accent)] animate-bounce" style={{ animationDelay: '0ms' }} />
        <div className="w-2 h-2 rounded-full bg-[var(--anzar-accent)] animate-bounce" style={{ animationDelay: '150ms' }} />
        <div className="w-2 h-2 rounded-full bg-[var(--anzar-accent)] animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
      <span className="text-sm text-[var(--anzar-text-secondary)]">
        ANZAR is thinking...
      </span>
    </div>
  );
};

export default TypingIndicator;
/**
 * TokenCounter Component
 * Displays estimated token usage in the chat input area
 * Shows warning colors when approaching limits
 */

import React, { useState } from 'react';

interface TokenCounterProps {
  /** Current token count */
  tokenCount: number;

  /** Optional: maximum tokens before hard limit */
  maxTokens?: number;
}

/**
 * Format large numbers for display
 * e.g., 12400 -> "12.4K"
 */
function formatTokens(count: number): string {
  if (count >= 1000) {
    return (count / 1000).toFixed(1) + 'K';
  }
  return count.toString();
}

export const TokenCounter: React.FC<TokenCounterProps> = ({
  tokenCount,
  maxTokens = 262000,
}) => {
  const [showTooltip, setShowTooltip] = useState(false);

  // Determine color based on token count
  const getColorClass = (): string => {
    const threshold80K = 80000;
    const threshold120K = 120000;

    if (tokenCount >= threshold120K) {
      return 'text-accent-error';
    }
    if (tokenCount >= threshold80K) {
      return 'text-accent-warning';
    }
    return 'text-text-muted';
  };

  const tooltipText = `${tokenCount.toLocaleString()} tokens estimés
Limite max: ${maxTokens.toLocaleString()} tokens`;

  return (
    <div
      className="relative flex items-center cursor-help"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      title={tooltipText}
    >
      <span className={`text-xs font-medium whitespace-nowrap ${getColorClass()}`}>
        ~{formatTokens(tokenCount)} tokens
      </span>

      {/* Tooltip */}
      {showTooltip && (
        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-surface-elevated border border-border-subtle text-text-primary text-xs rounded-lg shadow-lg whitespace-nowrap z-50">
          <div>{tokenCount.toLocaleString()} tokens estimés</div>
          <div className="text-text-muted mt-1">
            Limite: {formatTokens(maxTokens)}
          </div>
          <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-surface-elevated" />
        </div>
      )}
    </div>
  );
};

export default TokenCounter;

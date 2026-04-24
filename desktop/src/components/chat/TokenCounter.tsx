/**
 * TokenCounter Component
 * Displays estimated token usage in the chat input area
 * Shows warning colors when approaching limits
 */

import React, { useState } from 'react';

interface TokenCounterProps {
  /** Current token count */
  tokenCount: number;

  /** Optional: maximum tokens before hard limit (defaults to 262K for Kimi) */
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
  maxTokens = 262000, // Kimi K2.6 max context
}) => {
  const [showTooltip, setShowTooltip] = useState(false);

  // Determine color based on token count
  const getColorClass = (): string => {
    const threshold80K = 80000;
    const threshold120K = 120000;

    if (tokenCount >= threshold120K) {
      return 'text-red-500'; // Red when >120K
    }
    if (tokenCount >= threshold80K) {
      return 'text-orange-500'; // Orange when >80K
    }
    return 'text-gray-500'; // Gray otherwise
  };

  const deepseekMax = 128000;
  const kimiMax = 262000;

  const tooltipText = `${tokenCount.toLocaleString()} tokens estimés
Limites:
• DeepSeek: ${deepseekMax.toLocaleString()} tokens
• Kimi: ${kimiMax.toLocaleString()} tokens`;

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
        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-gray-100 text-xs rounded shadow-lg whitespace-nowrap z-50">
          <div>{tokenCount.toLocaleString()} tokens estimés</div>
          <div className="text-gray-400 mt-1">
            DeepSeek: 128K / Kimi: 262K
          </div>
          <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
        </div>
      )}
    </div>
  );
};

export default TokenCounter;

/**
 * Chat Module Stories
 * Storybook stories and examples for all chat components
 * Useful for development, testing, and documentation
 */

import React from 'react';
import ChatView from './ChatView';
import MessageBubble from './MessageBubble';
import MessageList from './MessageList';
import ChatInput from './ChatInput';
import CodeBlock from './CodeBlock';
import StreamingDots from './StreamingDots';
import type { Message } from '@/types';

// Example messages for testing
const EXAMPLE_MESSAGES: Message[] = [
  {
    id: '1',
    role: 'user',
    content: 'Comment puis-je créer une application React avec TypeScript?',
    timestamp: new Date('2024-01-15T10:00:00').getTime(),
  },
  {
    id: '2',
    role: 'assistant',
    content: `Voici les étapes pour créer une application React avec TypeScript:

1. **Créer le projet** avec Vite:
\`\`\`bash
npm create vite@latest my-app -- --template react-ts
cd my-app
npm install
\`\`\`

2. **Structure de base** avec TypeScript:
\`\`\`typescript
interface Props {
  title: string;
  count: number;
}

function App({ title, count }: Props) {
  return <div>{title}: {count}</div>;
}
\`\`\`

3. **Types utiles**:
- \`React.ReactNode\` pour les enfants
- \`React.FC<Props>\` pour les composants
- \`React.CSSProperties\` pour les styles

4. **Démarrer le développement**:
\`\`\`bash
npm run dev
\`\`\`

Avez-vous besoin d'aide pour une étape spécifique?`,
    timestamp: new Date('2024-01-15T10:01:00').getTime(),
    model: 'fast' as const,
  },
  {
    id: '3',
    role: 'user',
    content: 'Montre-moi un exemple de hook personnalisé',
    timestamp: new Date('2024-01-15T10:02:00').getTime(),
  },
  {
    id: '4',
    role: 'assistant',
    content: 'Voici un exemple de hook personnalisé pour gérer un formulaire:',
    timestamp: new Date('2024-01-15T10:03:00').getTime(),
    model: 'fast' as const,
  },
];

// ============================================================================
// ChatView Stories
// ============================================================================

export const ChatViewDefault = () => (
  <div className="h-screen">
    <ChatView onlineStatus={true} showWelcome={true} />
  </div>
);

export const ChatViewOffline = () => (
  <div className="h-screen">
    <ChatView onlineStatus={false} showWelcome={true} />
  </div>
);

export const ChatViewWithMessages = () => (
  <div className="h-screen">
    <ChatView onlineStatus={true} showWelcome={false} />
  </div>
);

// ============================================================================
// MessageBubble Stories
// ============================================================================

export const MessageBubbleUser = () => (
  <div className="p-8 bg-[var(--color-bg-primary)] dark:bg-[#0a0a0a]">
    <MessageBubble message={EXAMPLE_MESSAGES[0]} />
  </div>
);

export const MessageBubbleAI = () => (
  <div className="p-8 bg-[var(--color-bg-primary)] dark:bg-[#0a0a0a]">
    <MessageBubble message={EXAMPLE_MESSAGES[1]} />
  </div>
);

export const MessageBubbleError = () => (
  <div className="p-8 bg-[var(--color-bg-primary)] dark:bg-[#0a0a0a]">
    <MessageBubble
      message={{
        id: 'error-1',
        role: 'assistant',
        content: 'Une erreur s\'est produite. Veuillez réessayer.',
        timestamp: Date.now(),
        isError: true,
      }}
    />
  </div>
);

export const MessageBubbleWithThinking = () => (
  <div className="p-8 bg-[var(--color-bg-primary)] dark:bg-[#0a0a0a]">
    <MessageBubble
      message={{
        id: 'thinking-1',
        role: 'assistant',
        content: 'La réponse à votre question est complexe et nécessite une réflexion approfondie.',
        timestamp: Date.now(),
        thinking: 'Je dois analyser plusieurs aspects: 1) La structure générale, 2) Les dépendances, 3) Les optimisations de performance...',
        reasoning: [
          'D\'abord, je dois comprendre le contexte du problème',
          'Ensuite, j\'analyse les solutions possibles',
          'Finalement, je recommande la meilleure approche',
        ],
      }}
    />
  </div>
);

// ============================================================================
// MessageList Stories
// ============================================================================

export const MessageListEmpty = () => (
  <div className="h-screen bg-[var(--color-bg-primary)] dark:bg-[#0a0a0a]">
    <MessageList messages={[]} isLoading={false} />
  </div>
);

export const MessageListWithMessages = () => (
  <div className="h-screen bg-[var(--color-bg-primary)] dark:bg-[#0a0a0a]">
    <MessageList messages={EXAMPLE_MESSAGES} isLoading={false} />
  </div>
);

export const MessageListLoading = () => (
  <div className="h-screen bg-[var(--color-bg-primary)] dark:bg-[#0a0a0a]">
    <MessageList
      messages={EXAMPLE_MESSAGES.slice(0, 2)}
      isLoading={true}
    />
  </div>
);

// ============================================================================
// ChatInput Stories
// ============================================================================

export const ChatInputDefault = () => (
  <div className="p-8 bg-[var(--color-bg-primary)] dark:bg-[#0a0a0a]">
    <ChatInput
      onSendMessage={(msg, attachments) => console.log('Send:', msg, attachments)}
      isLoading={false}
      isOnline={true}
      selectedModel="fast"
    />
  </div>
);

export const ChatInputLoading = () => (
  <div className="p-8 bg-[var(--color-bg-primary)] dark:bg-[#0a0a0a]">
    <ChatInput
      onSendMessage={(msg, attachments) => console.log('Send:', msg, attachments)}
      isLoading={true}
      isOnline={true}
      selectedModel="fast"
    />
  </div>
);

export const ChatInputWithReasoner = () => (
  <div className="p-8 bg-[var(--color-bg-primary)] dark:bg-[#0a0a0a]">
    <ChatInput
      onSendMessage={(msg, attachments) => console.log('Send:', msg, attachments)}
      isLoading={false}
      isOnline={true}
      selectedModel="thinking"
    />
  </div>
);

// ============================================================================
// CodeBlock Stories
// ============================================================================

export const CodeBlockTypeScript = () => (
  <div className="p-8 bg-[var(--color-bg-primary)] dark:bg-[#0a0a0a]">
    <CodeBlock
      language="typescript"
      code={`interface User {
  id: string;
  name: string;
  email: string;
}

function getUser(id: string): User {
  return {
    id,
    name: 'John Doe',
    email: 'john@example.com',
  };
}`}
      showLineNumbers={true}
      filename="user.ts"
    />
  </div>
);

export const CodeBlockPython = () => (
  <div className="p-8 bg-[var(--color-bg-primary)] dark:bg-[#0a0a0a]">
    <CodeBlock
      language="python"
      code={`def fibonacci(n: int) -> int:
    """Calculate the nth Fibonacci number."""
    if n <= 1:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)

result = fibonacci(10)
print(f"Result: {result}")`}
      showLineNumbers={true}
      filename="fibonacci.py"
    />
  </div>
);

export const CodeBlockLongBlock = () => (
  <div className="p-8 bg-[var(--color-bg-primary)] dark:bg-[#0a0a0a]">
    <CodeBlock
      language="javascript"
      code={Array.from({ length: 30 }, (_, i) => `console.log('Line ${i + 1}');`).join('\n')}
      showLineNumbers={true}
      collapsible={true}
    />
  </div>
);

export const CodeBlockWithoutLineNumbers = () => (
  <div className="p-8 bg-[var(--color-bg-primary)] dark:bg-[#0a0a0a]">
    <CodeBlock
      language="bash"
      code={`npm install
npm run build
npm run dev`}
      showLineNumbers={false}
    />
  </div>
);

// ============================================================================
// StreamingDots Stories
// ============================================================================

export const StreamingDotsThinking = () => (
  <div className="p-8 bg-[var(--color-bg-primary)] dark:bg-[#0a0a0a]">
    <StreamingDots variant="thinking" />
  </div>
);

export const StreamingDotsSearching = () => (
  <div className="p-8 bg-[var(--color-bg-primary)] dark:bg-[#0a0a0a]">
    <StreamingDots variant="searching" />
  </div>
);

export const StreamingDotsDefault = () => (
  <div className="p-8 bg-[var(--color-bg-primary)] dark:bg-[#0a0a0a]">
    <StreamingDots />
  </div>
);

// ============================================================================
// Full Chat Experience
// ============================================================================

export const FullChatExperience = () => (
  <div className="h-screen flex flex-col bg-[var(--color-bg-primary)] dark:bg-[#0a0a0a]">
    <div className="flex-1 overflow-hidden">
      <MessageList messages={EXAMPLE_MESSAGES} isLoading={false} />
    </div>
    <ChatInput
      onSendMessage={(msg, attachments) => console.log('Send:', msg, attachments)}
      isLoading={false}
      isOnline={true}
      selectedModel="fast"
    />
  </div>
);

// ============================================================================
// Dark Mode Examples
// ============================================================================

export const DarkModeChat = () => (
  <div className="h-screen dark">
    <ChatView onlineStatus={true} showWelcome={true} />
  </div>
);

export const LightModeChat = () => (
  <div className="h-screen">
    <ChatView onlineStatus={true} showWelcome={true} />
  </div>
);

export default {
  title: 'Chat Module',
  parameters: {
    layout: 'fullscreen',
  },
};

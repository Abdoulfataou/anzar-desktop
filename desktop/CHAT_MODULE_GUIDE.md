# ANZAR Chat Module - Complete Integration Guide

## Overview

The Chat Module is a production-ready, beautifully crafted chat interface for the ANZAR desktop application. It provides everything needed for building a modern AI chat experience with streaming support, markdown rendering, code highlighting, and more.

## Architecture

### Component Hierarchy

```
ChatView (Main Container)
├── Header (Status & Branding)
├── Welcome Screen (Suggested Prompts)
│   └── Message Prompt Buttons
├── MessageList (Scrollable Container)
│   ├── Date Separator
│   └── MessageBubble (for each message)
│       ├── User Message
│       └── AI Message
│           ├── Thinking/Reasoning (Collapsible)
│           ├── Markdown Content
│           │   ├── CodeBlock (with syntax highlighting)
│           │   ├── Lists
│           │   ├── Links
│           │   └── etc.
│           └── Actions (Copy, Timestamp)
└── ChatInput (Sticky Bottom)
    ├── Model Selector
    ├── Textarea (Auto-resizing)
    ├── Token Counter
    └── Send/Stop Button
```

### File Structure

```
src/components/chat/
├── ChatView.tsx              # Main container
├── MessageList.tsx           # Scrollable message list
├── MessageBubble.tsx         # Individual message display
├── ChatInput.tsx             # Input area with model selector
├── CodeBlock.tsx             # Syntax-highlighted code
├── StreamingDots.tsx         # Typing indicator
├── MessageAI.tsx             # Legacy AI message (for compatibility)
├── MessageUser.tsx           # Legacy user message (for compatibility)
├── TypingIndicator.tsx       # Legacy typing indicator (for compatibility)
├── index.ts                  # Component exports
├── README.md                 # Component documentation
└── Chat.stories.tsx          # Storybook stories & examples

src/hooks/
└── useChat.ts                # Chat management hooks

src/pages/
└── ChatExample.tsx           # Integration examples

src/stores/
└── chatStore.ts              # Zustand state management (existing)

src/types/
└── index.ts                  # TypeScript definitions (existing)
```

## Quick Start

### Basic Usage

```typescript
import { ChatView } from '@/components/chat';

export default function App() {
  return (
    <div className="h-screen">
      <ChatView onlineStatus={true} showWelcome={true} />
    </div>
  );
}
```

### With Store Integration

```typescript
import { ChatView } from '@/components/chat';
import { useChatStore } from '@/stores/chatStore';
import { useChat } from '@/hooks/useChat';

export default function ChatPage() {
  const { createConversation, activeConversationId } = useChatStore();
  const { sendMessage } = useChat();

  // Initialize conversation
  useEffect(() => {
    if (!activeConversationId) {
      createConversation('New Chat', 'deepseek-chat');
    }
  }, []);

  return (
    <div className="h-screen">
      <ChatView onlineStatus={true} showWelcome={!activeConversationId} />
    </div>
  );
}
```

## Component Details

### ChatView

Main chat container component that orchestrates the entire UI.

**Props:**
```typescript
interface ChatViewProps {
  onlineStatus?: boolean;  // Shows online/offline indicator
  showWelcome?: boolean;   // Display welcome screen for new conversations
}
```

**Features:**
- Full-height responsive layout
- Welcome screen with suggested prompts
- Online/offline status indicator
- Integration with message list and input
- Theme support (light/dark mode)

### MessageList

Displays messages with auto-scroll to bottom and date separators.

**Key Features:**
- Auto-scrolls on new messages
- Date separators between conversation days
- Smooth scroll behavior
- Loading indicator
- Ref-based scroll management for performance

**Messages Structure:**
```typescript
interface Message {
  id: string;
  type: 'user' | 'ai';
  content: string;
  timestamp: Date;
  reasoning?: string[];      // For thinking display
  model?: 'deepseek-chat' | 'deepseek-reasoner';
  isError?: boolean;
  isStreaming?: boolean;
  thinking?: string;
}
```

### MessageBubble

Displays individual messages with markdown, code highlighting, and actions.

**Message Types:**
- **User Messages**: Right-aligned, gradient background
- **AI Messages**: Left-aligned, ANZAR icon, markdown support
- **Error Messages**: Red styling with error icon

**Features:**
- Markdown rendering with react-markdown
- Syntax-highlighted code blocks
- Collapsible thinking/reasoning sections
- Copy button (appears on hover)
- Timestamp (appears on hover)
- Smooth fade-in animation

**Supported Markdown:**
- Headings (h1-h3)
- Inline code with syntax highlighting
- Code blocks with language detection
- Lists (ordered and unordered)
- Links
- Blockquotes
- Tables
- Bold, italic, strikethrough

### ChatInput

Auto-resizing textarea with model selector and advanced features.

**Props:**
```typescript
interface ChatInputProps {
  onSendMessage: (message: string) => Promise<void> | void;
  onStopGeneration?: () => void;
  isLoading?: boolean;
  selectedModel?: 'deepseek-chat' | 'deepseek-reasoner';
  onModelChange?: (model: 'deepseek-chat' | 'deepseek-reasoner') => void;
  placeholder?: string;
  maxHeight?: number;
}
```

**Features:**
- Auto-resizing textarea (52px min, 200px max)
- Model selector (deepseek-chat vs deepseek-reasoner)
- Token count estimate
- Send button (with disabled state)
- Stop generation button (during streaming)
- Attachment button (placeholder)
- Keyboard shortcuts:
  - `Enter` to send
  - `Shift+Enter` for new line

### CodeBlock

Syntax-highlighted code blocks with copy functionality.

**Props:**
```typescript
interface CodeBlockProps {
  language?: string;        // Language for syntax highlighting
  code: string;            // Code content
  showLineNumbers?: boolean; // Show line numbers
  filename?: string;       // Optional filename
  collapsible?: boolean;   // Auto-collapse long blocks
}
```

**Features:**
- Syntax highlighting via Prism.js
- Line numbers (optional)
- Mac-style window chrome
- Copy button with confirmation
- Auto-collapse for blocks > 20 lines
- Filename display
- Horizontal scroll for wide code
- Light and dark theme support

**Supported Languages:**
```
javascript, typescript, jsx, tsx, python, sql, bash, css, 
json, html, xml, yaml, markdown, rust, go, java, c, cpp, 
and more via Prism.js
```

### StreamingDots

Typing/thinking indicator with animation.

**Variants:**
```typescript
<StreamingDots variant="thinking" />    // "ANZAR réfléchit..."
<StreamingDots variant="searching" />   // "Recherche en cours..."
<StreamingDots />                       // "Génération..."
```

**Features:**
- Pure CSS animation (efficient)
- Three pulsing dots
- Icon support
- Customizable text
- Light/dark mode support

## Hook Integration

### useChat

Main hook for managing chat interactions.

```typescript
const { 
  sendMessage,           // Send message and get response
  stopGeneration,        // Stop current generation
  activeConversation,    // Current conversation
  isGenerating,          // Is AI generating?
  streamingContent,      // Current streaming text
  error,                 // Error message if any
  clearError,            // Clear error
  hasApiKey              // Is API key configured?
} = useChat();

// Send a message
await sendMessage("Hello!");
```

### useChatInput

Manage chat input state and events.

```typescript
const {
  message,        // Current input text
  isFocused,      // Is textarea focused?
  textareaRef,    // Textarea reference
  setMessage,     // Update message
  setIsFocused,   // Update focus state
  handleSend,     // Send message
  handleKeyDown,  // Handle keyboard
  clear,          // Clear input
  hasMessage,     // Is there text?
  tokenCount      // Estimated tokens
} = useChatInput();
```

### useMessageActions

Manage per-message actions.

```typescript
const {
  copiedId,       // Which message was just copied?
  copyMessage,    // Copy message to clipboard
  editMessage,    // Edit a message
  removeMessage   // Delete a message
} = useMessageActions();
```

### useOnlineStatus

Check network connectivity.

```typescript
const { isOnline } = useOnlineStatus();
```

## Store Integration

### useChatStore

The Zustand store manages all chat state.

```typescript
import { useChatStore } from '@/stores/chatStore';

const {
  // State
  conversations,
  activeConversationId,
  isGenerating,
  streamingContent,

  // Selectors
  getActiveConversation,
  getSortedConversations,

  // Actions
  createConversation,
  deleteConversation,
  setActiveConversation,
  addMessage,
  updateMessage,
  deleteMessage,
  updateStreamingContent,
  appendStreamingContent,
  finalizeStreamingMessage,
  stopGeneration,
  setIsGenerating,
  clearAllConversations,
} = useChatStore();
```

## API Integration

### Example: DeepSeek API Integration

```typescript
async function streamChatResponse(
  messages: Message[],
  onToken: (token: string) => void,
  model: 'deepseek-chat' | 'deepseek-reasoner' = 'deepseek-chat'
) {
  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.REACT_APP_DEEPSEEK_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: messages.map(msg => ({
        role: msg.role,
        content: msg.content,
      })),
      stream: true,
    }),
  });

  const reader = response.body?.getReader();
  if (!reader) throw new Error('Cannot read response');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') continue;

        try {
          const json = JSON.parse(data);
          const delta = json.choices[0]?.delta?.content;
          if (delta) onToken(delta);
        } catch (err) {
          console.error('Parse error:', err);
        }
      }
    }
  }
}
```

### Example: useChat with API Integration

```typescript
import { useChat } from '@/hooks/useChat';

export default function ChatComponent() {
  const { 
    sendMessage, 
    isGenerating, 
    error 
  } = useChat();

  const handleSend = async (message: string) => {
    await sendMessage(message);
  };

  return (
    <div>
      {error && <div className="text-red-500">{error}</div>}
      <ChatView onlineStatus={true} showWelcome={false} />
    </div>
  );
}
```

## Styling & Theming

### CSS Custom Properties

All components use Tailwind CSS with custom properties for theming:

**Light Mode:**
```css
--color-bg-primary: white;
--color-bg-secondary: #f3f3f3;
--color-text-primary: dark gray;
--color-text-secondary: medium gray;
--color-border-subtle: light gray;
--color-accent-primary: indigo-blue;
--color-accent-secondary: purple;
```

**Dark Mode:**
- Uses Tailwind's `dark:` prefix
- Automatically applied via `document.documentElement.classList.toggle('dark')`
- All components support both modes

### Customizing Colors

Update Tailwind config to change theme colors:

```javascript
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
        'accent': {
          'primary': '#6366f1', // Indigo
          'secondary': '#a78bfa', // Purple
        },
      },
    },
  },
};
```

## Performance Optimizations

1. **Ref-Based Scroll**: MessageList uses refs instead of DOM queries
2. **Lazy Loading**: Messages can be virtualized for large conversations
3. **CSS Animations**: StreamingDots uses pure CSS
4. **Memoization**: Components use React.memo where appropriate
5. **Optimized Re-renders**: Zustand selectors prevent unnecessary updates
6. **Code Splitting**: Components can be loaded with React.lazy()

## Accessibility

- ✅ Semantic HTML structure
- ✅ ARIA labels and roles
- ✅ Keyboard navigation
- ✅ Focus management
- ✅ Color contrast (WCAG AA)
- ✅ Screen reader friendly

## Browser Support

- ✅ Chrome 90+
- ✅ Firefox 88+
- ✅ Safari 14+
- ✅ Edge 90+

## Troubleshooting

### Messages not scrolling to bottom
- Check MessageList has proper ref setup
- Ensure parent has `overflow: hidden`
- Verify no CSS overrides scroll behavior

### Code blocks not syntax highlighting
- Import required language in CodeBlock.tsx
- Check language parameter matches Prism syntax
- Verify CSS theme is loaded

### Input not auto-resizing
- Check textarea parent has `overflow: hidden`
- Verify `resize-none` class is applied
- Ensure useEffect watches message state

### Dark mode not working
- Add `dark` class to root element
- Check Tailwind config includes dark mode
- Verify CSS custom properties for dark mode

## Best Practices

1. **Always use the store**: Don't manage chat state locally
2. **Handle errors gracefully**: Show user-friendly error messages
3. **Test on slow networks**: Ensure streaming handles buffering
4. **Sanitize user input**: Always validate and sanitize before sending
5. **Cache API responses**: Store conversation history locally
6. **Implement proper error boundaries**: Catch and display errors
7. **Use keyboard shortcuts**: Implement standard shortcuts for power users
8. **Monitor performance**: Watch for memory leaks in streaming

## Future Enhancements

- [ ] File upload support
- [ ] Voice input/output
- [ ] Message editing
- [ ] Conversation branching
- [ ] Custom system prompts
- [ ] Rate limiting UI
- [ ] Offline mode with SW
- [ ] Search/filter conversations
- [ ] Message reactions
- [ ] Real-time collaboration
- [ ] Export conversations
- [ ] Code execution
- [ ] Image generation
- [ ] Document analysis

## Support & Contributions

For issues or feature requests, please refer to the main ANZAR repository.

---

**Version:** 1.0.0 (Production Ready)
**Last Updated:** January 2024
**Created:** January 2024

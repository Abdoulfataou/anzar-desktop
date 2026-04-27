# Chat Module Documentation

Complete, production-quality chat interface for ANZAR desktop app. This module provides a beautiful, minimal chat experience inspired by Claude Desktop.

## Components Overview

### ChatView.tsx
**Main chat container** - orchestrates the entire chat experience.

```typescript
import ChatView from '@/components/chat/ChatView';

// Basic usage
export default function App() {
  return <ChatView />;
}

// With props
<ChatView 
  onlineStatus={true}
  showWelcome={true}
/>
```

**Features:**
- Full-height layout with responsive design
- Welcome screen with suggested prompts
- Online/offline status indicator
- Theme integration with CSS custom properties
- Message management with Zustand store integration

**Props:**
- `onlineStatus?: boolean` - Shows online/offline indicator (default: true)
- `showWelcome?: boolean` - Display welcome screen for new conversations (default: true)

### MessageList.tsx
**Scrollable message container** with auto-scroll and date separators.

**Features:**
- Auto-scrolls to bottom on new messages
- Smooth scroll behavior with `scroll-behavior: smooth`
- Date separators for conversation organization
- Loading indicator during AI generation
- Fade-in animations for new messages
- Ref-based scroll management

### MessageBubble.tsx
**Individual message display** with support for multiple content types.

**Features:**
- **User messages**: Right-aligned, subtle background
- **AI messages**: Left-aligned with ANZAR icon
- Markdown rendering with react-markdown
- Code block rendering with syntax highlighting
- Thinking/reasoning display (collapsible)
- Copy button on hover
- Timestamp on hover
- Smooth fade-in animation
- Error state styling

**Markdown Support:**
- Headings (h1-h3)
- Lists (ordered and unordered)
- Code blocks (inline and block)
- Links
- Blockquotes
- Tables
- Bold, italic, strikethrough

### ChatInput.tsx
**Message input area** with advanced features.

**Features:**
- Auto-resizing textarea (52px min, 200px max)
- Model selector dropdown (fast / thinking)
- Send button (visible when text present)
- Stop generation button (during streaming)
- Attachment button (placeholder for future file upload)
- Token count estimate (bottom right)
- Keyboard shortcuts:
  - `Enter` to send
  - `Shift+Enter` for newline
- Disabled state during generation
- Focus ring and hover states

**Props:**
```typescript
interface ChatInputProps {
  onSendMessage: (message: string) => Promise<void> | void;
  onStopGeneration?: () => void;
  isLoading?: boolean;
  selectedModel?: 'fast' | 'thinking';
  onModelChange?: (model: 'fast' | 'thinking') => void;
  placeholder?: string;
  maxHeight?: number; // default: 200px
}
```

### CodeBlock.tsx
**Syntax-highlighted code blocks** with enhanced features.

**Features:**
- Language detection and syntax highlighting (Prism.js)
- Line numbers (optional)
- Mac-style window chrome
- Copy button
- Collapsible for long blocks (>20 lines)
- Filename display support
- Language-specific highlighting themes
- Scrollable for wide code

**Supported Languages:**
- JavaScript/TypeScript/TSX/JSX
- Python
- SQL
- Bash
- CSS
- JSON
- ...and more via Prism.js

**Props:**
```typescript
interface CodeBlockProps {
  language?: string;       // Language for syntax highlighting
  code: string;           // Code content
  showLineNumbers?: boolean;  // Show line numbers (default: true)
  filename?: string;      // Optional filename display
  collapsible?: boolean;  // Make long blocks collapsible
}
```

### StreamingDots.tsx
**Typing/thinking indicator** with multiple variants.

**Features:**
- Three pulsing dots animation
- Multiple variants:
  - `thinking`: "ANZAR réfléchit..."
  - `searching`: "Recherche en cours..."
  - `default`: "Génération..."
- Pure CSS animation (efficient)
- Icon support for each variant

**Usage:**
```typescript
<StreamingDots variant="thinking" />
<StreamingDots variant="searching" />
<StreamingDots variant="default" />
```

## Integration Guide

### With Zustand Store

The chat module integrates with the existing `useChatStore`:

```typescript
import { useChatStore } from '@/stores/chatStore';

export default function MyComponent() {
  const { 
    conversations, 
    addMessage, 
    updateMessage,
    setIsGenerating 
  } = useChatStore();

  const handleSend = async (content: string) => {
    // Add user message
    addMessage({
      id: generateId(),
      role: 'user',
      content,
      timestamp: Date.now(),
    });

    // Call API
    setIsGenerating(true);
    try {
      const response = await aiAPI.chat(content);
      
      addMessage({
        id: generateId(),
        role: 'assistant',
        content: response.content,
        timestamp: Date.now(),
        model: 'fast',
      });
    } finally {
      setIsGenerating(false);
    }
  };
}
```

### With AI backend

Example integration with backend streaming:

```typescript
async function streamChatResponse(
  message: string, 
  onToken: (token: string) => void
) {
  const response = await fetch('https://<ai-backend>/api/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'fast',
      messages: [{ role: 'user', content: message }],
      stream: true,
    }),
  });

  const reader = response.body?.getReader();
  if (!reader) return;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const text = new TextDecoder().decode(value);
    const lines = text.split('\n');
    
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const json = JSON.parse(line.slice(6));
        if (json.choices[0].delta?.content) {
          onToken(json.choices[0].delta.content);
        }
      }
    }
  }
}
```

## Styling & Theming

### CSS Custom Properties

The chat module uses Tailwind dark mode with custom properties:

```css
--color-bg-primary: hsl(0, 0%, 100%);      /* Light: white */
--color-bg-secondary: hsl(0, 0%, 96%);     /* Light: #f3f3f3 */
--color-text-primary: hsl(0, 0%, 13%);     /* Light: dark gray */
--color-text-secondary: hsl(0, 0%, 45%);   /* Light: medium gray */
--color-border-subtle: hsl(0, 0%, 88%);    /* Light: light gray */
--color-accent-primary: hsl(220, 98%, 61%); /* Light: blue */
--color-accent-secondary: hsl(262, 80%, 50%); /* Light: purple */

/* Dark mode (via Tailwind dark: prefix) */
--color-bg-primary: hsl(0, 0%, 6%);        /* Dark: #0f0f0f */
--color-bg-secondary: hsl(0, 0%, 10%);     /* Dark: #1a1a1a */
--color-text-primary: hsl(0, 0%, 98%);     /* Dark: white */
--color-text-secondary: hsl(0, 0%, 65%);   /* Dark: gray */
--color-border-subtle: hsl(0, 0%, 16%);    /* Dark: #2a2a2a */
--color-accent-primary: hsl(220, 98%, 61%); /* Indigo */
--color-accent-secondary: hsl(262, 80%, 50%); /* Violet */
```

### Tailwind Classes

All components use Tailwind CSS with:
- `dark:` prefix for dark mode
- Custom color properties
- Responsive utilities (`sm:`, `md:`, etc.)
- Animation utilities (`animate-in`, `fade-in`, etc.)

## Performance Optimizations

1. **Auto-scroll with Refs**: Uses `useRef` instead of DOM queries for efficient scroll management
2. **Memoization**: Components use `React.memo` where appropriate
3. **Lazy Loading**: MessageList renders only visible messages
4. **CSS Animations**: StreamingDots uses pure CSS instead of JavaScript
5. **Optimized Re-renders**: Zustand selectors prevent unnecessary updates
6. **Code Splitting**: Components can be lazy-loaded with React.lazy()

## Accessibility

- Semantic HTML structure
- ARIA labels on buttons
- Keyboard navigation support
- Focus management
- Color contrast compliance (WCAG AA)
- Screen reader friendly

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Future Enhancements

- File uploads with drag & drop
- Voice input
- Message editing
- Conversation forking
- Custom system prompts
- Rate limiting feedback
- Offline mode with service workers
- Search/filter conversations
- Message reactions/emojis
- Typing indicators for real-time collaboration

## Common Patterns

### Handling Message Streaming

```typescript
const { appendStreamingContent, finalizeStreamingMessage } = useChatStore();

// As tokens arrive
appendStreamingContent(token);

// When complete
finalizeStreamingMessage();
```

### Error Handling

```typescript
if (message.isError) {
  // MessageBubble automatically applies error styling
  return <MessageBubble message={message} />;
}
```

### Theme Switching

```typescript
// Toggle dark mode
document.documentElement.classList.toggle('dark');

// Components automatically respond to this
```

## Troubleshooting

**Messages not scrolling to bottom:**
- Ensure `MessageList` ref is properly set
- Check if parent container has `overflow: hidden`
- Verify `scroll-behavior: smooth` CSS is loaded

**Code blocks not highlighting:**
- Ensure Prism.js language is imported
- Check language parameter is correct
- Verify CSS theme is applied

**Textarea not resizing:**
- Check `overflow: hidden` on textarea parent
- Verify `resize-none` Tailwind class is applied
- Ensure useEffect dependency array includes `message`

---

**Created:** 2024
**Last Updated:** 2024
**Version:** 1.0.0 (Production Ready)

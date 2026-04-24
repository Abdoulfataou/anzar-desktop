# ANZAR Desktop Application Architecture

## Overview

ANZAR is a sophisticated Tauri + React + TypeScript desktop application leveraging DeepSeek AI models for intelligent code generation and project planning. The architecture follows modern best practices with clear separation of concerns.

## Directory Structure

```
src/
├── types/
│   └── index.ts                 # Core type definitions
├── stores/
│   ├── index.ts                 # Stores export index
│   ├── chatStore.ts             # Chat & conversation management
│   ├── projectStore.ts          # Project & file management
│   ├── memoryStore.ts           # Memory & learning items
│   ├── settingsStore.ts         # User settings & preferences
│   ├── themeStore.ts            # Theme management
│   └── authStore.ts             # Authentication state
├── services/
│   ├── index.ts                 # Services export index
│   ├── deepseek.ts              # DeepSeek API client
│   ├── storage.ts               # Storage abstraction layer
│   └── agents.ts                # Multi-agent orchestration
├── hooks/
│   ├── index.ts                 # Hooks export index
│   ├── useChat.ts               # Chat interactions
│   ├── useTheme.ts              # Theme management
│   ├── useOffline.ts            # Network status
│   └── useDeepSeek.ts           # DeepSeek analysis
├── lib/
│   └── utils.ts                 # Utility functions
└── ARCHITECTURE.md              # This file
```

## Core Concepts

### 1. Type System (`/types/index.ts`)

Comprehensive TypeScript definitions for all entities:

- **Messages & Conversations**: Core chat data structures
- **Projects & Files**: Code generation artifacts
- **Agents**: Multi-agent system statuses
- **Settings**: Application configuration
- **API Types**: Request/response schemas

**Key Features:**
- Full type safety across the application
- Extensible structures for future features
- French naming for user-facing strings

### 2. State Management (Zustand Stores)

#### Chat Store (`chatStore.ts`)
Manages all conversation state with persistence.

**Features:**
- Conversation CRUD operations
- Message streaming support
- Real-time content updates
- Conversation sorting and filtering
- Auto-save to localStorage

**Usage:**
```typescript
import { useChatStore, useActiveConversation } from '@/stores/chatStore';

// Create conversation
const conversation = useChatStore((state) => 
  state.createConversation('My Chat')
);

// Add message
useChatStore.getState().addMessage(message);

// Stream content
useChatStore.getState().appendStreamingContent(token);
```

#### Project Store (`projectStore.ts`)
Manages project lifecycle and file organization.

**Features:**
- Project CRUD with status tracking
- File management within projects
- Agent status coordination
- Progress tracking
- Import/export functionality

**Usage:**
```typescript
import { useProjectStore, useActiveProject } from '@/stores/projectStore';

// Create project
const project = useProjectStore.getState().createProject(
  'My App',
  'Description'
);

// Update agent status
useProjectStore.getState().updateAgentStatus(
  projectId,
  'coder',
  { status: 'working', progress: 50 }
);
```

#### Memory Store (`memoryStore.ts`)
Extracts and organizes learning from conversations.

**Features:**
- Memory item management
- Full-text search
- Tag-based organization
- Memory export/import
- Conversation linking

**Usage:**
```typescript
import { useMemoryStore, useMemorySearch } from '@/stores/memoryStore';

// Add memory
const memory = useMemoryStore.getState().addMemory({
  conversationId: 'conv-123',
  title: 'Key Insight',
  summary: 'Important discovery',
  timestamp: Date.now(),
  tags: ['important', 'feature']
});

// Search
const { results } = useMemorySearch();
```

#### Settings Store (`settingsStore.ts`)
Centralized configuration management.

**Features:**
- API key management
- Model selection
- UI preferences (theme, language, font size)
- Feature flags (offline mode, bandwidth saver)
- Auto-persistence to localStorage

**Usage:**
```typescript
import { useSettingsStore } from '@/stores/settingsStore';

const apiKey = useSettingsStore((state) => 
  state.getSetting('deepseekApiKey')
);

useSettingsStore.getState().updateSettings({
  theme: 'dark',
  language: 'fr'
});
```

### 3. Services (Business Logic)

#### DeepSeek Service (`deepseek.ts`)
Low-level API client for DeepSeek models.

**Features:**
- Streaming responses (AsyncGenerator pattern)
- Non-streaming requests
- Token counting estimation
- Error handling with retries
- Timeout management
- AbortController support for cancellation
- Bandwidth optimization (gzip headers)

**Architecture:**
```
┌─────────────────────────────────────┐
│  HTTP Request (fetch API)           │
│  - Bearer authentication             │
│  - Gzip compression                 │
│  - Timeout handling                 │
└────────────┬────────────────────────┘
             │
        ┌────▼────┐
        │ Stream? │
        └────┬──┬─┘
      Yes    │ No
      ┌──────┘  └───────┐
      │                 │
  ┌───▼────┐        ┌──▼──┐
  │ SSE    │        │JSON │
  │ Parse  │        │Resp │
  └───┬────┘        └──┬──┘
      │                 │
  ┌───▼──────────────┐  │
  │ Yield Tokens     │  │
  │ (AsyncGenerator) │◄─┘
  └──────────────────┘
```

**Usage:**
```typescript
import { deepseekService } from '@/services/deepseek';

// Streaming
for await (const token of deepseekService.streamChat(messages, 'deepseek-chat')) {
  console.log(token);
}

// Non-streaming
const response = await deepseekService.chat(messages, 'deepseek-reasoner');
```

#### Storage Service (`storage.ts`)
Cross-platform storage abstraction with Tauri fallback.

**Features:**
- Tries Tauri filesystem API first
- Falls back to browser localStorage
- Automatic JSON serialization
- Compression for large data (>100KB)
- Transparent error handling

**Implementation:**
```
Storage Request
      │
      ├─► Tauri Available?
      │   ├─ Yes → Try Tauri FS API
      │   │        ├─ Success → Return
      │   │        └─ Fail → Fall back to localStorage
      │   └─ No → Use localStorage directly
      │
      └─► Return result
```

**Usage:**
```typescript
import { storageService } from '@/services/storage';

// Save data
await storageService.save('my-key', { data: 'value' });

// Load data
const data = await storageService.load<MyType>('my-key');

// Clear all
await storageService.clearAll();
```

#### Agent Service (`agents.ts`)
Multi-agent orchestration with graceful degradation.

**Features:**
- Backend availability checking
- Project planning via backend or DeepSeek
- Project execution streaming
- Status monitoring
- Fallback to direct API when backend unavailable
- Error recovery

**Execution Flow:**
```
┌──────────────────────────────┐
│ executeProject(projectId)    │
└──────────────┬───────────────┘
               │
        ┌──────▼───────┐
        │Backend Live? │
        └──┬───────┬───┘
    Yes    │       No
    ┌──────┘       └─────────────┐
    │                            │
┌───▼──────────┐         ┌──────▼────┐
│Stream Status │         │Fallback:  │
│from Backend  │         │Return Idle│
└──────────────┘         └───────────┘
    │
    ├─ Orchestrator: planning
    ├─ Planner: generating plan
    ├─ Coder: writing code
    ├─ Tester: running tests
    └─ Executor: finalizing
```

### 4. React Hooks (UI Integration)

#### useChat Hook (`useChat.ts`)
High-level hook combining stores and services.

**Features:**
- Complete chat flow management
- Streaming integration
- Error handling with auto-clear
- API key validation
- Conversation context preservation
- Token counting

**Usage:**
```typescript
import { useChat } from '@/hooks/useChat';

function ChatComponent() {
  const { sendMessage, isGenerating, streamingContent } = useChat();

  return (
    <div>
      <input onSubmit={(msg) => sendMessage(msg)} />
      {isGenerating && <p>Réponse: {streamingContent}</p>}
    </div>
  );
}
```

#### useTheme Hook (`useTheme.ts`)
Theme management and application.

**Features:**
- Dark/light/system modes
- Real-time system preference detection
- Theme persistence
- DOM manipulation

**Usage:**
```typescript
import { useTheme } from '@/hooks/useTheme';

function ThemeToggle() {
  const { isDark, toggleTheme } = useTheme();
  
  return (
    <button onClick={toggleTheme}>
      {isDark ? '☀️' : '🌙'}
    </button>
  );
}
```

#### useOffline Hook (`useOffline.ts`)
Network status monitoring (critical for African context).

**Features:**
- Online/offline detection
- Connection quality assessment
- Bandwidth estimation
- Slow connection detection
- Bandwidth saver mode

**Usage:**
```typescript
import { useOffline, useBandwidthSaver } from '@/hooks/useOffline';

function DataComponent() {
  const { isOnline, isSlowConnection } = useOffline();
  const shouldSaveBandwidth = useBandwidthSaver();

  if (!isOnline) return <p>Mode hors ligne</p>;
  if (shouldSaveBandwidth) return <LowQualityVersion />;
  
  return <FullQualityVersion />;
}
```

## Data Flow Patterns

### Chat Interaction Flow

```
User Input
    │
    ▼
┌─────────────────────┐
│ useChat.sendMessage │
└────────┬────────────┘
         │
    ┌────▼────────┐
    │ Add user    │
    │ message to  │──────┐
    │ chatStore   │      │
    └─────────────┘      │
                         │
    ┌────────────────────▼──────────┐
    │ Format for API               │
    │ (extract messages, prepare) │
    └────────┬─────────────────────┘
             │
    ┌────────▼──────────┐
    │ deepseekService   │
    │ .streamChat()     │
    └────────┬──────────┘
             │
    ┌────────▼──────────────────┐
    │ Streaming Loop:           │
    │ - Receive token           │
    │ - appendStreamingContent  │
    │ - Update UI               │
    └────────┬──────────────────┘
             │
    ┌────────▼──────────────────┐
    │ finalizeStreamingMessage  │
    │ - Add to conversation     │
    │ - Clear streaming state   │
    └───────────────────────────┘
```

### Project Execution Flow

```
User Creates Project
    │
    ▼
┌─────────────────┐
│ createProject   │ → projectStore
└────────┬────────┘
         │
┌────────▼──────────┐
│ agentService      │
│ .planProject()    │
└────────┬──────────┘
         │
┌────────▼──────────┐
│ Backend or        │
│ DeepSeek API      │
└────────┬──────────┘
         │
┌────────▼──────────┐
│ Return plan       │
└────────┬──────────┘
         │
┌────────▼──────────────────┐
│ agentService              │
│ .executeProject(plan)     │
└────────┬──────────────────┘
         │
┌────────▼──────────────────────────┐
│ Streaming Agent Status Updates    │
│ - Yield status after each phase   │
│ - updateAgentStatus in store      │
│ - Update UI in real-time          │
└────────┬───────────────────────────┘
         │
┌────────▼───────────────────┐
│ Execution Complete         │
│ - Project marked "complete"│
│ - Files added to project   │
└────────────────────────────┘
```

## Persistence Strategy

### localStorage (Default)
- Conversations (chatStore)
- Projects (projectStore)
- Memories (memoryStore)
- Settings (settingsStore)
- Theme preferences (themeStore)

### Tauri Filesystem
- Large data files (>100KB auto-compressed)
- Media attachments
- Project exports
- Backup archives

## Security Considerations

1. **API Key Management**
   - Never exposed in logs
   - Stored securely in settings
   - Validated on use
   - Cleared on logout

2. **Network Security**
   - HTTPS enforced
   - Bearer token authentication
   - Request signing capability
   - Timeout protection

3. **Data Privacy**
   - Local-first architecture
   - Optional analytics flag
   - No telemetry by default
   - User controls data persistence

## Performance Optimizations

1. **Streaming**
   - Token-by-token updates via AsyncGenerator
   - Real-time UI updates
   - Reduced latency perception

2. **Bandwidth**
   - Gzip compression
   - Slow connection detection
   - Bandwidth saver mode
   - Lazy loading support

3. **Rendering**
   - Zustand for efficient updates
   - Selector hooks for granular subscriptions
   - Computed selectors prevent unnecessary renders

## Error Handling Strategy

```
Error Occurs
    │
    ├─ Network Error?
    │  └─ Show: "Erreur réseau"
    │
    ├─ API Key Invalid?
    │  └─ Show: "Clé API invalide"
    │
    ├─ Rate Limited?
    │  └─ Show: "Trop de requêtes"
    │     └─ Auto-retry with backoff
    │
    ├─ User Cancelled?
    │  └─ Clean up gracefully
    │
    └─ Unknown Error?
       └─ Show: Generic error message
          └─ Log for debugging
```

## Testing Strategy

### Unit Tests
- Service methods (deepseekService, storageService, agentService)
- Store reducers
- Hook logic
- Utility functions

### Integration Tests
- Chat flow (input → API → output)
- Project creation and execution
- Settings persistence
- Theme switching

### E2E Tests
- Full user workflows
- Multi-step interactions
- Error scenarios
- Offline fallbacks

## French Localization

All user-facing strings use French:
- Error messages
- UI labels
- Agent statuses
- Default content

Technical terms remain in English:
- Variable names
- Function names
- Code comments
- Type names

## Future Enhancements

1. **Multi-Modal Support**
   - Image analysis
   - Document processing
   - Voice input

2. **Advanced Features**
   - Custom agent workflows
   - Plugin system
   - Template library
   - Team collaboration

3. **Performance**
   - Service workers
   - Database abstraction (IndexedDB)
   - Smarter caching
   - Incremental sync

## API Reference Quick Start

### Creating a Chat
```typescript
const conversation = useChatStore.getState().createConversation(
  'Mon projet',
  'deepseek-chat'
);
useChatStore.getState().setActiveConversation(conversation.id);
```

### Sending a Message
```typescript
const { sendMessage } = useChat();
await sendMessage('Bonjour, comment ça va?');
```

### Creating a Project
```typescript
const project = useProjectStore.getState().createProject(
  'Mon application',
  'Description du projet'
);
```

### Planning and Executing
```typescript
const plan = await agentService.planProject('Build a React app');

for await (const statuses of agentService.executeProject(projectId, plan)) {
  // Update UI with agent statuses
}
```

### Accessing Settings
```typescript
const { getSetting, updateSettings } = useSettingsStore.getState();
const apiKey = getSetting('deepseekApiKey');
updateSettings({ language: 'en' });
```

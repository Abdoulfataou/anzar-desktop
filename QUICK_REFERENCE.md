# ANZAR - Quick Reference Guide

## Imports

### From Stores
```typescript
import { useChatStore, useActiveConversation, useSortedConversations } from '@/stores/chatStore';
import { useProjectStore, useActiveProject, useSortedProjects } from '@/stores/projectStore';
import { useMemoryStore, useMemorySearch, useMemoryTags } from '@/stores/memoryStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useThemeStore } from '@/stores/themeStore';
```

### From Services
```typescript
import { deepseekService } from '@/services/deepseek';
import { storageService } from '@/services/storage';
import { agentService } from '@/services/agents';
```

### From Hooks
```typescript
import { useChat, useChatInput, useMessageActions } from '@/hooks/useChat';
import { useTheme } from '@/hooks/useTheme';
import { useOffline, useConnectionQuality, useBandwidthSaver } from '@/hooks/useOffline';
```

---

## Chat Management

### Create Conversation
```typescript
const conversation = useChatStore((state) => state.createConversation('My Chat', 'deepseek-chat'));
```

### Send Message
```typescript
const { sendMessage, isGenerating } = useChat();
await sendMessage('Bonjour, comment ça va?');
```

### Get Active Conversation
```typescript
const conversation = useChatStore((state) => state.getActiveConversation());
// or use hook
const conversation = useActiveConversation();
```

### Get Streaming Content
```typescript
const { streamingContent } = useChat();
// Returns current streaming text in real-time
```

### Stop Generation
```typescript
const { stopGeneration } = useChat();
stopGeneration(); // Cancels current API request
```

### Delete Conversation
```typescript
useChatStore((state) => state.deleteConversation(conversationId));
```

---

## Project Management

### Create Project
```typescript
const project = useProjectStore((state) => state.createProject(
  'Mon Application',
  'Description du projet',
  'deepseek-chat'
));
```

### Get Active Project
```typescript
const project = useProjectStore((state) => state.getActiveProject());
// or use hook
const project = useActiveProject();
```

### Update Project Status
```typescript
useProjectStore((state) => state.setProjectStatus(projectId, 'generating'));
// Statuses: 'planning' | 'generating' | 'testing' | 'complete' | 'error'
```

### Add File to Project
```typescript
useProjectStore((state) => state.addFile(projectId, {
  path: 'src/App.tsx',
  content: 'export function App() { ... }',
  language: 'typescript',
  size: 1234
}));
```

### Update Agent Status
```typescript
useProjectStore((state) => state.updateAgentStatus(projectId, 'coder', {
  status: 'working',
  progress: 50,
  message: 'Writing code'
}));
```

### List Projects
```typescript
const projects = useProjectStore((state) => state.getSortedProjects());
```

### Delete Project
```typescript
useProjectStore((state) => state.deleteProject(projectId));
```

---

## Agent & Planning

### Plan a Project
```typescript
const plan = await agentService.planProject('Build a React app');
// Returns: ProjectPlan with files, phases, complexity
```

### Execute Project with Streaming
```typescript
for await (const statuses of agentService.executeProject(projectId, plan)) {
  // statuses: AgentStatus[]
  statuses.forEach(agent => {
    console.log(`${agent.name}: ${agent.progress}%`);
  });
}
```

### Cancel Execution
```typescript
await agentService.cancelExecution(projectId);
```

### Check Backend Status
```typescript
const isAvailable = await agentService.checkBackendAvailability();
```

---

## Memory & Learning

### Add Memory from Conversation
```typescript
useMemoryStore((state) => state.addMemory({
  conversationId: 'conv-123',
  title: 'Important Decision',
  summary: 'We decided to use TypeScript',
  timestamp: Date.now(),
  tags: ['architecture', 'decision']
}));
```

### Search Memories
```typescript
const { results, query, setQuery } = useMemorySearch();
// Searches title, summary, tags, and content
```

### Get Memories by Tag
```typescript
const memories = useMemoryStore((state) => state.getMemoriesByTag('important'));
```

### Get All Tags
```typescript
const allTags = useMemoryStore((state) => state.getAllTags());
// or use hook
const tags = useMemoryTags();
```

### Delete Memory
```typescript
useMemoryStore((state) => state.deleteMemory(memoryId));
```

---

## Settings & Configuration

### Get Setting
```typescript
const apiKey = useSettingsStore((state) => state.getSetting('deepseekApiKey'));
```

### Update Settings
```typescript
useSettingsStore((state) => state.updateSettings({
  deepseekApiKey: 'sk-xxx...',
  theme: 'dark',
  language: 'fr',
  fontSize: 16
}));
```

### Available Settings
```typescript
{
  apiKey: string;                    // DeepSeek API key
  apiBaseUrl: string;                // API endpoint
  model: 'deepseek-chat' | 'deepseek-reasoner';
  temperature: number;               // 0-2
  maxTokens: number;
  timeout: number;                   // ms
  theme: 'dark' | 'light' | 'system';
  language: 'fr' | 'en';
  fontSize: number;                  // pixels
  offlineMode: boolean;
  bandwidthSaver: boolean;
  autoSave: boolean;
}
```

### Reset Settings
```typescript
useSettingsStore((state) => state.resetSettings());
```

---

## Theme Management

### Get Current Theme
```typescript
const { theme, effectiveTheme, isDark } = useTheme();
// theme: 'dark' | 'light' | 'system'
// effectiveTheme: 'dark' | 'light'
```

### Change Theme
```typescript
const { setTheme } = useTheme();
setTheme('dark');
setTheme('light');
setTheme('system');
```

### Toggle Theme
```typescript
const { toggleTheme } = useTheme();
toggleTheme(); // Switches between dark ↔ light
```

---

## Network & Offline

### Check Online Status
```typescript
const { isOnline, isSlowConnection } = useOffline();
```

### Get Connection Quality
```typescript
const quality = useConnectionQuality();
// Returns: 0-100 (100 = 4g/5g, 50 = 3g, 25 = 2g, 10 = slow-2g, 0 = offline)
```

### Check if Should Save Bandwidth
```typescript
const shouldOptimize = useBandwidthSaver();
// Returns: true if slow connection or downlink < 1 Mbps
```

### Get Detailed Network Info
```typescript
const { networkStatus, downlink, rtt, effectiveType } = useOffline();
// effectiveType: '2g' | '3g' | '4g' | '5g' | 'slow-2g'
// downlink: Mbps
// rtt: milliseconds
```

---

## Chat Hooks

### Chat Input Management
```typescript
const {
  message,
  setMessage,
  handleSend,
  handleKeyDown,
  isEmpty,
  hasMessage,
  tokenCount
} = useChatInput(onSend);
```

### Message Actions
```typescript
const { copiedId, copyMessage, editMessage, removeMessage } = useMessageActions();

copyMessage(messageId, content);
editMessage(messageId, newContent);
removeMessage(messageId);
```

---

## DeepSeek Service (Low-Level)

### Stream Response
```typescript
const messages = [{ role: 'user', content: 'Hello' }];
for await (const token of deepseekService.streamChat(messages, 'deepseek-chat')) {
  console.log(token);
}
```

### Non-Streaming Request
```typescript
const response = await deepseekService.chat(messages, 'deepseek-reasoner');
```

### Validate API Key
```typescript
const isValid = await deepseekService.validateApiKey();
```

### Estimate Tokens
```typescript
const count = deepseekService.estimateTokenCount(messages);
```

### Cancel Request
```typescript
const controller = new AbortController();
deepseekService.streamChat(messages, model, { signal: controller.signal });
controller.abort(); // Cancels the stream
```

---

## Storage Service

### Save Data
```typescript
await storageService.save('my-key', { data: 'value' });
// Auto-uses Tauri or localStorage
// Auto-compresses if > 100KB
```

### Load Data
```typescript
const data = await storageService.load<MyType>('my-key');
// Returns null if not found
```

### List Keys
```typescript
const keys = await storageService.listKeys();
```

### Remove Data
```typescript
await storageService.remove('my-key');
```

### Clear All
```typescript
await storageService.clearAll();
```

### Get Storage Size
```typescript
const bytes = await storageService.getStorageSize();
```

---

## Types Reference

### Message Type
```typescript
interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  model?: 'deepseek-chat' | 'deepseek-reasoner';
  thinking?: string; // For reasoner mode
  tokens?: { prompt: number; completion: number };
  isStreaming?: boolean;
  codeBlocks?: CodeBlock[];
}
```

### Conversation Type
```typescript
interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  model: 'deepseek-chat' | 'deepseek-reasoner';
  projectId?: string;
  tags?: string[];
}
```

### Project Type
```typescript
interface Project {
  id: string;
  name: string;
  description: string;
  status: 'planning' | 'generating' | 'testing' | 'complete' | 'error';
  createdAt: number;
  updatedAt: number;
  files: ProjectFile[];
  agents: AgentStatus[];
  conversationId?: string;
  errorMessage?: string;
}
```

### AgentStatus Type
```typescript
interface AgentStatus {
  name: 'orchestrator' | 'planner' | 'coder' | 'tester' | 'executor';
  status: 'idle' | 'working' | 'done' | 'error';
  progress: number; // 0-100
  message?: string;
  error?: string;
}
```

---

## Common Patterns

### Complete Chat Flow
```typescript
function ChatComponent() {
  const { sendMessage, isGenerating, streamingContent, error } = useChat();
  const { message, setMessage, handleKeyDown } = useChatInput();

  return (
    <div>
      <input
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage(message);
            setMessage('');
          }
        }}
      />
      <button onClick={() => { sendMessage(message); setMessage(''); }}>Envoyer</button>
      
      {isGenerating && <p>{streamingContent}</p>}
      {error && <p style={{ color: 'red' }}>{error}</p>}
    </div>
  );
}
```

### Offline Aware Component
```typescript
function DataComponent() {
  const { isOnline, isSlowConnection } = useOffline();
  const shouldOptimize = useBandwidthSaver();

  if (!isOnline) {
    return <p>Vous êtes hors ligne</p>;
  }

  if (shouldOptimize) {
    return <CompactView />;
  }

  return <FullView />;
}
```

### Project Execution UI
```typescript
async function ProjectExecutor({ projectId, plan }) {
  const { updateAgentStatus } = useProjectStore();

  for await (const statuses of agentService.executeProject(projectId, plan)) {
    statuses.forEach(agent => {
      updateAgentStatus(projectId, agent.name, agent);
    });
  }
}
```

---

## Error Handling

### Common Errors
```typescript
try {
  await sendMessage(content);
} catch (error) {
  if (error.message.includes('not configured')) {
    // Show: "Clé API non configurée"
  } else if (error.message.includes('Network')) {
    // Show: "Erreur réseau"
  } else if (error.message.includes('401')) {
    // Show: "Clé API invalide"
  } else if (error.message.includes('429')) {
    // Show: "Trop de requêtes"
  } else {
    // Show: error.message
  }
}
```

---

## Performance Tips

1. **Use selector hooks for small updates**
   ```typescript
   const isGenerating = useChatStore((state) => state.isGenerating);
   ```

2. **Batch updates when possible**
   ```typescript
   for await (const token of stream) {
     // Multiple tokens received together
     appendStreamingContent(token);
   }
   ```

3. **Use useBandwidthSaver for optimization**
   ```typescript
   if (useBandwidthSaver()) {
     // Load low-quality images, disable animations
   }
   ```

4. **Clean up streaming on component unmount**
   ```typescript
   useEffect(() => {
     return () => stopGeneration();
   }, [stopGeneration]);
   ```

---

## Debugging

### Check Store State
```typescript
const state = useChatStore.getState();
console.log('Conversations:', state.conversations);
console.log('Active:', state.getActiveConversation());
```

### Monitor Streaming
```typescript
const streamingContent = useChatStore((state) => state.streamingContent);
console.log('Streaming:', streamingContent);
```

### Check Settings
```typescript
const settings = useSettingsStore((state) => state.settings);
console.log('API Key set:', !!settings.apiKey);
```

### Verify Connection
```typescript
const { isOnline, effectiveType, downlink } = useOffline();
console.log('Connection:', { isOnline, effectiveType, downlink });
```

---

## French Localization Strings

Key French user-facing strings:
- "Clé API DeepSeek non configurée" - API key not set
- "Veuillez entrer un message" - Please enter a message
- "Vous êtes hors ligne" - You are offline
- "Connexion lente détectée" - Slow connection detected
- "Erreur réseau" - Network error
- "Clé API invalide" - Invalid API key
- "Trop de requêtes" - Too many requests
- "Génération annulée" - Generation cancelled
- "Mode hors ligne" - Offline mode

---

This quick reference covers 90% of common use cases. For detailed documentation, see `/src/ARCHITECTURE.md`.

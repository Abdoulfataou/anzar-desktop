# ANZAR Design System - Complete Reference

A comprehensive, production-ready design system for the ANZAR desktop application. Built with React, TypeScript, Tailwind CSS, and Zustand. Supports seamless dark and light theme switching with smooth transitions.

## Files Created

### Core Files

1. **`/src/index.css`** - Global CSS with:
   - Dark and light theme CSS variables
   - Font imports (Inter + JetBrains Mono)
   - Tailwind directives
   - Base reset styles
   - Custom scrollbar styling
   - Glass morphism utilities
   - Smooth theme transitions
   - Chat and UI animations

2. **`/src/lib/utils.ts`** - Utility functions:
   - `cn()` - Class merging with clsx + tailwind-merge
   - `formatBytes()` - File size formatting
   - `formatRelativeTime()` - Relative time formatting
   - `truncate()` - Text truncation with ellipsis
   - `debounce()` - Function debouncing
   - `estimateTokens()` - Token estimation for DeepSeek
   - `generateId()` - UUID generation with fallback
   - `clamp()` - Number clamping
   - `isInViewport()` - Viewport detection
   - `isEmpty()` - Value validation
   - `formatCurrency()` - Currency formatting
   - `sleep()` - Promise-based delay

3. **`/stores/themeStore.ts`** - Zustand theme management:
   - Global theme state (`dark | light | system`)
   - Automatic theme application via DOM class
   - LocalStorage persistence
   - System theme detection via prefers-color-scheme
   - Smooth transitions between themes
   - TypeScript-first design

### UI Components

4. **`/components/ui/Button.tsx`** - Versatile button component:
   - 8 variants: primary, secondary, ghost, danger, success, warning, outline, error
   - 5 sizes: xs, sm, md, lg, xl
   - Support for left/right icons
   - Loading state with spinner
   - Full width, rounded, and glass effect options
   - CVA (Class Variance Authority) pattern for maintainability
   - Proper focus and disabled states

5. **`/components/ui/Input.tsx`** - Text input system:
   - Input with label, error, and icons
   - Textarea with resize options
   - Select with custom options
   - Floating label support
   - Left/right icon support
   - Error state styling
   - Full width option
   - TypeScript support for all variants

6. **`/components/ui/IconButton.tsx`** - Icon button for toolbars:
   - 5 variants: ghost, primary, secondary, danger, minimal
   - 5 sizes: xs, sm, md, lg, xl
   - Lucide icon integration
   - Loading state
   - Tooltip text support
   - Custom icon sizing
   - Minimal, clean design

7. **`/components/ui/Badge.tsx`** - Status indicators:
   - 7 variants: default, primary, secondary, success, warning, error, ghost
   - 3 sizes: sm, md, lg
   - Optional icon support
   - Interactive and dismissible modes
   - Glass effect option
   - Pulse animation for loading states

8. **`/components/ui/Tooltip.tsx`** - CSS-based tooltips:
   - 4 positions: top, bottom, left, right
   - Simple CSS implementation (no popovers)
   - Customizable delay
   - Aria label support
   - Lightweight and performant

9. **`/components/ui/ThemeToggle.tsx`** - Beautiful theme toggle:
   - Sun/Moon icons from lucide-react
   - Smooth rotation animation
   - 3 sizes: sm, md, lg
   - Optional tooltip
   - Hydration-safe
   - Hooks into themeStore

10. **`/components/ui/README.md`** - Component documentation:
    - Complete usage examples for all components
    - Props reference
    - CSS utilities reference
    - Theming guide
    - Color palette
    - Best practices

### Configuration

11. **`/tailwind.config.ts`** - Updated with:
    - CSS variable-based color system
    - Support for both light and dark themes
    - Custom animation keyframes
    - Extended typography
    - Glass morphism shadows
    - Transition utilities

## Color System

### Dark Theme (Default)

**Backgrounds:**
- Primary: `#0A0A0F` - Main background
- Secondary: `#14141B` - Elevated surfaces
- Tertiary: `#1E1E2E` - Cards and panels
- Quaternary: `#2A2A3C` - Hover states

**Accents:**
- Primary: `#3B82F6` - Blue
- Secondary: `#8B5CF6` - Violet
- Success: `#10B981` - Emerald
- Warning: `#F59E0B` - Amber
- Error: `#EF4444` - Red
- Info: `#06B6D4` - Cyan

**Text:**
- Primary: `#F8FAFC` - Main text
- Secondary: `#94A3B8` - Secondary text
- Tertiary: `#64748B` - Tertiary text
- Muted: `#475569` - Muted text

### Light Theme

**Backgrounds:**
- Primary: `#FFFFFF` - Main background
- Secondary: `#F7F7FC` - Elevated surfaces
- Tertiary: `#EEF0F7` - Cards and panels
- Quaternary: `#E5E8F0` - Hover states

**Accents:**
- Primary: `#3B82F6` - Blue (unchanged)
- Secondary: `#7C3AED` - Violet (darker)
- Success: `#059669` - Emerald (darker)
- Warning: `#D97706` - Amber (darker)
- Error: `#DC2626` - Red (darker)
- Info: `#0891B2` - Cyan (darker)

**Text:**
- Primary: `#0F172A` - Dark text
- Secondary: `#475569` - Medium gray
- Tertiary: `#64748B` - Light gray
- Muted: `#94A3B8` - Muted gray

## Theme Management

### Automatic Theme Application

```typescript
import { useThemeStore } from '@/stores/themeStore';

function MyComponent() {
  const { effectiveTheme, toggleTheme, setTheme } = useThemeStore();
  
  // effectiveTheme is 'dark' or 'light'
  // Theme automatically applied to html.dark/html.light classes
  // CSS variables update automatically
  
  return (
    <button onClick={toggleTheme}>
      Toggle Theme ({effectiveTheme})
    </button>
  );
}
```

### Persistent Theme

The theme preference is automatically persisted to localStorage and restored on page load:

```typescript
// Automatically persisted:
localStorage.setItem('theme', 'light'); // or 'dark' or 'system'
```

### System Theme Support

Users can set theme to `'system'` to follow their OS preference:

```typescript
const { setTheme } = useThemeStore();
setTheme('system'); // Follows prefers-color-scheme
```

## Component Usage

### Button

```typescript
import { Button } from '@/components/ui/Button';
import { Save } from 'lucide-react';

<Button 
  variant="primary" 
  size="lg" 
  leftIcon={Save}
  onClick={() => {}}
>
  Save Changes
</Button>
```

### Input

```typescript
import { Input, Textarea } from '@/components/ui/Input';

<Input 
  label="Email" 
  type="email" 
  error="Invalid email"
  fullWidth
/>

<Textarea 
  label="Message" 
  rows={5}
  placeholder="Your message..."
/>
```

### IconButton

```typescript
import { IconButton } from '@/components/ui/IconButton';
import { Settings } from 'lucide-react';

<IconButton 
  icon={Settings} 
  variant="minimal"
  tooltip="Settings"
/>
```

### Badge

```typescript
import { Badge } from '@/components/ui/Badge';

<Badge variant="success">
  Active
</Badge>

<Badge variant="warning" dismissible>
  Warning
</Badge>
```

### Tooltip

```typescript
import { Tooltip } from '@/components/ui/Tooltip';

<Tooltip content="Click to delete" position="top">
  <button>Delete</button>
</Tooltip>
```

### ThemeToggle

```typescript
import { ThemeToggle } from '@/components/ui/ThemeToggle';

<ThemeToggle size="md" showTooltip />
```

## CSS Classes

### Glass Effects

```html
<!-- Basic glass effect -->
<div class="glass">Content</div>

<!-- Hover glass effect -->
<div class="glass-hover">Hover me</div>

<!-- Small glass -->
<div class="glass-sm">Small glass</div>
```

### Gradients

```html
<!-- Primary gradient (Blue to Violet) -->
<div class="gradient-primary">Gradient</div>

<!-- Success gradient (Green to Cyan) -->
<div class="gradient-success">Gradient</div>

<!-- Warm gradient (Amber to Red) -->
<div class="gradient-warm">Gradient</div>
```

### Scrollbar

```html
<!-- Automatic thin scrollbar (applied to all scrollable elements) -->
<div class="h-64 overflow-y-auto">
  <!-- Custom scrollbar automatically applied -->
</div>
```

## Utility Functions

```typescript
import {
  cn,              // Class merging
  formatBytes,     // "1.2 MB"
  formatRelativeTime, // "2 hours ago"
  formatCurrency,  // "$1,234.56"
  truncate,        // "Hello..."
  debounce,        // Function debouncing
  estimateTokens,  // Token counting for DeepSeek
  generateId,      // UUID or fallback
  clamp,           // Clamp number
  isInViewport,    // Element visibility check
  isEmpty,         // Value validation
  sleep,           // Promise delay
} from '@/lib/utils';

// Examples:
cn('px-4', isActive && 'bg-accent-primary')
formatRelativeTime(new Date())
estimateTokens("Hello world") // ~3 tokens
debounce(() => {}, 300)
```

## Responsive Design

All components are fully responsive using Tailwind's responsive prefixes:

```typescript
<Button 
  size="sm" 
  className="md:text-base lg:text-lg"
/>

<Input 
  className="w-full md:w-1/2 lg:w-1/3"
/>
```

## Accessibility

All components include proper accessibility support:

- ARIA labels and roles
- Keyboard navigation
- Focus management
- Color contrast compliance
- Semantic HTML
- Screen reader support

## Performance Optimizations

1. **Minimal CSS** - Only includes necessary styles
2. **CSS Variables** - No JS overhead for theming
3. **Lightweight Components** - No unnecessary wrappers
4. **Forward refs** - Direct DOM access when needed
5. **Debouncing** - Built-in utility for expensive operations
6. **Smooth Transitions** - Hardware-accelerated animations

## Browser Support

- Chrome/Chromium 88+
- Firefox 85+
- Safari 14.1+
- Edge 88+
- iOS Safari 14.5+

## Development

### Adding a New Component

1. Create component in `/components/ui/ComponentName.tsx`
2. Use TypeScript for full type safety
3. Use `forwardRef` for DOM access
4. Use `cn()` for class merging
5. Support both light and dark themes via Tailwind's `dark:` prefix
6. Export component and variant types

### Customizing Colors

Edit CSS variables in `/src/index.css`:

```css
:root,
html.dark {
  --accent-primary: #YOUR_COLOR;
}

html.light {
  --accent-primary: #YOUR_COLOR;
}
```

### Adding Animations

Use Tailwind's animation utilities or extend `tailwind.config.ts`:

```typescript
animation: {
  'custom': 'customKeyframe 0.3s ease-out',
}
```

## Best Practices

1. ✅ Use `useThemeStore()` for theme management
2. ✅ Use CSS variables for custom colors
3. ✅ Use `cn()` for conditional classes
4. ✅ Prefer Tailwind classes over inline styles
5. ✅ Test both light and dark themes
6. ✅ Use semantic HTML
7. ✅ Support keyboard navigation
8. ✅ Provide proper ARIA labels

## Anti-Patterns

1. ❌ Don't manually manipulate DOM for theming
2. ❌ Don't use hard-coded colors (use CSS variables)
3. ❌ Don't create custom hover/focus states (use built-in)
4. ❌ Don't forget `forwardRef` for DOM components
5. ❌ Don't add unnecessary wrappers
6. ❌ Don't ignore theme transitions
7. ❌ Don't hardcode theme preference
8. ❌ Don't skip accessibility

## File Structure

```
/src
  /components
    /ui
      Button.tsx
      IconButton.tsx
      Input.tsx (also exports Textarea, Select)
      Badge.tsx
      Tooltip.tsx
      ThemeToggle.tsx
      Card.tsx (existing)
      Avatar.tsx (existing)
      CommandPalette.tsx (existing)
      README.md
  /stores
    themeStore.ts
  /lib
    utils.ts
  index.css
  index.tsx
/tailwind.config.ts
/DESIGN_SYSTEM.md
```

## Quick Start

1. **Initialize theme on app load:**
   ```typescript
   useThemeStore.getState().initializeTheme();
   ```

2. **Use ThemeToggle in header:**
   ```typescript
   <ThemeToggle size="md" showTooltip />
   ```

3. **Build components using design system:**
   ```typescript
   <Button variant="primary" size="lg">
     Click me
   </Button>
   ```

4. **Custom styling with theme support:**
   ```typescript
   <div className="bg-white dark:bg-black text-black dark:text-white">
     Automatic theme
   </div>
   ```

## Troubleshooting

**Theme not persisting?**
- Check localStorage is enabled
- Verify `themeStore` is initialized on app load

**Colors not updating?**
- Ensure CSS variables are defined
- Check Tailwind config includes CSS variables
- Verify `html.dark` or `html.light` class is applied

**Scrollbar not styled?**
- Check browser supports CSS scrollbar styling
- Firefox needs `scrollbar-width: thin`
- Webkit browsers use `::-webkit-scrollbar` pseudo-elements

**Icons not showing?**
- Install lucide-react: `npm install lucide-react`
- Import icons from `lucide-react`
- Ensure icon size is set correctly

## License & Credits

Built for ANZAR desktop application with modern React patterns and best practices.

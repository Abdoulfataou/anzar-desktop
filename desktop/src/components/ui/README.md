# ANZAR Design System

A modern, minimal design system built with React, TypeScript, and Tailwind CSS. Supports both dark and light themes with smooth transitions.

## Theme Support

### Automatic Theme Management

The design system uses `zustand` for state management and automatically applies themes to the DOM via CSS custom properties.

```typescript
import { useThemeStore } from '@/stores/themeStore';

export function MyComponent() {
  const { effectiveTheme, toggleTheme, setTheme } = useThemeStore();
  
  return (
    <button onClick={toggleTheme}>
      Current theme: {effectiveTheme}
    </button>
  );
}
```

### CSS Variables

All colors are defined as CSS custom properties that update based on the theme:

**Dark Theme** (default):
- `--bg-primary`: `#0A0A0F` (deep black)
- `--text-primary`: `#F8FAFC` (light text)
- `--accent-primary`: `#3B82F6` (blue)

**Light Theme**:
- `--bg-primary`: `#FFFFFF` (white)
- `--text-primary`: `#0F172A` (dark text)
- `--accent-primary`: `#3B82F6` (blue)

## Components

### Button

Versatile button component with multiple variants and sizes.

```typescript
import { Button } from '@/components/ui/Button';
import { Heart } from 'lucide-react';

export function ButtonExample() {
  return (
    <>
      {/* Variants */}
      <Button variant="primary">Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="danger">Danger</Button>
      <Button variant="outline">Outline</Button>

      {/* Sizes */}
      <Button size="xs">Extra Small</Button>
      <Button size="sm">Small</Button>
      <Button size="md">Medium</Button>
      <Button size="lg">Large</Button>
      <Button size="xl">Extra Large</Button>

      {/* With Icons */}
      <Button leftIcon={Heart} size="md">Save</Button>
      <Button rightIcon={Heart} variant="secondary">Like</Button>

      {/* Loading State */}
      <Button isLoading>Creating...</Button>

      {/* Full Width */}
      <Button fullWidth>Full Width Button</Button>

      {/* Rounded */}
      <Button rounded>Pill Button</Button>

      {/* Glass Effect */}
      <Button glass>Glass Button</Button>
    </>
  );
}
```

**Props:**
- `variant`: `'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'warning' | 'outline' | 'error'`
- `size`: `'xs' | 'sm' | 'md' | 'lg' | 'xl'`
- `leftIcon`: Lucide icon component
- `rightIcon`: Lucide icon component
- `isLoading`: Shows spinner, disables button
- `fullWidth`: 100% width
- `rounded`: Pill-shaped button
- `glass`: Glassmorphism effect

### IconButton

Minimal icon button for toolbar actions.

```typescript
import { IconButton } from '@/components/ui/IconButton';
import { Settings, Trash2 } from 'lucide-react';

export function IconButtonExample() {
  return (
    <>
      {/* Variants */}
      <IconButton icon={Settings} variant="ghost" />
      <IconButton icon={Trash2} variant="danger" />
      <IconButton icon={Settings} variant="minimal" />

      {/* Sizes */}
      <IconButton icon={Settings} size="xs" />
      <IconButton icon={Settings} size="sm" />
      <IconButton icon={Settings} size="md" />
      <IconButton icon={Settings} size="lg" />

      {/* Loading State */}
      <IconButton icon={Settings} isLoading />

      {/* With Tooltip */}
      <IconButton 
        icon={Settings} 
        tooltip="Settings"
      />
    </>
  );
}
```

**Props:**
- `icon`: Lucide icon component (required)
- `variant`: `'ghost' | 'primary' | 'secondary' | 'danger' | 'minimal'`
- `size`: `'xs' | 'sm' | 'md' | 'lg' | 'xl'`
- `isLoading`: Shows spinner
- `tooltip`: Tooltip text on hover
- `iconSize`: Custom icon size in pixels

### Input

Text input with optional label, error messages, and icons.

```typescript
import { Input, Textarea, Select } from '@/components/ui/Input';
import { Mail, Lock } from 'lucide-react';

export function InputExample() {
  return (
    <>
      {/* Basic Input */}
      <Input placeholder="Enter text..." />

      {/* With Label */}
      <Input label="Email" type="email" />

      {/* With Icon */}
      <Input 
        label="Email" 
        leftIcon={Mail}
        placeholder="you@example.com"
      />

      {/* With Error */}
      <Input 
        label="Password"
        type="password"
        leftIcon={Lock}
        error="Password is required"
      />

      {/* Floating Label */}
      <Input 
        label="Username"
        floatingLabel
        placeholder=" "
      />

      {/* Full Width */}
      <Input label="Search" fullWidth />

      {/* Textarea */}
      <Textarea 
        label="Message" 
        placeholder="Your message here..."
        rows={4}
      />

      {/* Select */}
      <Select 
        label="Category"
        options={[
          { value: 'tech', label: 'Technology' },
          { value: 'design', label: 'Design' },
        ]}
      />
    </>
  );
}
```

### Badge

Status indicators and labels with multiple variants.

```typescript
import { Badge } from '@/components/ui/Badge';
import { Check } from 'lucide-react';

export function BadgeExample() {
  return (
    <>
      {/* Variants */}
      <Badge variant="default">Default</Badge>
      <Badge variant="primary">Primary</Badge>
      <Badge variant="secondary">Secondary</Badge>
      <Badge variant="success">Success</Badge>
      <Badge variant="warning">Warning</Badge>
      <Badge variant="error">Error</Badge>
      <Badge variant="ghost">Ghost</Badge>

      {/* Sizes */}
      <Badge size="sm">Small</Badge>
      <Badge size="md">Medium</Badge>
      <Badge size="lg">Large</Badge>

      {/* With Icon */}
      <Badge icon={<Check size={14} />} variant="success">
        Completed
      </Badge>

      {/* Interactive */}
      <Badge interactive onClick={() => console.log('clicked')}>
        Clickable
      </Badge>

      {/* Dismissible */}
      <Badge 
        dismissible 
        onDismiss={() => console.log('dismissed')}
      >
        Close me
      </Badge>

      {/* Glass Effect */}
      <Badge glass variant="primary">
        Glass Badge
      </Badge>

      {/* Pulse Animation */}
      <Badge pulse variant="warning">
        Loading...
      </Badge>
    </>
  );
}
```

### Tooltip

Simple CSS-based tooltip using data attributes.

```typescript
import { Tooltip } from '@/components/ui/Tooltip';
import { Info } from 'lucide-react';

export function TooltipExample() {
  return (
    <>
      {/* Basic Tooltip */}
      <Tooltip content="Click to save">
        <button>Save</button>
      </Tooltip>

      {/* Tooltip Positions */}
      <Tooltip content="Top tooltip" position="top">
        <button>Top</button>
      </Tooltip>
      <Tooltip content="Bottom tooltip" position="bottom">
        <button>Bottom</button>
      </Tooltip>
      <Tooltip content="Left tooltip" position="left">
        <button>Left</button>
      </Tooltip>
      <Tooltip content="Right tooltip" position="right">
        <button>Right</button>
      </Tooltip>

      {/* With Delay */}
      <Tooltip content="Delayed tooltip" delayMs={500}>
        <button>Hover me slowly</button>
      </Tooltip>

      {/* With Icon */}
      <Tooltip content="More information">
        <Info size={20} className="cursor-help" />
      </Tooltip>
    </>
  );
}
```

### ThemeToggle

Beautiful theme toggle button with smooth animation.

```typescript
import { ThemeToggle } from '@/components/ui/ThemeToggle';

export function ThemeToggleExample() {
  return (
    <>
      {/* Default */}
      <ThemeToggle />

      {/* Different Sizes */}
      <ThemeToggle size="sm" />
      <ThemeToggle size="md" />
      <ThemeToggle size="lg" />

      {/* Without Tooltip */}
      <ThemeToggle showTooltip={false} />
    </>
  );
}
```

## Utility Functions

### cn() - Class Merging

Merge Tailwind classes with conditional logic, avoiding conflicts.

```typescript
import { cn } from '@/lib/utils';

cn('px-4 py-2', isActive && 'bg-accent-primary')
// Result: "px-4 py-2 bg-accent-primary" (if isActive is true)
```

### Other Utilities

```typescript
import {
  formatBytes,           // "1.2 MB"
  formatRelativeTime,    // "2 hours ago"
  truncate,             // "Hello..."
  debounce,             // Debounced function
  estimateTokens,       // Token estimation for DeepSeek
  clamp,                // Clamp value between min/max
  isInViewport,         // Check if element is visible
  generateId,           // Generate UUID or fallback
} from '@/lib/utils';
```

## CSS Classes

### Glass Effects

```html
<!-- Basic glass -->
<div class="glass">Glass effect</div>

<!-- Hover glass -->
<div class="glass-hover">Hover for effect</div>

<!-- Small glass -->
<div class="glass-sm">Small glass</div>
```

### Gradients

```html
<!-- Primary gradient -->
<div class="gradient-primary">Blue to Violet</div>

<!-- Success gradient -->
<div class="gradient-success">Green to Cyan</div>

<!-- Warm gradient -->
<div class="gradient-warm">Amber to Red</div>
```

### Scrollbar Styling

Custom thin scrollbar automatically applied to all scrollable elements.

## Theming Example

```typescript
import { useEffect } from 'react';
import { useThemeStore } from '@/stores/themeStore';

export function App() {
  const { effectiveTheme, initializeTheme } = useThemeStore();

  useEffect(() => {
    initializeTheme();
  }, [initializeTheme]);

  return (
    <div>
      {/* Your app here */}
      {/* Theme automatically applied via CSS variables */}
    </div>
  );
}
```

## Dark/Light Mode CSS

The design system automatically handles light and dark themes:

```typescript
// Dark theme (default)
html.dark {
  --bg-primary: #0A0A0F;
  --text-primary: #F8FAFC;
}

// Light theme
html.light {
  --bg-primary: #FFFFFF;
  --text-primary: #0F172A;
}
```

Use Tailwind's `dark:` prefix for fine-grained control:

```typescript
<div className="bg-white dark:bg-black text-black dark:text-white">
  This will respect the theme
</div>
```

## Color Reference

### Accent Colors
- **Primary**: `#3B82F6` (Blue)
- **Secondary**: `#8B5CF6` or `#7C3AED` (Violet)
- **Success**: `#10B981` or `#059669` (Emerald/Green)
- **Warning**: `#F59E0B` or `#D97706` (Amber)
- **Error**: `#EF4444` or `#DC2626` (Red)
- **Info**: `#06B6D4` or `#0891B2` (Cyan)

### Background Colors (Dark)
- **Primary**: `#0A0A0F`
- **Secondary**: `#14141B`
- **Tertiary**: `#1E1E2E`
- **Quaternary**: `#2A2A3C`

### Background Colors (Light)
- **Primary**: `#FFFFFF`
- **Secondary**: `#F7F7FC`
- **Tertiary**: `#EEF0F7`
- **Quaternary**: `#E5E8F0`

## Best Practices

1. **Always use the theme store** for theme management - don't manually manipulate the DOM
2. **Use CSS variables** in your custom components for automatic theme support
3. **Prefer Tailwind classes** over inline styles
4. **Use the cn() utility** to merge classes conditionally
5. **Leverage the design tokens** (colors, spacing, sizing) for consistency
6. **Test both light and dark themes** during development

## Browser Support

- Chrome/Edge 88+
- Firefox 85+
- Safari 14.1+
- iOS Safari 14.5+

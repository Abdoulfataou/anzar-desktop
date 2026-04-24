# Design System Integration Guide

Quick setup instructions for integrating the new design system into the ANZAR desktop app.

## Prerequisites

Ensure the following packages are installed:

```bash
npm install lucide-react clsx tailwind-merge class-variance-authority zustand
```

These should already be in your `package.json` if not:
```json
{
  "dependencies": {
    "lucide-react": "latest",
    "clsx": "latest",
    "tailwind-merge": "latest",
    "class-variance-authority": "latest",
    "zustand": "latest"
  }
}
```

## Step 1: Initialize Theme Store

In your main app component (e.g., `src/index.tsx` or `src/App.tsx`):

```typescript
import { useEffect } from 'react';
import { useThemeStore } from '@/stores/themeStore';

function App() {
  useEffect(() => {
    // Initialize theme on app mount
    useThemeStore.getState().initializeTheme();
  }, []);

  return (
    // Your app content
  );
}
```

## Step 2: Add ThemeToggle to Header

In your header/navigation component:

```typescript
import { ThemeToggle } from '@/components/ui/ThemeToggle';

export function Header() {
  return (
    <header className="flex items-center justify-between p-4 bg-bg-secondary">
      <h1 className="text-xl font-bold text-text-primary">ANZAR</h1>
      <ThemeToggle size="md" showTooltip />
    </header>
  );
}
```

## Step 3: Update Existing Components

Replace old UI components with new design system components:

### Before
```typescript
import { Button } from '@old/Button';
<Button className="bg-blue-500">Click</Button>
```

### After
```typescript
import { Button } from '@/components/ui/Button';
<Button variant="primary" size="md">Click</Button>
```

## Step 4: Update Global Styles

Ensure your `index.tsx` imports the global CSS:

```typescript
import '@/index.css'; // Global design system styles
import App from './App';
```

## Step 5: Configure Tailwind (Already Done)

Your `tailwind.config.ts` is already configured correctly with:
- `darkMode: 'class'` for class-based theme switching
- CSS variable color system
- Custom animations and utilities

No changes needed here!

## Usage Examples

### Using Buttons

```typescript
import { Button } from '@/components/ui/Button';
import { Save, Trash2 } from 'lucide-react';

function MyComponent() {
  return (
    <>
      <Button variant="primary" size="lg" leftIcon={Save}>
        Save
      </Button>
      <Button variant="danger" size="md" rightIcon={Trash2}>
        Delete
      </Button>
      <Button variant="ghost" isLoading>
        Loading...
      </Button>
    </>
  );
}
```

### Using Input Fields

```typescript
import { Input, Textarea } from '@/components/ui/Input';
import { Mail, MessageSquare } from 'lucide-react';

function Form() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');

  return (
    <>
      <Input
        label="Email Address"
        type="email"
        leftIcon={Mail}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        fullWidth
      />
      <Textarea
        label="Message"
        leftIcon={MessageSquare}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={5}
        fullWidth
      />
    </>
  );
}
```

### Using Icons

```typescript
import { IconButton } from '@/components/ui/IconButton';
import { Settings, Bell, LogOut } from 'lucide-react';

function Toolbar() {
  return (
    <div className="flex gap-2">
      <IconButton
        icon={Settings}
        variant="minimal"
        tooltip="Settings"
      />
      <IconButton
        icon={Bell}
        variant="ghost"
        size="md"
        tooltip="Notifications"
      />
      <IconButton
        icon={LogOut}
        variant="danger"
        size="md"
        tooltip="Logout"
      />
    </div>
  );
}
```

### Using Status Badges

```typescript
import { Badge } from '@/components/ui/Badge';
import { Check, AlertCircle } from 'lucide-react';

function StatusIndicator() {
  return (
    <>
      <Badge variant="success" icon={<Check size={14} />}>
        Completed
      </Badge>
      <Badge variant="warning" icon={<AlertCircle size={14} />}>
        Pending
      </Badge>
      <Badge variant="error">
        Error
      </Badge>
    </>
  );
}
```

### Using Tooltips

```typescript
import { Tooltip } from '@/components/ui/Tooltip';

function Component() {
  return (
    <Tooltip content="Click to save" position="top">
      <button>Save</button>
    </Tooltip>
  );
}
```

### Using Theme Store

```typescript
import { useThemeStore } from '@/stores/themeStore';

function ThemeSettings() {
  const { effectiveTheme, setTheme } = useThemeStore();

  return (
    <div>
      <p>Current theme: {effectiveTheme}</p>
      <button onClick={() => setTheme('dark')}>Dark</button>
      <button onClick={() => setTheme('light')}>Light</button>
      <button onClick={() => setTheme('system')}>System</button>
    </div>
  );
}
```

## Common Patterns

### Form with Validation

```typescript
import { Input, Textarea } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useState } from 'react';

function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const newErrors: Record<string, string> = {};
    if (!email) newErrors.email = 'Email is required';
    if (!password) newErrors.password = 'Password is required';
    
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    
    // Submit form
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 w-full max-w-md">
      <Input
        label="Email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={errors.email}
        fullWidth
      />
      <Input
        label="Password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={errors.password}
        fullWidth
      />
      <Button type="submit" variant="primary" fullWidth>
        Sign In
      </Button>
    </form>
  );
}
```

### Responsive Layout

```typescript
function Layout() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4">
      <div className="md:col-span-2 bg-bg-secondary rounded-lg p-4">
        Main content
      </div>
      <div className="bg-bg-tertiary rounded-lg p-4">
        Sidebar
      </div>
    </div>
  );
}
```

### Dark Mode Specific Styles

```typescript
function Component() {
  return (
    <div className="bg-white dark:bg-black text-black dark:text-white">
      This respects the theme automatically
    </div>
  );
}
```

## Migration Checklist

- [ ] Install required packages
- [ ] Initialize theme store in app entry point
- [ ] Add ThemeToggle to header/navigation
- [ ] Replace old Button components with new ones
- [ ] Replace old Input components with new ones
- [ ] Update existing Badge components
- [ ] Add proper TypeScript types throughout
- [ ] Test both light and dark themes
- [ ] Test on mobile/responsive sizes
- [ ] Verify localStorage persistence
- [ ] Test keyboard navigation
- [ ] Check accessibility with screen reader
- [ ] Verify all colors visible in both themes
- [ ] Test font rendering (Inter + JetBrains Mono)

## Troubleshooting

### Theme not applying?
1. Ensure `useThemeStore.getState().initializeTheme()` is called on app mount
2. Check that `html.dark` or `html.light` class is being applied
3. Verify CSS variables are loaded from `index.css`
4. Check browser DevTools Elements for the applied classes

### Colors look wrong?
1. Ensure Tailwind config uses CSS variables
2. Check CSS variables are defined in `index.css`
3. Verify `tailwind.config.ts` hasn't been overwritten
4. Clear browser cache and rebuild

### Icons not showing?
1. Ensure lucide-react is installed: `npm list lucide-react`
2. Import icons correctly: `import { Heart } from 'lucide-react'`
3. Pass icon to component: `icon={Heart}` (not `icon="Heart"`)
4. Verify icon size is appropriate

### localStorage errors?
1. Check browser allows localStorage
2. Ensure no localStorage quota exceeded
3. Verify no private/incognito mode (some disable storage)

### Build errors?
1. Ensure all packages installed: `npm install`
2. Check TypeScript errors: `npm run type-check`
3. Verify no circular imports
4. Clear node_modules and reinstall if needed: `rm -rf node_modules && npm install`

## Files Reference

| File | Purpose |
|------|---------|
| `/src/index.css` | Global styles, theme variables, animations |
| `/src/lib/utils.ts` | Utility functions, `cn()` helper |
| `/stores/themeStore.ts` | Zustand theme management |
| `/components/ui/Button.tsx` | Button component |
| `/components/ui/IconButton.tsx` | Icon button component |
| `/components/ui/Input.tsx` | Input, Textarea, Select components |
| `/components/ui/Badge.tsx` | Badge/status indicator component |
| `/components/ui/Tooltip.tsx` | Tooltip component |
| `/components/ui/ThemeToggle.tsx` | Theme toggle button |
| `/tailwind.config.ts` | Tailwind configuration |
| `/DESIGN_SYSTEM.md` | Complete design system documentation |
| `/components/ui/README.md` | Component usage guide |

## Next Steps

1. **Review Design System Docs**: Read `/DESIGN_SYSTEM.md` for complete reference
2. **Check Component Examples**: See `/components/ui/README.md` for detailed usage
3. **Start Migration**: Begin updating existing components one by one
4. **Test Thoroughly**: Test light/dark themes in all components
5. **Iterate**: Gather feedback and refine as needed

## Support & Documentation

- **Full Docs**: See `/DESIGN_SYSTEM.md`
- **Component Guide**: See `/components/ui/README.md`
- **Type Definitions**: Check component `.tsx` files for TypeScript interfaces
- **Examples**: Look at existing components for usage patterns

## Performance Notes

- CSS variables are cached by the browser
- Theme switching is instant (no re-render needed)
- Components use forwardRef for optimal performance
- Tailwind CSS removes unused styles in production
- Icons from lucide-react are tree-shakeable

Good luck! The design system is ready to use.

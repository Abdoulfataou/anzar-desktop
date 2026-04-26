import { NavLink } from 'react-router-dom'
import { cn } from '../../lib/utils'
import {
  LayoutDashboard,
  FolderKanban,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Activity,
  Users,
  CreditCard
} from 'lucide-react'
import { useState } from 'react'
import { useAuthStore } from '@/stores/authStore'
import AnzarLogo from '@/components/ui/AnzarLogo'

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Studio', href: '/studio', icon: Sparkles },
  { name: 'Projects', href: '/projects', icon: FolderKanban },
  { name: 'Users', href: '/users', icon: Users },
  { name: 'Paiements', href: '/payments', icon: CreditCard },
  { name: 'Observability', href: '/observability', icon: Activity },
  { name: 'Settings', href: '/settings', icon: Settings },
]

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const user = useAuthStore((s) => s.user)
  const clearSession = useAuthStore((s) => s.clearSession)

  return (
    <aside className={cn(
      'flex flex-col border-r border-border bg-background-secondary',
      'transition-all duration-300',
      collapsed ? 'w-16' : 'w-64'
    )}>
      {/* Logo */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className={cn(
          'flex items-center gap-3',
          collapsed ? 'justify-center' : 'justify-start'
        )}>
          <AnzarLogo size={32} />
          {!collapsed && (
            <div>
              <h1 className="text-lg font-bold text-foreground-primary">ANZAR Admin</h1>
              <p className="text-xs text-foreground-secondary">Console vibecoding</p>
            </div>
          )}
        </div>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1.5 rounded-md hover:bg-background-tertiary text-foreground-secondary hover:text-foreground-primary transition-colors"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      {/* Main Navigation */}
      <nav className="flex-1 p-4 space-y-1">
        {navigation.map((item) => (
          <NavLink
            key={item.name}
            to={item.href}
            className={({ isActive }) => cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150',
              'hover:bg-background-tertiary hover:text-foreground-primary',
              isActive 
                ? 'bg-background-tertiary text-accent-primary border-l-2 border-accent-primary' 
                : 'text-foreground-secondary',
              collapsed && 'justify-center'
            )}
          >
            <item.icon className="h-4 w-4 flex-shrink-0" />
            {!collapsed && <span>{item.name}</span>}
          </NavLink>
        ))}
      </nav>

      {/* User Profile */}
      <div className={cn(
        'p-4 border-t border-border',
        collapsed ? 'flex justify-center' : 'flex items-center gap-3'
      )}>
        <div className="h-8 w-8 rounded-full bg-gradient-to-br from-accent-primary to-accent-secondary flex items-center justify-center">
          <span className="text-xs font-bold text-background-primary">
            {(user?.name || user?.email || 'A').slice(0, 1).toUpperCase()}
          </span>
        </div>
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground-primary truncate">
              {user?.name || 'Admin'}
            </p>
            <p className="text-xs text-foreground-secondary truncate">
              {user?.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : 'Admin'}
            </p>
          </div>
        )}
        <button
          onClick={() => clearSession()}
          className="p-1.5 rounded-md hover:bg-background-tertiary text-foreground-secondary hover:text-foreground-primary transition-colors"
          aria-label="Se déconnecter"
          title="Se déconnecter"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </aside>
  )
}

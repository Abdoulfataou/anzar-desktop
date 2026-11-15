import { NavLink, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import {
  Activity, ChevronLeft, ChevronRight, CreditCard, LayoutDashboard, LogOut, ScrollText, Settings, ShieldCheck, Users, Wallet,
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { useAuthStore } from '@/stores/authStore'
import AnzarLogo from '@/components/ui/AnzarLogo'
import { label, ROLE_LABELS } from '@/lib/format'
import type { Role } from '@/api/backend'

const navigation: { name: string; href: string; icon: typeof Users; roles?: Role[] }[] = [
  { name: 'Tableau de bord', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Utilisateurs', href: '/users', icon: Users },
  { name: 'Crédits', href: '/credits', icon: Wallet },
  { name: 'Paiements', href: '/payments', icon: CreditCard },
  { name: 'Consommation', href: '/usage', icon: Activity },
  { name: "Journal d'audit", href: '/audit', icon: ScrollText, roles: ['owner', 'admin'] },
  { name: 'Administrateurs', href: '/admins', icon: ShieldCheck, roles: ['owner'] },
  { name: 'Paramètres', href: '/settings', icon: Settings },
]

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const user = useAuthStore((s) => s.user)
  const clearSession = useAuthStore((s) => s.clearSession)
  const navigate = useNavigate()
  const items = navigation.filter((i) => !i.roles || (user?.role && i.roles.includes(user.role)))

  return (
    <aside className={cn('flex flex-col border-r border-border bg-background-secondary transition-all duration-300', collapsed ? 'w-16' : 'w-60')}>
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className={cn('flex items-center gap-3', collapsed && 'justify-center')}>
          <AnzarLogo size={30} />
          {!collapsed && (
            <div>
              <h1 className="text-base font-bold">ANZAR Admin</h1>
              <p className="text-[11px] text-foreground-secondary">Console d'administration</p>
            </div>
          )}
        </div>
        <button onClick={() => setCollapsed(!collapsed)} aria-label="Réduire le menu"
          className="p-1.5 rounded-md hover:bg-background-tertiary text-foreground-secondary hover:text-foreground-primary">
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {items.map((item) => (
          <NavLink key={item.href} to={item.href} title={collapsed ? item.name : undefined}
            className={({ isActive }) => cn(
              'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
              'hover:bg-background-tertiary hover:text-foreground-primary',
              isActive ? 'bg-background-tertiary text-accent-primary' : 'text-foreground-secondary',
              collapsed && 'justify-center',
            )}>
            <item.icon className="h-4 w-4 flex-shrink-0" />
            {!collapsed && <span>{item.name}</span>}
          </NavLink>
        ))}
      </nav>

      <div className="p-3 border-t border-border">
        {!collapsed && user && (
          <div className="px-3 pb-2">
            <p className="text-sm font-medium truncate">{user.name || user.email}</p>
            <p className="text-[11px] text-foreground-muted truncate">{user.email} · {label(ROLE_LABELS, user.role)}</p>
          </div>
        )}
        <button
          onClick={() => { clearSession(); navigate('/login') }}
          className={cn('flex w-full items-center gap-3 px-3 py-2 rounded-lg text-sm text-foreground-secondary hover:bg-background-tertiary hover:text-accent-error',
            collapsed && 'justify-center')}>
          <LogOut className="h-4 w-4" />
          {!collapsed && <span>Se déconnecter</span>}
        </button>
      </div>
    </aside>
  )
}

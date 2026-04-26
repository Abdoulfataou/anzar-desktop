import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AdminRole, AdminUser } from '@/api/backend'

export type OrgPlan = 'free' | 'pro' | 'enterprise'
export type OrgStatus = 'active' | 'suspended'

export type OrgQuota = {
  monthly_fcfa?: number
  daily_tokens?: number
  max_projects_per_day?: number
  max_concurrent_runs?: number
}

export type Org = {
  id: string
  name: string
  plan: OrgPlan
  status: OrgStatus
  created_at: string
  quota: OrgQuota
}

export type OrgMember = {
  userId: string
  email: string
  name?: string
  role: AdminRole
  added_at: string
}

export type OrgInviteStatus = 'pending' | 'accepted' | 'revoked'
export type OrgInvite = {
  id: string
  email: string
  role: AdminRole
  status: OrgInviteStatus
  created_at: string
}

type OrgState = {
  orgs: Org[]
  membersByOrg: Record<string, OrgMember[]>
  invitesByOrg: Record<string, OrgInvite[]>

  createOrg: (payload: { name: string; plan?: OrgPlan; quota?: OrgQuota }) => Org
  updateOrg: (orgId: string, patch: Partial<Omit<Org, 'id' | 'created_at'>>) => void
  deleteOrg: (orgId: string) => void

  addMember: (orgId: string, user: Pick<AdminUser, 'id' | 'email' | 'name'>, role?: AdminRole) => void
  removeMember: (orgId: string, userId: string) => void
  updateMemberRole: (orgId: string, userId: string, role: AdminRole) => void

  invite: (orgId: string, email: string, role: AdminRole) => OrgInvite
  revokeInvite: (orgId: string, inviteId: string) => void
  acceptInviteMock: (orgId: string, inviteId: string, user: Pick<AdminUser, 'id' | 'email' | 'name'>) => void

  getUserOrgs: (userIdOrEmail: string) => Org[]
}

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`
}

const seedOrgs: Org[] = [
  {
    id: 'org_internal',
    name: 'ANZAR Internal',
    plan: 'enterprise',
    status: 'active',
    created_at: new Date(Date.now() - 40 * 86400000).toISOString(),
    quota: { monthly_fcfa: 500000, daily_tokens: 1_000_000, max_concurrent_runs: 20, max_projects_per_day: 999 },
  },
  {
    id: 'org_startup_ci',
    name: 'Startup CI',
    plan: 'pro',
    status: 'active',
    created_at: new Date(Date.now() - 18 * 86400000).toISOString(),
    quota: { monthly_fcfa: 150000, daily_tokens: 250_000, max_concurrent_runs: 5, max_projects_per_day: 40 },
  },
  {
    id: 'org_school_lab',
    name: 'School Lab',
    plan: 'free',
    status: 'active',
    created_at: new Date(Date.now() - 7 * 86400000).toISOString(),
    quota: { monthly_fcfa: 0, daily_tokens: 30_000, max_concurrent_runs: 1, max_projects_per_day: 5 },
  },
]

export const useOrgStore = create<OrgState>()(
  persist(
    (set, get) => ({
      orgs: seedOrgs,
      membersByOrg: {
        org_internal: [
          {
            userId: 'u_01',
            email: 'owner@anzar.dev',
            name: 'Owner',
            role: 'owner',
            added_at: new Date(Date.now() - 35 * 86400000).toISOString(),
          },
          {
            userId: 'u_02',
            email: 'support@anzar.dev',
            name: 'Support',
            role: 'support',
            added_at: new Date(Date.now() - 12 * 86400000).toISOString(),
          },
        ],
        org_startup_ci: [
          {
            userId: 'u_03',
            email: 'user1@example.com',
            name: 'User One',
            role: 'readonly',
            added_at: new Date(Date.now() - 5 * 86400000).toISOString(),
          },
        ],
        org_school_lab: [
          {
            userId: 'u_04',
            email: 'user2@example.com',
            name: 'User Two',
            role: 'readonly',
            added_at: new Date(Date.now() - 2 * 86400000).toISOString(),
          },
        ],
      },
      invitesByOrg: {
        org_startup_ci: [
          {
            id: 'inv_01',
            email: 'newmember@startup.ci',
            role: 'readonly',
            status: 'pending',
            created_at: new Date(Date.now() - 2 * 86400000).toISOString(),
          },
        ],
      },

      createOrg: ({ name, plan, quota }) => {
        const org: Org = {
          id: uid('org'),
          name,
          plan: plan ?? 'free',
          status: 'active',
          created_at: new Date().toISOString(),
          quota: quota ?? {},
        }
        set((s) => ({ orgs: [org, ...s.orgs] }))
        return org
      },

      updateOrg: (orgId, patch) => {
        set((s) => ({
          orgs: s.orgs.map((o) => (o.id === orgId ? { ...o, ...patch } : o)),
        }))
      },

      deleteOrg: (orgId) => {
        set((s) => {
          const { [orgId]: _m, ...restMembers } = s.membersByOrg
          const { [orgId]: _i, ...restInvites } = s.invitesByOrg
          return {
            orgs: s.orgs.filter((o) => o.id !== orgId),
            membersByOrg: restMembers,
            invitesByOrg: restInvites,
          }
        })
      },

      addMember: (orgId, user, role) => {
        set((s) => {
          const prev = s.membersByOrg[orgId] || []
          const exists = prev.some((m) => m.userId === user.id || m.email === user.email)
          if (exists) return s
          const next: OrgMember = {
            userId: user.id,
            email: user.email,
            name: user.name,
            role: role ?? 'readonly',
            added_at: new Date().toISOString(),
          }
          return { membersByOrg: { ...s.membersByOrg, [orgId]: [next, ...prev] } }
        })
      },

      removeMember: (orgId, userId) => {
        set((s) => ({
          membersByOrg: {
            ...s.membersByOrg,
            [orgId]: (s.membersByOrg[orgId] || []).filter((m) => m.userId !== userId),
          },
        }))
      },

      updateMemberRole: (orgId, userId, role) => {
        set((s) => ({
          membersByOrg: {
            ...s.membersByOrg,
            [orgId]: (s.membersByOrg[orgId] || []).map((m) => (m.userId === userId ? { ...m, role } : m)),
          },
        }))
      },

      invite: (orgId, email, role) => {
        const invite: OrgInvite = {
          id: uid('inv'),
          email,
          role,
          status: 'pending',
          created_at: new Date().toISOString(),
        }
        set((s) => ({
          invitesByOrg: { ...s.invitesByOrg, [orgId]: [invite, ...(s.invitesByOrg[orgId] || [])] },
        }))
        return invite
      },

      revokeInvite: (orgId, inviteId) => {
        set((s) => ({
          invitesByOrg: {
            ...s.invitesByOrg,
            [orgId]: (s.invitesByOrg[orgId] || []).map((i): OrgInvite =>
              i.id === inviteId ? { ...i, status: 'revoked' as const } : i
            ),
          },
        }))
      },

      acceptInviteMock: (orgId, inviteId, user) => {
        set((s) => {
          const invites = s.invitesByOrg[orgId] || []
          const inv = invites.find((i) => i.id === inviteId)
          if (!inv) return s

          const nextInvites: OrgInvite[] = invites.map((i): OrgInvite =>
            i.id === inviteId ? { ...i, status: 'accepted' as const } : i
          )
          const members = s.membersByOrg[orgId] || []
          const exists = members.some((m) => m.userId === user.id || m.email === user.email)
          const nextMembers = exists
            ? members
            : [
                {
                  userId: user.id,
                  email: user.email,
                  name: user.name,
                  role: inv.role,
                  added_at: new Date().toISOString(),
                } satisfies OrgMember,
                ...members,
              ]

          return {
            invitesByOrg: { ...s.invitesByOrg, [orgId]: nextInvites },
            membersByOrg: { ...s.membersByOrg, [orgId]: nextMembers },
          }
        })
      },

      getUserOrgs: (userIdOrEmail) => {
        const s = get()
        const found: Org[] = []
        for (const org of s.orgs) {
          const members = s.membersByOrg[org.id] || []
          if (members.some((m) => m.userId === userIdOrEmail || m.email === userIdOrEmail)) {
            found.push(org)
          }
        }
        return found
      },
    }),
    {
      name: 'anzar-admin-orgs',
      version: 1,
      partialize: (s) => ({
        orgs: s.orgs,
        membersByOrg: s.membersByOrg,
        invitesByOrg: s.invitesByOrg,
      }),
    }
  )
)

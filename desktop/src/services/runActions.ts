import { fileSystemService } from '@/services/fileSystem'

export type ProjectKind = 'node' | 'python' | 'rust' | 'unknown'

export type RunActionId =
  | 'install'
  | 'dev'
  | 'build'
  | 'test'
  | 'lint'
  | 'git_status'
  | 'git_diff'

export type RunAction = {
  id: RunActionId
  label: string
  description?: string
  /** If set, action is only available for these project kinds */
  kinds?: ProjectKind[]
  /** Build the command to execute (cmd string that TerminalService can parse) */
  command: (ctx: { projectPath: string; kind: ProjectKind }) => string | null
}

export async function detectProjectKind(projectPath: string): Promise<ProjectKind> {
  try {
    const [hasCargo, hasPkg, hasPy, hasReq] = await Promise.all([
      fileSystemService.exists(`${projectPath}/Cargo.toml`),
      fileSystemService.exists(`${projectPath}/package.json`),
      fileSystemService.exists(`${projectPath}/pyproject.toml`),
      fileSystemService.exists(`${projectPath}/requirements.txt`),
    ])
    if (hasCargo) return 'rust'
    if (hasPkg) return 'node'
    if (hasPy || hasReq) return 'python'
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

export const RUN_ACTIONS: RunAction[] = [
  {
    id: 'install',
    label: 'Installer dépendances',
    kinds: ['node', 'python', 'rust'],
    command: ({ kind }) => {
      if (kind === 'node') return 'npm install'
      if (kind === 'python') return 'pip install -r requirements.txt'
      if (kind === 'rust') return 'cargo build'
      return null
    },
  },
  {
    id: 'dev',
    label: 'Lancer Dev',
    kinds: ['node'],
    command: ({ kind }) => (kind === 'node' ? 'npm run dev' : null),
  },
  {
    id: 'build',
    label: 'Build',
    kinds: ['node', 'rust'],
    command: ({ kind }) => {
      if (kind === 'node') return 'npm run build'
      if (kind === 'rust') return 'cargo build'
      return null
    },
  },
  {
    id: 'test',
    label: 'Tests',
    kinds: ['node', 'python', 'rust'],
    command: ({ kind }) => {
      if (kind === 'node') return 'npm test'
      if (kind === 'python') return 'python -m pytest'
      if (kind === 'rust') return 'cargo test'
      return null
    },
  },
  {
    id: 'lint',
    label: 'Lint',
    kinds: ['node'],
    command: ({ kind }) => (kind === 'node' ? 'npm run lint' : null),
  },
  {
    id: 'git_status',
    label: 'Git status',
    kinds: ['node', 'python', 'rust', 'unknown'],
    command: () => 'git status',
  },
  {
    id: 'git_diff',
    label: 'Git diff',
    kinds: ['node', 'python', 'rust', 'unknown'],
    command: () => 'git diff',
  },
]

export function getActionsForKind(kind: ProjectKind): RunAction[] {
  return RUN_ACTIONS.filter((a) => !a.kinds || a.kinds.includes(kind))
}


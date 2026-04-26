export type DevToolId = 'python' | 'node' | 'git' | 'rust'

export function devToolLabel(tool: DevToolId): string {
  switch (tool) {
    case 'python':
      return 'Python'
    case 'node':
      return 'Node.js'
    case 'git':
      return 'Git'
    case 'rust':
      return 'Rust'
  }
}

export function devToolInstallUrl(tool: DevToolId): string {
  switch (tool) {
    case 'python':
      return 'https://www.python.org/downloads/'
    case 'node':
      return 'https://nodejs.org/en/download'
    case 'git':
      return 'https://git-scm.com/downloads'
    case 'rust':
      return 'https://www.rust-lang.org/tools/install'
  }
}

export function detectToolFromCommand(command: string): DevToolId | null {
  const first = (command || '').trim().split(/\s+/)[0]?.toLowerCase()
  if (!first) return null
  if (first === 'python' || first === 'python3' || first === 'pip' || first === 'pip3') return 'python'
  if (first === 'node' || first === 'npm' || first === 'npx') return 'node'
  if (first === 'git') return 'git'
  if (first === 'cargo') return 'rust'
  return null
}


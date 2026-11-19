import { describe, expect, it } from 'vitest';
import { parseExecutable, tokenize, validateCommand } from './commandPolicy';

describe('commandPolicy', () => {
  it('bloque les chaînages, redirections et téléchargements', () => {
    expect(validateCommand('npm run build && curl http://x').safe).toBe(false);
    expect(validateCommand('npm run build > out.txt').safe).toBe(false);
    expect(validateCommand('curl https://example.com').safe).toBe(false);
  });

  it('bloque l’exécution inline de code et les chemins absolus', () => {
    expect(validateCommand('node -e "process.exit(0)"').safe).toBe(false);
    expect(validateCommand('python -c "print(1)"').safe).toBe(false);
    expect(validateCommand('/usr/bin/node script.mjs').safe).toBe(false);
  });

  it('autorise une commande simple', () => {
    expect(validateCommand('npm run build')).toEqual({ safe: true });
    expect(validateCommand('git status')).toEqual({ safe: true });
  });

  it('résout les arguments vers le nom de scope Tauri', () => {
    expect(parseExecutable('npm run build')).toEqual({ cmdName: 'npm-2', args: ['run', 'build'] });
    expect(parseExecutable('npm run build -- --watch')).toEqual({ cmdName: 'npm-4', args: ['run', 'build', '--', '--watch'] });
    expect(parseExecutable('npx -y package')).toBeNull();
    expect(parseExecutable('npm a b c d e f g h i')).toBeNull();
  });

  it('tokenise les arguments entre guillemets', () => {
    expect(tokenize('npm run "build prod"')).toEqual(['npm', 'run', 'build prod']);
  });
});

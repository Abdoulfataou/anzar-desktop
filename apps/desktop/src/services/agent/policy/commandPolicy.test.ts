import { describe, expect, it } from 'vitest';
import { AGENT_PROGRAMS, BLOCKED_RULES, MAX_ARGS, parseExecutable, PROGRAMS, tokenize, validateCommand } from './commandPolicy';

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
    expect(parseExecutable('npm run build')).toEqual({ cmdName: 'npm-2', args: ['run', 'build'], known: true });
    expect(parseExecutable('npm run build -- --watch')).toEqual({ cmdName: 'npm-4', args: ['run', 'build', '--', '--watch'], known: true });
    // npx : accepté ici, l'accord de l'utilisateur est exigé ensuite (installation).
    expect(parseExecutable('npx -y package')).toEqual({ cmdName: 'npx-2', args: ['-y', 'package'], known: true });
    expect(parseExecutable(`npm ${Array.from({ length: 25 }, (_, i) => `a${i}`).join(' ')}`)).toBeNull();
    // Programme hors liste : accepté (accord sur la carte), interdit : refusé.
    expect(parseExecutable('supabase start')).toEqual({ cmdName: 'supabase-1', args: ['start'], known: false });
    expect(parseExecutable('bash script.sh')).toBeNull();
    expect(parseExecutable('./gradlew assembleDebug')).toEqual({ cmdName: 'gradlew-1', args: ['assembleDebug'], known: true });
  });

  it('tokenise les arguments entre guillemets', () => {
    expect(tokenize('npm run "build prod"')).toEqual(['npm', 'run', 'build prod']);
  });

  it('dérive programmes, plafonds et motifs du manifeste partagé', () => {
    expect(MAX_ARGS).toBe(24);
    expect(PROGRAMS).toContain('ffmpeg');
    expect(AGENT_PROGRAMS).toContain('rg');
    // ffprobe est autorisé au lanceur mais pas exposé à l'agent.
    expect(PROGRAMS).toContain('ffprobe');
    expect(AGENT_PROGRAMS).not.toContain('ffprobe');
    for (const rule of BLOCKED_RULES) {
      expect(rule.id).toBeTruthy();
      expect(rule.reason.length).toBeGreaterThan(10);
    }
  });

  it('donne une raison actionnable pour les cas courants', () => {
    expect(validateCommand('node -e "1"').reason).toContain('fichier script');
    expect(validateCommand('npm run build | sh').reason).toContain('pipes');
    expect(validateCommand('/usr/bin/npm run build').reason).toContain('chemins absolus');
  });

  it('accepte les programmes ajoutés au manifeste', () => {
    expect(validateCommand('ffmpeg -version')).toEqual({ safe: true });
    expect(parseExecutable('ffmpeg -version')).toEqual({ cmdName: 'ffmpeg-1', args: ['-version'], known: true });
    expect(parseExecutable('rg --version')).toEqual({ cmdName: 'rg-1', args: ['--version'], known: true });
  });
});

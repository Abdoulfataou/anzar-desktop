import { describe, expect, it } from 'vitest';
import {
  analyzerHint, backgroundedNotice, hidesProgress, lastLines, neverEndingCommand, testRunnerHint, timeoutAdvice,
} from './commandHints';

describe('commandes qui ne s’arrêtent jamais seules', () => {
  it('reconnaît serveurs, surveillance et suivi de journal', () => {
    for (const c of [
      'npm run dev', 'pnpm dev', 'yarn start', 'bun run watch', 'npx next dev -p 3001', 'npx vite', 'vite --port 5173',
      'ng serve', 'npx expo start', 'flutter run -d chrome', 'python3 -m http.server 8000', 'python manage.py runserver',
      'uvicorn app:app --reload', 'php artisan serve', 'docker compose up', 'tail -f logs/app.log', 'tsc --watch', 'jest --watch',
    ]) {
      expect(neverEndingCommand(c), c).not.toBeNull();
    }
  });

  it('laisse les commandes qui se terminent', () => {
    for (const c of [
      'npm run build', 'npm test', 'vite build', 'npx vitest run', 'vitest run src', 'flutter test', 'flutter build apk',
      'docker compose up -d', 'docker compose up --detach api', 'npm i -D vite', 'pnpm add vite', 'tail -n 50 log.txt',
      'git log --oneline -5', 'python -m pytest',
    ]) {
      expect(neverEndingCommand(c), c).toBeNull();
    }
  });
});

describe('conseils quand une commande dépasse son délai', () => {
  it('ne conseille jamais d’allonger le délai, et explique le cas réel (flutter test | tail)', () => {
    const msg = timeoutAdvice({ command: 'flutter test test/app_test.dart 2>&1 | tail -40', timeoutMs: 300_000, output: '\n', backgroundAvailable: true });
    expect(msg).toContain('[délai dépassé] arrêtée après 300 s');
    expect(msg).toContain('ne la relance pas avec un délai plus long');
    expect(msg).not.toMatch(/timeoutMs plus grand|délai plus grand/);
    expect(msg).toContain('flutter test --timeout 30s');
    expect(msg).toContain('tearDown');
    expect(msg).toContain('| tail');
    expect(msg).toContain('Aucune sortie avant l’arrêt.');
  });

  it('montre les dernières lignes produites', () => {
    const output = Array.from({ length: 30 }, (_, i) => `ligne ${i + 1}`).join('\n');
    const msg = timeoutAdvice({ command: 'npm run build', timeoutMs: 120_000, output, backgroundAvailable: true });
    expect(msg).toContain('ligne 30');
    expect(msg).not.toContain('ligne 15\n');
    expect(msg).toContain('run_in_background');
  });

  it('sans arrière-plan (run_command), oriente vers start_dev_server pour un serveur', () => {
    const msg = timeoutAdvice({ command: 'npm run dev', timeoutMs: 120_000, output: 'ready on :3000', backgroundAvailable: false });
    expect(msg).toContain('start_dev_server');
    expect(msg).not.toContain('run_in_background');
  });

  it('outils annexes', () => {
    expect(hidesProgress('pytest | tail -20')).toBe(true);
    expect(hidesProgress('pytest -x')).toBe(false);
    expect(lastLines('a\n\nb\nc\n', 2)).toBe('b\nc');
    expect(testRunnerHint('go test ./...')).toContain('-timeout');
    expect(testRunnerHint('ls')).toBeNull();
    expect(backgroundedNotice('serveur Vite')).toContain('job_kill');
  });
});

describe('vérification des langages sans diagnostics intégrés', () => {
  it('donne la commande du langage', () => {
    expect(analyzerHint('lib/main.dart')).toContain('dart analyze');
    expect(analyzerHint('src/lib.rs')).toBe('cargo check');
    expect(analyzerHint('app/Http/Kernel.php')).toContain('php -l');
    expect(analyzerHint('README.md')).toBeNull();
  });
});

/**
 * Conseils sur les commandes : reconnaître celles qui ne s'arrêtent jamais seules, et dire
 * quoi faire quand une commande dépasse son délai.
 *
 * Cas réel à l'origine de ce module : un agent lance `flutter test … | tail -40` au premier
 * plan avec un délai de 300 s. Le test ne se termine pas (une ressource jamais fermée dans
 * le nettoyage), `tail` n'affiche rien avant la fin, et l'outil répondait « relance avec un
 * délai plus grand ». L'agent a attendu deux fois 5 minutes sans rien apprendre.
 *
 * Tout ici est pur (pas d'accès au système) : testable et partagé par bash, powershell et
 * run_command.
 */

/** Commandes qui tournent jusqu'à ce qu'on les arrête : serveurs, mode surveillance, suivi de journal. */
const NEVER_ENDING: { pattern: RegExp; label: string }[] = [
  { pattern: /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:dev|serve|watch|start)\b/, label: 'serveur ou mode surveillance du projet' },
  { pattern: /\bnext\s+(?:dev|start)\b/, label: 'serveur Next.js' },
  { pattern: /\bvite(?:\s+(?:dev|serve|preview))?(?:\s+--[\w-]+(?:[= ]\S+)?)*\s*$/, label: 'serveur Vite' },
  { pattern: /\bnuxt\s+dev\b|\bastro\s+dev\b|\bremix\s+dev\b|\bsvelte-kit\s+dev\b/, label: 'serveur de développement' },
  { pattern: /\bng\s+serve\b/, label: 'serveur Angular' },
  { pattern: /\bexpo\s+start\b|\breact-native\s+start\b/, label: 'serveur Expo / Metro' },
  { pattern: /\bflutter\s+run\b/, label: 'application Flutter en cours d’exécution' },
  { pattern: /\bpython3?\s+-m\s+http\.server\b/, label: 'serveur HTTP Python' },
  { pattern: /\bmanage\.py\s+runserver\b|\bflask\s+run\b|\buvicorn\b[^|;&]*--reload\b/, label: 'serveur Python' },
  { pattern: /\b(?:bin\/)?rails\s+s(?:erver)?\b|\bphp\s+artisan\s+serve\b|\bphp\s+-S\b/, label: 'serveur web' },
  { pattern: /\bdocker(?:-compose|\s+compose)\s+up\b(?![^|;&]*(?:\s-d\b|--detach))/, label: 'conteneurs au premier plan (docker compose up sans -d)' },
  { pattern: /\btail\s+-[a-zA-Z]*[fF]\b/, label: 'suivi de journal (tail -f)' },
  { pattern: /\b(?:Get-Content|gc|cat|type)\b[^|;&]*\s-Wait\b/i, label: 'suivi de journal (Get-Content -Wait)' },
  { pattern: /\bnodemon\b|\bwebpack(?:-dev-server|\s+serve)\b|\bhugo\s+server\b|\bjekyll\s+serve\b/, label: 'serveur ou surveillance' },
  { pattern: /(?:^|\s)--watch(?:All)?\b|\bjest\b[^|;&]*\s--watch\b|\bvitest\s+(?:watch|dev)\b/, label: 'mode surveillance (--watch)' },
];

/** Libellé de la commande si elle ne s'arrête jamais seule, sinon null. */
export function neverEndingCommand(command: string): string | null {
  const c = command.trim();
  // Installer un outil n'est pas le lancer (« npm i -D vite » se termine).
  if (/\b(?:npm|pnpm|yarn|bun)\s+(?:i|install|add|remove|uninstall|ci)\b|\bpip3?\s+install\b/.test(c)) return null;
  for (const { pattern, label } of NEVER_ENDING) if (pattern.test(c)) return label;
  return null;
}

/** Lanceurs de tests : comment borner chaque test et éviter le mode surveillance. */
const TEST_RUNNERS: { pattern: RegExp; hint: string }[] = [
  { pattern: /\bflutter\s+test\b/, hint: 'flutter test --timeout 30s (délai par test) et --plain-name "<nom>" pour un seul test' },
  { pattern: /\bdart\s+test\b/, hint: 'dart test --timeout 30s et --name "<nom>" pour un seul test' },
  { pattern: /\bvitest\b/, hint: 'vitest run --testTimeout=20000 (jamais le mode surveillance) et -t "<nom>" pour un seul test' },
  { pattern: /\bjest\b/, hint: 'jest --testTimeout=20000 --detectOpenHandles (signale ce qui empêche la fin) et -t "<nom>"' },
  { pattern: /\bpytest\b/, hint: 'pytest -x --timeout=60 (extension pytest-timeout) et -k "<nom>" pour un seul test' },
  { pattern: /\bgo\s+test\b/, hint: 'go test -timeout 60s -run "<Nom>" (affiche la pile des goroutines bloquées)' },
  { pattern: /\bcargo\s+test\b/, hint: 'cargo test <nom> -- --nocapture, et un délai explicite dans le test qui attend' },
  { pattern: /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b/, hint: 'regarde le script « test » du package.json : sans mode surveillance (CI=true pour react-scripts), avec un délai par test' },
  { pattern: /\b(?:\.\/)?gradlew\b[^|;&]*\btest\b|\bxcodebuild\b[^|;&]*\btest\b/, hint: 'lance un seul test ou une seule classe d’abord ; la première compilation peut être longue : arrière-plan + job_output' },
];

export function testRunnerHint(command: string): string | null {
  for (const { pattern, hint } of TEST_RUNNERS) if (pattern.test(command)) return hint;
  return null;
}

/** La sortie passe par un filtre qui n'affiche rien avant la fin (tail, head, grep, sort…). */
export function hidesProgress(command: string): boolean {
  return /\|\s*(?:tail|head|grep|sort|uniq|wc|less|more)\b/.test(command)
    || /\|\s*(?:Select-Object|select)\b[^|]*-(?:Last|First)\b|\|\s*(?:Sort-Object|Measure-Object|Select-String|sls)\b/i.test(command);
}

/** Dernières lignes non vides d'une sortie, pour montrer où la commande en était. */
export function lastLines(text: string, count = 15): string {
  const lines = text.split('\n').filter((l) => l.trim());
  return lines.slice(-count).join('\n');
}

/** Marqueur de début du message de délai dépassé (repéré par le point d'étape). */
export const TIMEOUT_MARKER = '[délai dépassé]';

/**
 * Message rendu quand une commande a été arrêtée parce qu'elle dépassait son délai.
 * Il ne conseille JAMAIS d'allonger le délai : une commande bloquée le reste.
 */
export function timeoutAdvice(input: { command: string; timeoutMs: number; output: string; backgroundAvailable: boolean }): string {
  const seconds = Math.round(input.timeoutMs / 1000);
  const shown = lastLines(input.output);
  const lines: string[] = [
    `${TIMEOUT_MARKER} arrêtée après ${seconds} s. Elle est probablement bloquée (attente sans fin, ressource jamais fermée, invite qui attend une réponse, mode surveillance) : ne la relance pas avec un délai plus long, trouve pourquoi elle ne se termine pas.`,
  ];
  const server = neverEndingCommand(input.command);
  if (server) {
    lines.push(`- Cette commande ne s'arrête jamais seule (${server}) : ${input.backgroundAvailable ? 'lance-la avec run_in_background, ou start_dev_server pour une app web.' : 'utilise start_dev_server pour une app web.'}`);
  }
  const runner = testRunnerHint(input.command);
  if (runner) {
    lines.push(`- Tests : borne chaque test pour voir lequel bloque — ${runner}.`);
    lines.push("- Un test qui expire peut bloquer dans sa préparation (setUp) ou son nettoyage (tearDown), pas seulement dans son corps : cherche une ressource jamais fermée (flux, socket, base, minuteur) ou un await qui n'aboutit jamais.");
  }
  if (!shown && hidesProgress(input.command)) {
    lines.push('- Aucune sortie : le filtre en fin de commande (| tail, | head, | grep…) n’affiche rien tant que la commande n’est pas finie. Pour suivre la progression, écris la sortie dans un fichier (> /tmp/log.txt 2>&1) et lis-le, ou lance-la en arrière-plan.');
  }
  if (input.backgroundAvailable && !server) {
    lines.push('- Une commande vraiment longue (build complet, installation, première compilation) : run_in_background, puis job_output avec wait_ms pour lire la sortie au fur et à mesure, et job_kill si elle n’avance plus.');
  }
  lines.push(shown ? `Dernières lignes avant l'arrêt :\n${shown}` : 'Aucune sortie avant l’arrêt.');
  return lines.join('\n');
}

/** Marqueur d'une commande qui a atteint son délai et continue en arrière-plan. */
export const STILL_RUNNING_MARKER = '[toujours en cours]';

/**
 * Message rendu quand une commande au premier plan atteint son délai : elle n'est PAS tuée
 * (un build légitime de 4 minutes ne doit pas être relancé), elle continue en arrière-plan.
 */
export function stillRunningAdvice(input: { command: string; seconds: number; output: string; jobId: string }): string {
  const shown = lastLines(input.output);
  const lines: string[] = [
    `${STILL_RUNNING_MARKER} après ${input.seconds} s, la commande continue en arrière-plan (job_id: ${input.jobId}). Elle n'a pas été arrêtée : ne la relance pas.`,
    '- Lis la suite avec job_output (il attend lui-même jusqu’à 30 s, ou wait_ms) ; arrête-la avec job_kill.',
    '- Une commande qui devait finir (tests, build court) et dont la sortie n’avance plus est probablement bloquée : job_kill, puis cherche pourquoi au lieu de la relancer à l’identique.',
  ];
  const runner = testRunnerHint(input.command);
  if (runner) {
    lines.push(`- Tests : borne chaque test pour voir lequel bloque — ${runner}. Un test peut bloquer dans sa préparation ou son nettoyage, pas seulement dans son corps.`);
  }
  if (!shown && hidesProgress(input.command)) {
    lines.push('- Aucune sortie visible : le filtre en fin de commande (| tail, | head, | grep…) n’affiche rien avant la fin. La prochaine fois, écris la sortie dans un fichier et lis-le.');
  }
  lines.push(shown ? `Dernières lignes :\n${shown}` : 'Aucune sortie pour le moment.');
  return lines.join('\n');
}

/** Notice ajoutée quand une commande sans fin a été passée d'office en arrière-plan. */
export function backgroundedNotice(label: string): string {
  return `[lancée en arrière-plan] cette commande ne s'arrête jamais seule (${label}) : au premier plan, elle aurait bloqué jusqu'au délai. ` +
    "Lis la suite avec job_output, arrête-la avec job_kill quand tu n'en as plus besoin ; pour une app web, start_dev_server vérifie aussi la page.";
}

/** Vérificateur à lancer pour un langage sans serveur de diagnostics intégré. */
export function analyzerHint(path: string): string | null {
  const ext = (/\.([a-z0-9]+)$/i.exec(path)?.[1] || '').toLowerCase();
  const map: Record<string, string> = {
    dart: 'dart analyze <fichier> (ou flutter analyze dans un projet Flutter)',
    go: 'go vet ./... puis go build ./...',
    rs: 'cargo check',
    swift: 'swift build (ou xcodebuild build)',
    kt: './gradlew compileDebugKotlin (Android) ou ./gradlew build',
    kts: './gradlew help (vérifie les scripts Gradle)',
    java: './gradlew compileJava (ou mvn -q compile)',
    php: 'php -l <fichier>',
    rb: 'ruby -c <fichier>',
    cs: 'dotnet build',
    c: 'cc -fsyntax-only <fichier>',
    cpp: 'c++ -fsyntax-only <fichier>',
    sh: 'bash -n <fichier>',
    json: 'node -e "JSON.parse(require(\'fs\').readFileSync(process.argv[1],\'utf8\'))" <fichier>',
    yaml: 'le validateur du projet (ou python3 -c "import yaml,sys; yaml.safe_load(open(sys.argv[1]))" <fichier>)',
    yml: 'le validateur du projet (ou python3 -c "import yaml,sys; yaml.safe_load(open(sys.argv[1]))" <fichier>)',
  };
  return map[ext] ?? null;
}

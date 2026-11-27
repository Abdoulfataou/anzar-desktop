/**
 * Tests de bout en bout d'ANZAR : la vraie application (Rust + WebView2) pilotée par
 * WebDriver à travers `tauri-driver`, comme le décrit la documentation Tauri 2.
 *
 * Prérequis (installés par la CI, voir .github/workflows/ci.yml, job desktop-windows) :
 *   - l'application compilée : `npx tauri build --debug --no-bundle` dans apps/desktop ;
 *   - `tauri-driver` : `cargo install tauri-driver --locked` ;
 *   - sous Windows, `msedgedriver.exe` de la même version que WebView2
 *     (e2e/scripts/prepare-edgedriver.ps1 s'en charge).
 *
 * Variables utiles :
 *   ANZAR_E2E_APP   chemin du binaire à tester (défaut : src-tauri/target/debug/app[.exe])
 *   TAURI_DRIVER    chemin de tauri-driver (défaut : ~/.cargo/bin/tauri-driver[.exe])
 *   MSEDGEDRIVER    chemin de msedgedriver.exe (sinon tauri-driver le cherche dans le PATH)
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const exe = process.platform === 'win32' ? '.exe' : '';
const application = process.env.ANZAR_E2E_APP
  || path.resolve(here, '..', 'src-tauri', 'target', 'debug', `app${exe}`);
const tauriDriverBin = process.env.TAURI_DRIVER
  || path.resolve(os.homedir(), '.cargo', 'bin', `tauri-driver${exe}`);
const artefacts = path.resolve(here, 'artefacts');

let tauriDriver;
let exiting = false;

export const config = {
  runner: 'local',
  hostname: '127.0.0.1',
  port: 4444,
  specs: ['./specs/**/*.e2e.js'],
  maxInstances: 1,
  capabilities: [
    {
      maxInstances: 1,
      'tauri:options': { application },
    },
  ],
  logLevel: 'warn',
  reporters: ['spec'],
  framework: 'mocha',
  mochaOpts: { ui: 'bdd', timeout: 120_000 },
  waitforTimeout: 30_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 2,

  onPrepare: () => {
    if (!fs.existsSync(application)) {
      throw new Error(`Application introuvable : ${application}\n`
        + 'Compile-la d\'abord : npx tauri build --debug --no-bundle (dans apps/desktop).');
    }
    fs.mkdirSync(artefacts, { recursive: true });
  },

  // tauri-driver doit tourner avant la session : il relaie WebDriver vers msedgedriver.
  beforeSession: () => {
    const args = process.env.MSEDGEDRIVER ? ['--native-driver', process.env.MSEDGEDRIVER] : [];
    tauriDriver = spawn(tauriDriverBin, args, { stdio: [null, process.stdout, process.stderr] });
    tauriDriver.on('error', (error) => {
      console.error('tauri-driver : erreur', error);
      process.exit(1);
    });
    tauriDriver.on('exit', (code) => {
      if (!exiting) {
        console.error('tauri-driver s\'est arrêté (code', code, ')');
        process.exit(1);
      }
    });
  },

  // Une capture d'écran par test raté : la CI les publie en artefact.
  afterTest: async (test, _context, { passed }) => {
    if (passed) return;
    const name = `${test.parent} - ${test.title}`.replace(/[^\p{L}\p{N} _-]+/gu, '_').slice(0, 120);
    try {
      await browser.saveScreenshot(path.join(artefacts, `${name}.png`));
    } catch (error) {
      console.error('Capture impossible :', error);
    }
  },

  afterSession: () => closeTauriDriver(),
};

function closeTauriDriver() {
  exiting = true;
  tauriDriver?.kill();
}

function onShutdown(fn) {
  const cleanup = () => {
    try {
      fn();
    } finally {
      process.exit();
    }
  };
  process.on('exit', cleanup);
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('SIGHUP', cleanup);
  process.on('SIGBREAK', cleanup);
}

// afterSession ne tourne pas si la session échoue à démarrer : on ferme aussi à la sortie.
onShutdown(closeTauriDriver);

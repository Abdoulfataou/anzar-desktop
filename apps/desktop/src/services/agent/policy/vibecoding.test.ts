/**
 * Liste des programmes élargie pour le vibecoding (Flutter, JS, mobile natif, autres langages) :
 * programmes interdits, installations soumises à accord, programmes inconnus.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/filesystem/fileSystem', () => ({
  fileSystemService: { readFile: vi.fn(async () => { throw new Error('absent'); }) },
}));

import { precheckCommand } from '../tools';
import { commandRisk, noteAgentWrite } from './commandGuard';
import { isDeniedProgram, isInstallCommand, ruleRefusal } from './commandPolicy';

describe('programmes de vibecoding', () => {
  it('accepte les outils courants au pré-contrôle', () => {
    for (const cmd of ['flutter analyze', 'flutter create --org app.x .', 'dart format lib', 'pnpm run dev',
      'go test ./...', './gradlew assembleDebug', 'pod install', 'dotnet build', 'bundle exec rspec', 'supabase start']) {
      expect(precheckCommand(cmd), cmd).toBeNull();
    }
  });

  it('refuse les programmes interdits, même ceux qui n\'ont pas de motif dédié', () => {
    expect(precheckCommand('bash build.sh')).toMatch(/interdit/);
    expect(precheckCommand('osascript x.scpt')).toMatch(/interdit/);
    expect(precheckCommand('xcrun --sdk iphoneos sh')).toMatch(/interdit/);
    expect(precheckCommand('bundle exec bash')).toMatch(/interdit/);
    expect(precheckCommand('flutter upgrade')).toMatch(/SDK Flutter/);
    expect(precheckCommand('pnpm publish')).toMatch(/publication/);
    expect(precheckCommand('git submodule foreach ls')).toMatch(/shell/);
    expect(precheckCommand('ruby -e "puts 1"')).toBeTruthy();
    expect(isDeniedProgram('PowerShell.exe')).toBe(true);
    expect(ruleRefusal('flutter', ['build', 'apk'])).toBeNull();
  });

  it('classe les installations de chaque outil', () => {
    expect(isInstallCommand('flutter', ['pub', 'get'])).toBe(true);
    expect(isInstallCommand('flutter', ['--no-color', 'pub', 'add', 'http'])).toBe(true);
    expect(isInstallCommand('flutter', ['analyze'])).toBe(false);
    expect(isInstallCommand('yarn', [])).toBe(true);
    expect(isInstallCommand('yarn', ['build'])).toBe(false);
    expect(isInstallCommand('go', ['mod', 'tidy'])).toBe(true);
    expect(isInstallCommand('npx', ['create-next-app'])).toBe(true);
    expect(isInstallCommand('docker', ['compose', 'up'])).toBe(true);
  });
});

describe('accord demandé (commandRisk)', () => {
  it('installation Flutter : accord', async () => {
    const r = await commandRisk('t1', '/p', 'flutter pub get');
    expect(r?.reason).toMatch(/installe/);
    expect(r?.unknownProgram).toBeUndefined();
  });

  it('programme inconnu : accord + proposition « toujours autoriser », sauf s\'il est déjà autorisé', async () => {
    const r = await commandRisk('t2', '/p', 'supabase start');
    expect(r?.unknownProgram).toBe('supabase');
    expect(await commandRisk('t2', '/p', 'supabase start', { trustedPrograms: ['supabase'] })).toBeNull();
  });

  it('commande sans risque d\'un outil connu : rien de plus que le mode habituel', async () => {
    expect(await commandRisk('t3', '/p', 'flutter analyze')).toBeNull();
    expect(await commandRisk('t3', '/p', 'go vet ./...')).toBeNull();
  });

  it('script de build ou fichier écrit par l\'agent : accord', async () => {
    await noteAgentWrite('t4', '/p', 'android/app/build.gradle');
    expect((await commandRisk('t4', '/p', './gradlew assembleDebug'))?.reason).toMatch(/build\.gradle/);
    await noteAgentWrite('t5', '/p', 'Makefile');
    expect((await commandRisk('t5', '/p', 'make'))?.reason).toMatch(/makefile/i);
    await noteAgentWrite('t6', '/p', 'cmd/tool/main.go');
    expect((await commandRisk('t6', '/p', 'go run cmd/tool/main.go'))?.reason).toMatch(/main\.go/);
  });
});

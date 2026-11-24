import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (cmd: string, a?: unknown) => invoke(cmd, a) }));

import { applyCommandPolicy, policyFromSettings, pullCommandPolicy, settingsFromPolicy, trustProgram } from './commandPolicy';
import { useSettingsStore } from '@/stores/settingsStore';

const asTauri = () => { (window as any).__TAURI_INTERNALS__ = {}; };

describe('réglages de sécurité des commandes', () => {
  beforeEach(() => {
    invoke.mockReset();
    delete (window as any).__TAURI_INTERNALS__;
    useSettingsStore.getState().updateSettings({
      sandboxCommands: true, commandNetwork: true, networkProxy: true, networkAllowedHosts: [], trustedPrograms: [],
    });
  });

  it('convertit réglages ↔ politique Rust (valeurs absentes = protégé)', () => {
    expect(policyFromSettings({})).toEqual({ sandbox: true, network: true, proxy: true, extraHosts: [], trustedPrograms: [] });
    const p = { sandbox: false, network: false, proxy: true, extraHosts: ['api.x.com'], trustedPrograms: ['supabase'] };
    expect(policyFromSettings(settingsFromPolicy(p))).toEqual(p);
    expect(policyFromSettings({ networkAllowedHosts: [' a.com ', ''] }).extraHosts).toEqual(['a.com']);
  });

  it('enregistre ce que Rust a accepté', async () => {
    asTauri();
    invoke.mockResolvedValueOnce({ sandbox: false, network: true, proxy: true, extraHosts: [], trustedPrograms: [] });
    const r = await applyCommandPolicy({ sandboxCommands: false });
    expect(r.ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith('command_policy_set', {
      policy: { sandbox: false, network: true, proxy: true, extraHosts: [], trustedPrograms: [] },
    });
    expect(useSettingsStore.getState().settings.sandboxCommands).toBe(false);
  });

  it('garde la protection si l\'utilisateur annule la confirmation système', async () => {
    asTauri();
    invoke
      .mockRejectedValueOnce('Changement annulé : la protection reste en place.')
      .mockResolvedValueOnce({ sandbox: true, network: true, proxy: true, extraHosts: [], trustedPrograms: [] });
    const r = await applyCommandPolicy({ sandboxCommands: false });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('annulé');
    expect(useSettingsStore.getState().settings.sandboxCommands).toBe(true);
  });

  it('au démarrage, reprend les réglages de Rust', async () => {
    asTauri();
    invoke.mockResolvedValueOnce({ sandbox: true, network: false, proxy: true, extraHosts: ['b.com'], trustedPrograms: [] });
    await pullCommandPolicy();
    const s = useSettingsStore.getState().settings;
    expect(s.commandNetwork).toBe(false);
    expect(s.networkAllowedHosts).toEqual(['b.com']);
  });

  it('hors Tauri (navigateur, tests), applique directement sans appeler Rust', async () => {
    const r = await applyCommandPolicy({ networkProxy: false });
    expect(r.ok).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().settings.networkProxy).toBe(false);
  });

  it('« Toujours autoriser » passe par Rust (confirmation système)', async () => {
    asTauri();
    invoke.mockResolvedValueOnce({ sandbox: true, network: true, proxy: true, extraHosts: [], trustedPrograms: ['supabase'] });
    const r = await trustProgram('Supabase');
    expect(r.ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith('command_policy_set', {
      policy: { sandbox: true, network: true, proxy: true, extraHosts: [], trustedPrograms: ['supabase'] },
    });
    expect(useSettingsStore.getState().settings.trustedPrograms).toEqual(['supabase']);
  });
});

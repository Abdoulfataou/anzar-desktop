import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (cmd: string, a?: unknown) => invoke(cmd, a) }));

import { applyCommandPolicy, policyFromSettings, pullCommandPolicy, settingsFromPolicy } from './commandPolicy';
import { useSettingsStore } from '@/stores/settingsStore';

const asTauri = () => { (window as any).__TAURI_INTERNALS__ = {}; };

describe('réglage d’isolation des commandes', () => {
  beforeEach(() => {
    invoke.mockReset();
    delete (window as any).__TAURI_INTERNALS__;
    useSettingsStore.getState().updateSettings({ sandboxCommands: true });
  });

  it('convertit réglage ↔ politique Rust', () => {
    expect(policyFromSettings({})).toEqual({ sandbox: true });
    expect(settingsFromPolicy({ sandbox: false })).toEqual({ sandboxCommands: false });
  });

  it('enregistre ce que Rust a accepté', async () => {
    asTauri();
    invoke.mockResolvedValueOnce({ sandbox: false });
    const r = await applyCommandPolicy({ sandboxCommands: false });
    expect(r.ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith('command_policy_set', { policy: { sandbox: false } });
    expect(useSettingsStore.getState().settings.sandboxCommands).toBe(false);
  });

  it('garde la protection si l’utilisateur annule', async () => {
    asTauri();
    invoke.mockRejectedValueOnce('Changement annulé').mockResolvedValueOnce({ sandbox: true });
    const r = await applyCommandPolicy({ sandboxCommands: false });
    expect(r.ok).toBe(false);
    expect(useSettingsStore.getState().settings.sandboxCommands).toBe(true);
  });

  it('hors Tauri, applique directement', async () => {
    const r = await applyCommandPolicy({ sandboxCommands: false });
    expect(r.ok).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
  });
});

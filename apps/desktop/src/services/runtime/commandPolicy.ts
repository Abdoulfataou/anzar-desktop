/**
 * Réglages de sécurité des commandes de l'agent (isolation, réseau, filtrage, hôtes).
 *
 * La référence est côté Rust (`src-tauri/src/command_policy.rs`) : l'interface ne fait que
 * l'afficher et demander des changements. Un changement qui affaiblit la protection est
 * confirmé par une fenêtre native du système ; si l'utilisateur annule, rien ne change.
 * (Audit sécurité du 23/11/2026, point #3.)
 */
import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '@/lib/utils';
import { useSettingsStore, type Settings } from '@/stores/settingsStore';

/** Forme attendue par `command_policy_get` / `command_policy_set`. */
export interface CommandPolicy {
  sandbox: boolean;
}

export type PolicySettings = Pick<Settings, 'sandboxCommands'>;

export function policyFromSettings(s: PolicySettings): CommandPolicy {
  return { sandbox: s.sandboxCommands !== false };
}

export function settingsFromPolicy(p: CommandPolicy): PolicySettings {
  return { sandboxCommands: p.sandbox };
}

function currentPolicySettings(): PolicySettings {
  return { sandboxCommands: useSettingsStore.getState().settings.sandboxCommands };
}

/** Au démarrage : l'interface reprend les réglages enregistrés par Rust. */
export async function pullCommandPolicy(): Promise<void> {
  if (!isTauri()) return;
  try {
    const saved = await invoke<CommandPolicy>('command_policy_get');
    useSettingsStore.getState().updateSettings(settingsFromPolicy(saved));
  } catch {
    // Ancienne version du cœur Rust : les réglages de l'interface restent affichés.
  }
}

/**
 * Change un ou plusieurs réglages de sécurité. Rust demande confirmation si le changement
 * affaiblit la protection ; en cas de refus, les réglages affichés restent ceux de Rust.
 */
export async function applyCommandPolicy(patch: Partial<PolicySettings>): Promise<{ ok: boolean; error?: string }> {
  const store = useSettingsStore.getState();
  const next: PolicySettings = { ...currentPolicySettings(), ...patch };
  if (!isTauri()) {
    store.updateSettings(patch);
    return { ok: true };
  }
  try {
    const saved = await invoke<CommandPolicy>('command_policy_set', { policy: policyFromSettings(next) });
    store.updateSettings(settingsFromPolicy(saved));
    return { ok: true };
  } catch (e) {
    await pullCommandPolicy();
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

import { describe, expect, it } from 'vitest';
import { approvalDecision } from './toolPolicy';

const base = {
  mode: 'full' as const,
  tool: 'read_file',
  mcpReadOnly: false,
  mcpAsk: false,
  background: false,
  risk: null,
  personalSpace: false,
  trusted: false,
};

describe('approvalDecision', () => {
  it('mode plan : refuse les outils d’écriture, autorise la lecture et propose_plan', () => {
    expect(approvalDecision({ ...base, mode: 'plan', tool: 'write_file' }).allowed).toBe(false);
    expect(approvalDecision({ ...base, mode: 'plan', tool: 'read_file' }).allowed).toBe(true);
    expect(approvalDecision({ ...base, mode: 'plan', tool: 'propose_plan' }).allowed).toBe(true);
  });

  it('mode ask : demande pour écrire, pas pour lire', () => {
    expect(approvalDecision({ ...base, mode: 'ask', tool: 'write_file' }).ask).toBe(true);
    expect(approvalDecision({ ...base, mode: 'ask', tool: 'read_file' }).ask).toBe(false);
  });

  it('mode auto : demande pour une commande, pas pour une écriture', () => {
    expect(approvalDecision({ ...base, mode: 'auto', tool: 'run_command' }).ask).toBe(true);
    expect(approvalDecision({ ...base, mode: 'auto', tool: 'write_file' }).ask).toBe(false);
  });

  it('espace ANZAR : pas d’accord pour écrire, sauf risque non encore autorisé', () => {
    expect(approvalDecision({ ...base, mode: 'ask', tool: 'write_file', personalSpace: true }).ask).toBe(false);
    expect(approvalDecision({ ...base, mode: 'ask', tool: 'run_command', personalSpace: true, risk: { reason: 'script modifié' }, trusted: false }).ask).toBe(true);
    // Un accord de code dans l'espace ANZAR ne couvre plus un risque réseau/installation.
    expect(approvalDecision({ ...base, mode: 'ask', tool: 'run_command', personalSpace: true, risk: { reason: 'script modifié' }, trusted: true }).ask).toBe(true);
  });

  it('automatisation : refuse toute action qui demanderait une approbation', () => {
    const auto = approvalDecision({ ...base, mode: 'auto', background: true, tool: 'run_command' });
    expect(auto.allowed).toBe(false);
    expect(auto.ask).toBe(false);
    expect(auto.refusal).toContain('personne');

    const write = approvalDecision({ ...base, mode: 'ask', background: true, tool: 'write_file' });
    expect(write.allowed).toBe(false);
    expect(write.ask).toBe(false);
  });

  it('automatisation : refuse sans demander, avec une explication', () => {
    const risk = approvalDecision({ ...base, background: true, risk: { reason: 'commande risquée' } });
    expect(risk.allowed).toBe(false);
    expect(risk.refusal).toContain('commande risquée');

    const mcp = approvalDecision({ ...base, background: true, mcpAsk: true, mcpName: 'GitHub' });
    expect(mcp.allowed).toBe(false);
    expect(mcp.refusal).toContain('GitHub');
  });

  it('Accès complet accepté : installation ou commande risquée sans demande', () => {
    const d = approvalDecision({ ...base, tool: 'run_command', risk: { reason: 'installe du code' } });
    expect(d).toEqual({ allowed: true, ask: false });
    // Hors Full, le risque demande toujours un accord
    expect(approvalDecision({ ...base, mode: 'auto', tool: 'run_command', risk: { reason: 'x' } }).ask).toBe(true);
    // Connecteur réglé sur « toujours demander » : demande, même en Full
    expect(approvalDecision({ ...base, tool: 'mcp__gimp__x', mcpAsk: true, mcpAction: true }).ask).toBe(true);
  });

  it('après un contenu externe : en Full, demande seulement si des consignes cachées sont repérées', () => {
    const external = { suspicious: false };
    expect(approvalDecision({ ...base, tool: 'run_command' }).ask).toBe(false);
    expect(approvalDecision({ ...base, tool: 'run_command', external }).ask).toBe(false);
    expect(approvalDecision({ ...base, tool: 'run_command', external: { suspicious: true } }).ask).toBe(true);
    expect(approvalDecision({ ...base, tool: 'mcp__x__send', mcpAction: true, external: { suspicious: true } }).ask).toBe(true);
    // Hors Full, tout contenu externe impose l'accord pour une commande
    expect(approvalDecision({ ...base, mode: 'auto', tool: 'run_command', external }).ask).toBe(true);
    // Écrire un fichier ou lire reste libre en Full
    expect(approvalDecision({ ...base, tool: 'write_file', external }).ask).toBe(false);
    expect(approvalDecision({ ...base, tool: 'read_file', external }).ask).toBe(false);
  });

  it('automatisation : contenu suspect → commande refusée, contenu normal → inchangé', () => {
    const bg = { ...base, background: true, tool: 'run_command' };
    expect(approvalDecision({ ...bg, external: { suspicious: true } }).allowed).toBe(false);
    expect(approvalDecision({ ...bg, external: { suspicious: false } }).allowed).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { permissionOptions } from './ChatInput';

describe('explications du sélecteur de permissions', () => {
  it('Windows : ne promet pas que les commandes partent sans demander', () => {
    const win = Object.fromEntries(permissionOptions(true).map((o) => [o.id, o.hint]));
    expect(win.ask).toContain('chaque commande te demande ton accord');
    expect(win.auto).toContain('ne peut pas lancer de commandes');
    expect(win.ask).not.toContain('écrit et exécute dans le projet sans demander');
  });

  it('Mac : explications d’origine, mêmes modes des deux côtés', () => {
    const mac = permissionOptions(false);
    expect(mac.find((o) => o.id === 'ask')?.hint).toContain('écrit et exécute dans le projet sans demander');
    expect(mac.map((o) => o.id)).toEqual(permissionOptions(true).map((o) => o.id));
  });
});

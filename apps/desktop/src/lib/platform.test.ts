import { afterEach, describe, expect, it } from 'vitest';
import { commandShell, isMacPlatform, isWindowsPlatform } from './platform';

const saved = { platform: navigator.platform, ua: navigator.userAgent };
const simulate = (platform: string, ua: string) => {
  Object.defineProperty(navigator, 'platform', { value: platform, configurable: true });
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
};
afterEach(() => simulate(saved.platform, saved.ua));

describe('plateforme', () => {
  it('macOS : bash', () => {
    simulate('MacIntel', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    expect(isMacPlatform()).toBe(true);
    expect(isWindowsPlatform()).toBe(false);
    expect(commandShell()).toBe('bash');
  });

  it('Windows : powershell', () => {
    simulate('Win32', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    expect(isWindowsPlatform()).toBe(true);
    expect(commandShell()).toBe('powershell');
  });

  it('« Darwin » n’est pas pris pour Windows (il contient « win »)', () => {
    simulate('', 'Darwin');
    expect(isWindowsPlatform()).toBe(false);
    expect(commandShell()).toBe('bash');
  });

  it('Linux (non distribué) : pas de shell, run_command seul', () => {
    simulate('Linux x86_64', 'Mozilla/5.0 (X11; Linux x86_64)');
    expect(commandShell()).toBeNull();
  });
});

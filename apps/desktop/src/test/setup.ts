import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
  localStorage.clear();
});


// Permet de lancer toute la suite sous une plateforme simulée :
//   ANZAR_TEST_PLATFORM=linux   npx vitest run
//   ANZAR_TEST_PLATFORM=mac     npx vitest run
//   ANZAR_TEST_PLATFORM=windows npx vitest run
// Sur un vrai runner Windows, la CI passe aussi ANZAR_TEST_PLATFORM=windows : jsdom
// ne copie pas navigator.platform du système, il faut donc le forcer.
const forcedPlatform = process.env.ANZAR_TEST_PLATFORM?.toLowerCase();
if (forcedPlatform) {
  const kind = forcedPlatform === 'mac' || forcedPlatform === 'darwin'
    ? 'mac'
    : forcedPlatform === 'windows' || forcedPlatform === 'win' || forcedPlatform === 'win32'
      ? 'windows'
      : 'linux';
  const platform = { mac: 'MacIntel', windows: 'Win32', linux: 'Linux x86_64' }[kind];
  const userAgent = {
    mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
  }[kind];
  Object.defineProperty(navigator, 'platform', { value: platform, configurable: true });
  Object.defineProperty(navigator, 'userAgent', { value: userAgent, configurable: true });
}

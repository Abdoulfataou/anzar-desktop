import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
  localStorage.clear();
});


// Permet de lancer toute la suite sous une plateforme simulée :
//   ANZAR_TEST_PLATFORM=linux npx vitest run
//   ANZAR_TEST_PLATFORM=mac   npx vitest run
const forcedPlatform = process.env.ANZAR_TEST_PLATFORM?.toLowerCase();
if (forcedPlatform) {
  const isMac = forcedPlatform === 'mac' || forcedPlatform === 'darwin';
  const platform = isMac ? 'MacIntel' : 'Linux x86_64';
  const userAgent = isMac
    ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    : 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36';
  Object.defineProperty(navigator, 'platform', { value: platform, configurable: true });
  Object.defineProperty(navigator, 'userAgent', { value: userAgent, configurable: true });
}

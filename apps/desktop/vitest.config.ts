import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  esbuild: {
    // Évite de remonter jusqu'à un tsconfig parent (Expo) hors du projet.
    tsconfigRaw: { compilerOptions: { target: 'es2022' } },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts'],
  },
});

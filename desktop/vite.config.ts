import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { sentryVitePlugin } from '@sentry/vite-plugin';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));
const RELEASE = `anzar-desktop@${pkg.version}`;

export default defineConfig(() => {
  const plugins: any[] = [react()];

  // Sentry sourcemaps upload (only in CI/release when token is available)
  const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;
  const sentryOrg = process.env.SENTRY_ORG;
  const sentryProject = process.env.SENTRY_PROJECT;
  const enableSentryUpload = !!(sentryAuthToken && sentryOrg && sentryProject);
  if (enableSentryUpload) {
    plugins.push(
      sentryVitePlugin({
        org: sentryOrg!,
        project: sentryProject!,
        authToken: sentryAuthToken!,
        release: RELEASE,
        include: './dist',
        urlPrefix: '~/',
      })
    );
  }

  return {
    plugins,
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: false,
  },
  envPrefix: ['VITE_', 'TAURI_'],
  // SECURITY: define() overrides prevent accidental API key leaks in bundle
  define: {
    'import.meta.env.VITE_DEEPSEEK_API_KEY': 'undefined',
    'import.meta.env.VITE_KIMI_API_KEY': 'undefined',
    __APP_VERSION__: JSON.stringify(pkg.version),
    __SENTRY_RELEASE__: JSON.stringify(RELEASE),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    target: 'es2021',
    minify: 'esbuild',
    sourcemap: enableSentryUpload,
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor': ['react', 'react-dom', 'react-router-dom'],
          'ui': ['lucide-react', 'class-variance-authority', 'clsx', 'tailwind-merge'],
        },
      },
    },
  },
  };
});

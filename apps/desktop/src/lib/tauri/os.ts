/**
 * Adaptateur Tauri 2 pour les informations système.
 * Le plugin-os v2 est synchrone (contrairement à l'API v1).
 */
import { platform, type as osType } from '@tauri-apps/plugin-os';

export { platform, osType };

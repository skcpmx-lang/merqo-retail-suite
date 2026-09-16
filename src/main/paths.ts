import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

export interface AppPaths {
  userData: string;
  dbFile: string;
  backupDir: string;
  exportDir: string;
  logDir: string;
  logFile: string;
  imageDir: string;
  tempDir: string;
}

let overrideDir: string | null = null;

/** Test hook: redirect user-data root. */
export function setUserDataRoot(dir: string): void {
  overrideDir = dir;
}

/**
 * Resolve Electron's app lazily so unit/integration tests (plain Node, no Electron
 * runtime) can import this module safely. Returns null outside Electron.
 */
function electronApp(): { getPath: (name: string) => string } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron') as { app?: { getPath: (name: string) => string } } | string;
    if (typeof electron === 'string' || !electron || !(electron as { app?: unknown }).app) return null;
    return (electron as { app: { getPath: (name: string) => string } }).app;
  } catch {
    return null;
  }
}

export function getPaths(): AppPaths {
  const app = electronApp();
  const userData = overrideDir ?? app?.getPath('userData') ?? path.join(os.homedir(), '.merqo-retail-suite');
  const dbFile = path.join(userData, 'merqo.db');
  const backupDir = path.join(userData, 'backups');
  const exportDir = path.join(userData, 'exports');
  const logDir = path.join(userData, 'logs');
  const imageDir = path.join(userData, 'images');
  const tempDir = path.join(userData, 'temp');
  for (const d of [userData, backupDir, exportDir, logDir, imageDir, tempDir]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
  return { userData, dbFile, backupDir, exportDir, logDir, logFile: path.join(logDir, 'merqo.log'), imageDir, tempDir };
}

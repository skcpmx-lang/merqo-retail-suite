import fs from 'node:fs';
import { getPaths } from './paths';

type Level = 'info' | 'warn' | 'error';

function redact(s: string): string {
  return s
    .replace(/("password"|password_hash|password_salt|pin_hash)"?\s*:\s*"[^"]*"/gi, '$1:"[redacted]"')
    .replace(/password=[^\s&]*/gi, 'password=[redacted]');
}

function write(level: Level, scope: string, message: string, extra?: unknown): void {
  try {
    const { logFile } = getPaths();
    const line =
      `${new Date().toISOString()} [${level.toUpperCase()}] [${scope}] ${redact(message)}` +
      (extra !== undefined ? ` ${redact(typeof extra === 'string' ? extra : JSON.stringify(extra)).slice(0, 2000)}` : '') +
      '\n';
    fs.appendFileSync(logFile, line);
    // Rotate at ~2MB
    const st = fs.statSync(logFile);
    if (st.size > 2 * 1024 * 1024) {
      fs.renameSync(logFile, logFile + '.1');
    }
  } catch {
    // Logging must never crash the app.
  }
}

export const logger = {
  info: (scope: string, msg: string, extra?: unknown) => write('info', scope, msg, extra),
  warn: (scope: string, msg: string, extra?: unknown) => write('warn', scope, msg, extra),
  error: (scope: string, msg: string, extra?: unknown) => write('error', scope, msg, extra),
};

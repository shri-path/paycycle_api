/**
 * logErrorToFile — writes error details + correlationId to Logs/YYYY-MM-DD.txt
 * Uses fs.appendFileSync (lightweight, no extra dependencies).
 * Falls back gracefully if the write fails.
 */
import fs from 'fs';
import path from 'path';

const LOG_DIR = path.resolve(process.cwd(), 'Logs');

function ensureLogDir(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

export function logErrorToFile(error: Error, context: Record<string, unknown> = {}): void {
  try {
    ensureLogDir();
    const filePath = path.join(LOG_DIR, `${todayStr()}.txt`);
    const timestamp = new Date().toISOString();
    const line = JSON.stringify({
      timestamp,
      message: error.message,
      stack: error.stack,
      ...context,
    });
    fs.appendFileSync(filePath, line + '\n', 'utf8');
  } catch {
    // Never throw from the logging path
  }
}

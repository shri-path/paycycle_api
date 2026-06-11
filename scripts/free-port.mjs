// Frees the dev server port before `npm run dev` starts.
// Reads PORT from .env (falling back to process.env.PORT, then 3000),
// finds the process listening on it, and kills it. Cross-platform, no deps.
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

function resolvePort() {
  if (process.env.PORT) return Number(process.env.PORT);
  try {
    const env = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
    const match = env.match(/^\s*PORT\s*=\s*"?(\d+)"?/m);
    if (match) return Number(match[1]);
  } catch {
    // no .env file — fall through
  }
  return 3000;
}

function pidsOnPort(port) {
  const pids = new Set();
  try {
    if (process.platform === 'win32') {
      const out = execSync(`netstat -ano -p tcp`, { encoding: 'utf8' });
      for (const line of out.split('\n')) {
        // ...:PORT ... LISTENING   <pid>
        const m = line.match(new RegExp(`[:.]${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`));
        if (m) pids.add(m[1]);
      }
    } else {
      const out = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { encoding: 'utf8' });
      out.split('\n').filter(Boolean).forEach((p) => pids.add(p.trim()));
    }
  } catch {
    // nothing listening — lsof/netstat returns non-zero or empty
  }
  return [...pids];
}

const port = resolvePort();
const pids = pidsOnPort(port);

if (pids.length === 0) {
  console.log(`Port ${port} is free.`);
} else {
  for (const pid of pids) {
    try {
      process.kill(Number(pid), 'SIGKILL');
      console.log(`Freed port ${port} (killed PID ${pid}).`);
    } catch (err) {
      console.warn(`Could not kill PID ${pid} on port ${port}: ${err.message}`);
    }
  }
}

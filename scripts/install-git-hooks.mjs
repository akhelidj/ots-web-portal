// Installs the git hooks (simple-git-hooks) on `npm install`. Best-effort: it must never
// fail an install where the hooks are irrelevant (CI/production `npm ci --omit=dev`, a
// tarball without .git, ...).
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

if (!existsSync('.git') || process.env.CI || process.env.SKIP_GIT_HOOKS) {
  process.exit(0);
}
const bin = 'node_modules/simple-git-hooks/cli.js';
if (!existsSync(bin)) process.exit(0);
const res = spawnSync(process.execPath, [bin], { stdio: 'inherit' });
if (res.status !== 0) console.warn('git hooks were not installed (non-fatal).');

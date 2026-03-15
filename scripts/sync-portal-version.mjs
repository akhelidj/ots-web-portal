import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const packageJsonPath = path.join(root, 'package.json');
const outputPath = path.join(
  root,
  'portal',
  'src',
  'app',
  'core',
  'config',
  'app-version.ts',
);

async function syncVersion() {
  const packageRaw = await readFile(packageJsonPath, 'utf8');
  const pkg = JSON.parse(packageRaw);
  const version = pkg.version || '0.0.0';
  const content = `export const APP_VERSION = '${version}';\n`;

  await writeFile(outputPath, content, 'utf8');
}

await syncVersion();

import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const files = ['server.js'];
for (const directory of ['public', 'lib']) {
  for (const name of readdirSync(join(root, directory)).sort()) {
    if (name.endsWith('.js')) files.push(join(directory, name));
  }
}
for (const file of files) {
  const child = spawnSync(process.execPath, ['--check', join(root, file)], { stdio: 'inherit' });
  if (child.error) throw child.error;
  if (child.status !== 0) process.exit(child.status ?? 1);
}
console.log(`Syntax checked ${files.length} source files`);

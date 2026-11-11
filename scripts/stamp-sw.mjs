// Обновляет версию и список файлов в sw.js. Запускать перед каждой публикацией: npm run stamp

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ENTRIES = ['index.html', 'manifest.webmanifest', 'css', 'js', 'assets', 'apps-script'];

function walk(path) {
  if (statSync(path).isFile()) return [path];
  return readdirSync(path).flatMap((name) => walk(join(path, name)));
}

const files = ENTRIES.flatMap((entry) => walk(join(ROOT, entry)))
  .filter((file) => !file.endsWith('.txt'))
  .map((file) => relative(ROOT, file).split('\\').join('/'))
  .sort();

const hash = createHash('sha256');
for (const file of files) hash.update(file).update(readFileSync(join(ROOT, file)));
const version = hash.digest('hex').slice(0, 12);

const swPath = join(ROOT, 'sw.js');
const source = readFileSync(swPath, 'utf8');
const list = files.map((file) => `  './${file}',`).join('\n');
const next = source
  .replace(/const VERSION = '[^']*';/, `const VERSION = '${version}';`)
  .replace(/const FILES = \[[\s\S]*?\];/, `const FILES = [\n  './',\n${list}\n];`);
writeFileSync(swPath, next);
console.log(`sw.js: версия ${version}, файлов ${files.length}`);

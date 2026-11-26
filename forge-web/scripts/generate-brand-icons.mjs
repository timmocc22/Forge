import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mark = await readFile(join(root, 'src/assets/forge-mark.svg'), 'utf8');
const artwork = mark.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
  <rect width="64" height="64" rx="16" fill="#242424" />
  <g transform="translate(4 4) scale(.875)">${artwork}</g>
</svg>\n`;
const desktop = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" fill="none">
  <defs>
    <linearGradient id="tile" x1="160" y1="64" x2="864" y2="960" gradientUnits="userSpaceOnUse">
      <stop stop-color="#303036" />
      <stop offset="1" stop-color="#1b1b1f" />
    </linearGradient>
  </defs>
  <rect x="32" y="32" width="960" height="960" rx="224" fill="url(#tile)" />
  <g transform="translate(96 96) scale(13)">${artwork}</g>
</svg>\n`;

await writeFile(join(root, 'public/forge.svg'), favicon);
const source = join(root, 'src-tauri/icons/source.svg');
await writeFile(source, desktop);
const temporary = await mkdtemp(join(tmpdir(), 'forge-icons-'));
try {
  execFileSync(
    process.execPath,
    [join(root, 'node_modules/@tauri-apps/cli/tauri.js'), 'icon', source, '--output', temporary],
    { cwd: root, stdio: 'pipe' },
  );
  for (const name of [
    '32x32.png',
    '64x64.png',
    '128x128.png',
    '128x128@2x.png',
    'icon.png',
    'icon.icns',
    'icon.ico',
  ]) {
    await copyFile(join(temporary, name), join(root, 'src-tauri/icons', name));
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
console.log('Updated Forge favicon and desktop icons from forge-mark.svg.');

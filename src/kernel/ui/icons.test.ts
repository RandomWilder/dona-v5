// #241. A screen never writes its own <svg>. The one table is icons.ts.
// A test may quote the tag it asserts, so this scan skips *.test.ts.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { icon } from './icons.ts';

const srcRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
  'src',
);
const home = path.join(srcRoot, 'kernel', 'ui', 'icons.ts');
const needle = `<${'svg'}`;

function filesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) found.push(...filesUnder(full));
    else if (!name.endsWith('.test.ts')) found.push(full);
  }
  return found;
}

describe('icons live in one table', () => {
  it('finds no svg outside src/kernel/ui/icons.ts', () => {
    const hits: string[] = [];
    for (const file of filesUnder(srcRoot)) {
      if (file === home) continue;
      const text = readFileSync(file, 'utf8');
      if (text.includes(needle)) hits.push(path.relative(srcRoot, file));
    }
    assert.deepEqual(hits, []);
  });
});

describe('icon', () => {
  it('emits the wrapper the screens already use', () => {
    assert.equal(
      icon('chevron', { class: 'chev' }).value,
      '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
    );
    assert.equal(
      icon('plus').value,
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
    );
  });

  it('names an icon that stands alone, and hides one that does not', () => {
    assert.match(icon('mail', { label: 'דוא״ל' }).value, /aria-label="דוא״ל"/);
    assert.doesNotMatch(icon('mail', { label: 'דוא״ל' }).value, /aria-hidden/);
    assert.match(icon('mail').value, /aria-hidden="true"/);
  });
});

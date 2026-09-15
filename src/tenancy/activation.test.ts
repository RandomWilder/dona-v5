// #106. The tenancy module does not import evidence; the reader is injected.
import assert from 'node:assert/strict';
import { glob, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const tenancyRoot = path.dirname(fileURLToPath(import.meta.url));

describe('tenancy · activation boundary', () => {
  it('imports no evidence module', async () => {
    const hits: string[] = [];
    for await (const entry of glob('**/*.ts', { cwd: tenancyRoot })) {
      if (entry.endsWith('.test.ts')) continue;
      const source = await readFile(path.join(tenancyRoot, entry), 'utf8');
      if (/from ['"][^'"]*\/evidence\//.test(source)) {
        hits.push(entry);
      }
    }
    assert.deepEqual(hits, []);
  });
});

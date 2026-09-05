import assert from 'node:assert/strict';
import { glob, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

// SPEC.md rule 9 and SPEC-kernel.md: the kernel imports from no domain module. Slice 1.4's Verify
// asks for a grep, and the grep was run — but a grep run once into an evidence file guards nothing
// after the session ends, and this constraint has to hold for every slice after this one. So it is
// a test: it runs on `npm test` today and inside `gate` from 1.6, and it fails on the day someone
// reaches for `estate` from inside `kernel/audit.ts` rather than a month later.
const kernelRoot = path.dirname(fileURLToPath(import.meta.url));

// SPEC.md's module map, which is the vocabulary the kernel is not allowed to know.
const modules = [
  'staff',
  'estate',
  'parties',
  'tenancy',
  'evidence',
  'scope',
  'policy',
  'calls',
  'channel',
];

const importSpecifier =
  /(?:import|export)[\s\S]*?from\s+'([^']+)'|import\s*\(\s*'([^']+)'/g;

async function kernelFiles(): Promise<string[]> {
  const found: string[] = [];
  for await (const entry of glob('**/*.ts', { cwd: kernelRoot })) {
    found.push(entry);
  }
  return found.sort();
}

describe('the kernel boundary', () => {
  it('has files to check at all', async () => {
    // A glob matching nothing is silent, and a guard over an empty set is a guard that passes
    // because it looked at nothing (slice 1.3, on `node --test` globs). Assert the floor.
    const files = await kernelFiles();
    assert.ok(files.length > 20, `only found ${files.length} kernel files`);
  });

  it('imports from no domain module', async () => {
    const violations: string[] = [];
    for (const file of await kernelFiles()) {
      const source = await readFile(path.join(kernelRoot, file), 'utf8');
      for (const match of source.matchAll(importSpecifier)) {
        const specifier = match[1] ?? match[2];
        if (!specifier) continue;

        // A relative path that climbs out of src/kernel/ — the way the boundary actually breaks,
        // since a sibling module is always reached as '../<module>/contract.ts'.
        if (specifier.startsWith('.')) {
          const target = path.relative(
            kernelRoot,
            path.resolve(path.dirname(path.join(kernelRoot, file)), specifier),
          );
          if (target.startsWith('..')) {
            violations.push(`${file} → ${specifier}`);
          }
          continue;
        }

        // A bare specifier naming a module, for the day someone adds a path alias.
        const head = specifier.split('/')[0];
        if (modules.includes(head)) {
          violations.push(`${file} → ${specifier}`);
        }
      }
    }
    assert.deepEqual(violations, []);
  });
});

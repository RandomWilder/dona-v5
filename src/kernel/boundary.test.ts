import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { glob, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

// SPEC.md rule 9 and SPEC-kernel.md: the kernel imports from no domain module. Slice 1.4's Verify
// asks for a grep, and the grep was run — but a grep run once into an evidence file guards nothing
// after the session ends, and this constraint has to hold for every slice after this one. So it is
// a test: it runs on `npm test` today and inside `gate` from 1.6, and it fails on the day someone
// reaches for `estate` from inside `kernel/audit.ts` rather than a month later.
//
// **Two boundaries from slice 2.4, not one.** `AGENTS.md` has said since week 1 that "a module
// imports another's `contract.ts`, never its `internal/`, and a CI grep guard enforces both" — and
// no such guard existed. It cost nothing while every module was a leaf. 2.4 is the slice where
// `src/register/` imports four modules' contracts, so the claim became load-bearing and is made
// real here, which is the move guard three made at 1.12: a control written down for eleven days
// with nothing behind it is a control that is about to be discovered missing.
//
// It lives in this file rather than in scripts/guards.ts because it is the same question from the
// other side — who may import whom — and because the module list is already here.
const kernelRoot = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.dirname(kernelRoot);

// SPEC.md's module map, which is the vocabulary the kernel is not allowed to know.
const modules = [
  'staff',
  'estate',
  'parties',
  'tenancy',
  'evidence',
  'scope',
  // Slice 2.4. Owns no entity — the register file format, its parser and its reject contract — and
  // sits above scope because it calls `normalisePhone` (SPEC.md, module map).
  'register',
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

// ------------------------------------------------------------------------------------------------
// The module boundary. Slice 2.4.
// ------------------------------------------------------------------------------------------------

async function moduleFiles(): Promise<Array<{ module: string; file: string }>> {
  const found: Array<{ module: string; file: string }> = [];
  for (const module of modules) {
    const root = path.join(srcRoot, module);
    for await (const entry of glob('**/*.ts', { cwd: root })) {
      found.push({ module, file: path.join(module, entry) });
    }
  }
  return found.sort((a, b) => a.file.localeCompare(b.file));
}

describe('the module boundary', () => {
  it('has files to check at all', async () => {
    // A glob matching nothing is silent, and a guard over an empty set is one that passes because it
    // looked at nothing (1.3, on `node --test` globs; and §6's rule that a guard which scanned
    // nothing fails). Five module directories exist at 2.4.
    const files = await moduleFiles();
    const scanned = new Set(files.map((entry) => entry.module));
    assert.ok(files.length > 10, `only found ${files.length} module files`);
    assert.ok(
      scanned.size >= 5,
      `only found modules ${[...scanned].join(', ')}`,
    );
  });

  it('reaches another module only through its contract.ts', async () => {
    const violations: string[] = [];
    for (const { module, file } of await moduleFiles()) {
      const source = await readFile(path.join(srcRoot, file), 'utf8');
      for (const match of source.matchAll(importSpecifier)) {
        const specifier = match[1] ?? match[2];
        if (!specifier?.startsWith('.')) continue;
        const target = path.relative(
          srcRoot,
          path.resolve(path.dirname(path.join(srcRoot, file)), specifier),
        );
        const head = target.split(path.sep)[0];
        // The kernel is everyone's, and a module's own internals are its own. What is forbidden is
        // reaching *past another module's front door* — the import that makes a private decision
        // somebody else's dependency, and the one nobody notices until it has to change.
        if (!head || head === module || !modules.includes(head)) continue;
        if (target.split(path.sep).includes('internal')) {
          violations.push(`${file} → ${specifier}`);
        }
      }
    }
    assert.deepEqual(violations, []);
  });
});

// ------------------------------------------------------------------------------------------------
// R9 — nothing deterministic reads ExtractedField. Slice 4.3, A8's governed half.
// ------------------------------------------------------------------------------------------------

const R9_MODULES = ['policy', 'scope', 'calls'] as const;

describe('R9 · policy, isolation and the state machine never read extracted_field', () => {
  it('scans those trees, including empty ones, and finds no mention', async () => {
    const hits: string[] = [];
    let scanned = 0;
    for (const module of R9_MODULES) {
      const root = path.join(srcRoot, module);
      if (!existsSync(root)) {
        continue;
      }
      for await (const entry of glob('**/*.ts', { cwd: root })) {
        scanned += 1;
        const file = path.join(root, entry);
        const source = await readFile(file, 'utf8');
        if (source.includes('extracted_field')) {
          hits.push(path.join(module, entry));
        }
      }
    }
    assert.ok(
      scanned >= 1,
      'R9 scanned no files — a guard over an empty set passes forever',
    );
    assert.deepEqual(hits, []);
  });
});

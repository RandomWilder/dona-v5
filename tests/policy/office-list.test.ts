// POLICY CASE — the office lettings list is a Building-bound staff tool.
//
// #123. Offering the roll on a Unit bound, a portfolio bound, or a tenant path
// would put neighbour occupancy in a bag the model did not earn. That is not a
// judgement a model may make, so the case lives here rather than in evals.
//
// Written red first: the first run failed because `listOfficeLettings` was not
// on the evidence contract.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { listOfficeLettings } from '../../src/evidence/contract.ts';
import { systemClock } from '../../src/kernel/clock.ts';
import { KernelError } from '../../src/kernel/errors.ts';
import { newId } from '../../src/kernel/ids.ts';
import {
  inRolledBackTransaction,
  skipReason,
} from '../../src/kernel/pg-support.ts';
import { policyPool } from './support.ts';

const SRC = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'src',
);

describe('policy · the lettings list is refused off a Building bound', () => {
  it('is a command error on a Unit bound and on the portfolio', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        await assert.rejects(
          () =>
            listOfficeLettings(db, systemClock, {
              kind: 'unit',
              id: newId(),
            }),
          (error: unknown) =>
            error instanceof KernelError && error.code === 'not_allowed',
        );
        await assert.rejects(
          () => listOfficeLettings(db, systemClock, { kind: 'portfolio' }),
          (error: unknown) =>
            error instanceof KernelError && error.code === 'not_allowed',
        );
      });
    } finally {
      await pool.end();
    }
  });

  it('is not assembled on a tenant-facing path', async () => {
    const channelRoot = path.join(SRC, 'channel');
    const hits: string[] = [];
    if (existsSync(channelRoot)) {
      const files = await readdir(channelRoot, { recursive: true });
      for (const file of files) {
        if (!file.endsWith('.ts')) continue;
        const source = await readFile(path.join(channelRoot, file), 'utf8');
        if (
          source.includes('listOfficeLettings') ||
          source.includes('listActiveLettingsInBuilding')
        ) {
          hits.push(file);
        }
      }
    }
    assert.deepEqual(hits, []);
  });
});

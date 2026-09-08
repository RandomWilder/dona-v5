// Slice 4.6. A lease names a person and often no ת.ז. — createParty is an insert.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  inRolledBackTransaction,
  migratedPoolOrNull,
  skipReason,
} from '../kernel/pg-support.ts';
import { createParty } from './contract.ts';

describe('parties · createParty', () => {
  it('inserts a person with no ת.ז., and a second call is a second person', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const first = await createParty(db, {
          kind: 'PERSON',
          fullName: 'יעל כהן',
          preferredLanguage: 'he',
        });
        const second = await createParty(db, {
          kind: 'PERSON',
          fullName: 'יעל כהן',
          preferredLanguage: 'he',
        });
        assert.notEqual(first.id, second.id);
        assert.equal(first.inserted, true);
        assert.equal(second.inserted, true);
        const rows = await db.query<{ national_id: string | null }>(
          `SELECT national_id FROM party WHERE party_id = ANY($1)`,
          [[first.id, second.id]],
        );
        assert.equal(rows.rows.length, 2);
        assert.equal(rows.rows[0]?.national_id, null);
        assert.equal(rows.rows[1]?.national_id, null);
      });
    } finally {
      await pool.end();
    }
  });
});

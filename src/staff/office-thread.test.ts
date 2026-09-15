// The office retrieval thread: one history per staff account × retrieval bound.
// Ticket #113. Tests go through the public commands, not the tables.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fixedClock } from '../kernel/clock.ts';
import { newId } from '../kernel/ids.ts';
import {
  inRolledBackTransaction,
  migratedPoolOrNull,
  skipReason,
} from '../kernel/pg-support.ts';
import {
  addOperator,
  appendOfficeRetrievalTurn,
  clearOfficeRetrievalThread,
  loadOfficeRetrievalThread,
} from './contract.ts';

const AT = new Date('2026-09-16T09:00:00.000Z');

describe('staff · office retrieval thread', () => {
  it('is empty until a turn is appended, then lists oldest first', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const { account } = await addOperator(db, clock, {
          email: `${newId(clock)}@office.test`,
          role: 'OPERATOR',
        });
        const bound = { kind: 'unit' as const, id: newId(clock) };
        const empty = await loadOfficeRetrievalThread(
          db,
          account.staffAccountId,
          bound,
        );
        assert.deepEqual(empty, []);

        await appendOfficeRetrievalTurn(db, clock, {
          staffAccountId: account.staffAccountId,
          bound,
          question: 'שאלה ראשונה',
          answer: 'תשובה ראשונה',
          refused: false,
          citations: [{ documentId: 'doc-a', page: 2, documentType: 'lease' }],
          hitIds: [newId(clock)],
        });
        await appendOfficeRetrievalTurn(db, clock, {
          staffAccountId: account.staffAccountId,
          bound,
          question: 'שאלה שנייה',
          answer: 'סירוב',
          refused: true,
          citations: [],
          hitIds: [],
        });

        const turns = await loadOfficeRetrievalThread(
          db,
          account.staffAccountId,
          bound,
        );
        assert.equal(turns.length, 2);
        assert.equal(turns[0]?.question, 'שאלה ראשונה');
        assert.equal(turns[0]?.refused, false);
        assert.equal(turns[1]?.question, 'שאלה שנייה');
        assert.equal(turns[1]?.refused, true);
        assert.deepEqual(turns[1]?.citations, []);
      });
    } finally {
      await pool.end();
    }
  });

  it('keeps a second staff account off the first thread on the same Unit', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const unit = { kind: 'unit' as const, id: newId(clock) };
        const first = await addOperator(db, clock, {
          email: `${newId(clock)}@office.test`,
          role: 'OPERATOR',
        });
        const second = await addOperator(db, clock, {
          email: `${newId(clock)}@office.test`,
          role: 'VIEWER',
        });
        await appendOfficeRetrievalTurn(db, clock, {
          staffAccountId: first.account.staffAccountId,
          bound: unit,
          question: 'שאלת הראשון',
          answer: 'תשובה',
          refused: false,
          citations: [],
          hitIds: [],
        });
        const other = await loadOfficeRetrievalThread(
          db,
          second.account.staffAccountId,
          unit,
        );
        assert.deepEqual(other, []);
      });
    } finally {
      await pool.end();
    }
  });

  it('clear removes only that account’s thread on that bound', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const unit = { kind: 'unit' as const, id: newId(clock) };
        const first = await addOperator(db, clock, {
          email: `${newId(clock)}@office.test`,
          role: 'OPERATOR',
        });
        const second = await addOperator(db, clock, {
          email: `${newId(clock)}@office.test`,
          role: 'OPERATOR',
        });
        const turn = {
          bound: unit,
          question: 'שאלה',
          answer: 'תשובה',
          refused: false,
          citations: [],
          hitIds: [],
        };
        await appendOfficeRetrievalTurn(db, clock, {
          ...turn,
          staffAccountId: first.account.staffAccountId,
        });
        await appendOfficeRetrievalTurn(db, clock, {
          ...turn,
          staffAccountId: second.account.staffAccountId,
        });
        await clearOfficeRetrievalThread(
          db,
          first.account.staffAccountId,
          unit,
        );
        assert.deepEqual(
          await loadOfficeRetrievalThread(
            db,
            first.account.staffAccountId,
            unit,
          ),
          [],
        );
        const kept = await loadOfficeRetrievalThread(
          db,
          second.account.staffAccountId,
          unit,
        );
        assert.equal(kept.length, 1);
        assert.equal(kept[0]?.question, 'שאלה');
      });
    } finally {
      await pool.end();
    }
  });
});

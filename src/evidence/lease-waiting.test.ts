// #238. ממתינים לפתיחה in שכירויות.
//
// Seam: HTTP at the app. A lease with no `TENANCY` link is listed at the top of שכירויות for a role
// holding `documents.write`, with its upload date, the main tenant name as read, the file, and the
// next step for its reading: המשך קריאה back to הקריאה, or פתח טיוטה once it is ready. Opening the
// draft takes it off the list. Every case runs over one rolled-back transaction, so the shared
// database may hold other unopened leases; the cases assert this lease's row, never a count.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type Finding,
  withOpening as fileLease,
  type Opening,
} from '../../tests/support/lease-opening.ts';
import { renderTenanciesPage } from '../estate/contract.ts';
import { skipReason } from '../kernel/pg-support.ts';
import { h } from '../kernel/ui/html.ts';
import { DEFAULT_TERMS_PROFILE } from './contract.ts';

const ON = new Date('2026-10-14T09:00:00.000Z');
const MAIN = 'נועה ממתינה';

const household = (address: string): Finding[] => [
  { field_key: 'start_date', value: '2026-11-01', word_ids: [0] },
  { field_key: 'end_date', value: '2027-10-31', word_ids: [1] },
  { field_key: 'apartment_number', value: '7', word_ids: [2] },
  { field_key: 'address', value: address, word_ids: [3] },
  { field_key: 'main_tenant_name', value: MAIN, word_ids: [4] },
];

const OPENING_KEYS = ['start_date', 'end_date', 'main_tenant_name'] as const;

const withOpening = (
  spec: {
    tag: string;
    findings?: (address: string) => Finding[];
    placed?: boolean;
  },
  run: (opening: Opening) => Promise<void>,
): Promise<boolean> => fileLease({ on: ON, findings: household, ...spec }, run);

/** This lease's row on the waiting list, or null when it is not listed. */
function rowOf(body: string, documentId: string): string | null {
  const at = body.indexOf(`data-document="${documentId}"`);
  if (at === -1) return null;
  const end = body.indexOf('</li>', at);
  return body.slice(at, end === -1 ? undefined : end);
}

describe('evidence · #238 ממתינים לפתיחה in שכירויות', () => {
  it('lists an unopened lease with its date, the name read, the file and המשך קריאה, then פתח טיוטה, then nothing', async (t) => {
    const ran = await withOpening({ tag: 'wait-238-row' }, async (o) => {
      const before = await o.get('/estate/tenancies');
      assert.equal(before.statusCode, 200, before.body.slice(0, 300));
      assert.match(before.body, /<h2 class="block-title">ממתינים לפתיחה<\/h2>/);
      // At the top: before the book's first section.
      assert.ok(
        before.body.indexOf('ממתינים לפתיחה') <
          before.body.indexOf('<h2 class="block-title">מוכנה</h2>'),
      );
      const row = rowOf(before.body, o.documentId);
      assert.ok(row, 'the lease is listed');
      assert.match(row, /2026-10-14/);
      assert.match(row, new RegExp(MAIN));
      assert.match(row, /href="[^"]*unassigned\/lease\/[0-9a-f]+\.pdf[^"]*"/);
      assert.match(
        row,
        new RegExp(`href="/documents/filing/${o.documentId}">המשך קריאה</a>`),
      );
      assert.doesNotMatch(row, /פתח טיוטה/);

      for (const key of OPENING_KEYS) {
        await o.approve(key);
      }
      const ready = rowOf(
        (await o.get('/estate/tenancies')).body,
        o.documentId,
      );
      assert.ok(ready);
      assert.match(
        ready,
        new RegExp(
          `href="/documents/filing/${o.documentId}/open">פתח טיוטה</a>`,
        ),
      );
      assert.doesNotMatch(ready, /המשך קריאה/);

      const pressed = await o.post(`/documents/filing/${o.documentId}/open`, {
        terms_profile: DEFAULT_TERMS_PROFILE,
      });
      assert.equal(pressed.statusCode, 302, pressed.body.slice(0, 300));
      const after = await o.get('/estate/tenancies');
      assert.equal(rowOf(after.body, o.documentId), null);
    });
    if (!ran) t.skip(skipReason);
  });

  it('marks a lease whose reading named no main tenant', async (t) => {
    const ran = await withOpening(
      {
        tag: 'wait-238-noname',
        findings: (address) =>
          household(address).filter(
            (finding) => finding.field_key !== 'main_tenant_name',
          ),
      },
      async (o) => {
        const row = rowOf(
          (await o.get('/estate/tenancies')).body,
          o.documentId,
        );
        assert.ok(row);
        assert.match(row, /לא נקרא שם/);
        assert.match(row, /המשך קריאה/);
      },
    );
    if (!ran) t.skip(skipReason);
  });

  it('lists a lease filed on a flat before #237 the same way', async (t) => {
    const ran = await withOpening(
      { tag: 'wait-238-placed', placed: true },
      async (o) => {
        const row = rowOf(
          (await o.get('/estate/tenancies')).body,
          o.documentId,
        );
        assert.ok(row, 'the placed lease is listed');
        assert.match(row, new RegExp(MAIN));
        assert.match(row, new RegExp(`/unit/${o.unitId}/lease/`));
        for (const key of OPENING_KEYS) {
          await o.approve(key);
        }
        const ready = rowOf(
          (await o.get('/estate/tenancies')).body,
          o.documentId,
        );
        assert.ok(ready);
        assert.match(ready, /פתח טיוטה/);
        const opening = await o.get(`/documents/filing/${o.documentId}/open`);
        assert.equal(opening.statusCode, 200, opening.body.slice(0, 300));
        assert.match(opening.body, /aria-current="step">פתיחת טיוטה</);
      },
    );
    if (!ran) t.skip(skipReason);
  });

  it('is not shown to a role without documents.write', async (t) => {
    const ran = await withOpening({ tag: 'wait-238-viewer' }, async (o) => {
      const operator = await o.getAs('OPERATOR', '/estate/tenancies');
      assert.ok(rowOf(operator.body, o.documentId));
      const viewer = await o.getAs('VIEWER', '/estate/tenancies');
      assert.equal(viewer.statusCode, 200);
      assert.doesNotMatch(viewer.body, /ממתינים לפתיחה/);
      assert.equal(rowOf(viewer.body, o.documentId), null);
    });
    if (!ran) t.skip(skipReason);
  });

  it('prints no section and no heading when nothing waits', () => {
    const empty = { ready: [], draft: [], waiting: [], active: [], past: [] };
    assert.doesNotMatch(renderTenanciesPage(empty, h``, []), /ממתינים לפתיחה/);
    assert.doesNotMatch(renderTenanciesPage(empty, h``), /ממתינים לפתיחה/);
  });
});

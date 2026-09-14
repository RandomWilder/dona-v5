// Slice 4.6, flow A2: confirm a lease into a DRAFT tenancy.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PoolClient } from 'pg';
import { signedInChrome } from '../chrome.ts';
import { createAuditLog } from '../kernel/audit.ts';
import { fixedClock } from '../kernel/clock.ts';
import type { KernelError } from '../kernel/errors.ts';
import { createFakeExtractor } from '../kernel/extraction.ts';
import { newId } from '../kernel/ids.ts';
import { createMemoryStore } from '../kernel/objects.ts';
import { createFakePdfText } from '../kernel/pdf.ts';
import {
  inRolledBackTransaction,
  migratedPoolOrNull,
  skipReason,
} from '../kernel/pg-support.ts';
import { upsertTermsProfile } from '../tenancy/contract.ts';
import type { IntakeDeps } from './contract.ts';
import {
  applyDocumentTypeCatalogue,
  confirmLeaseTenancy,
  dayOverlap,
  fileDocument,
  listExtractedFields,
  proposeLeaseTenancy,
  rankCandidates,
  renderTenancyPage,
  type TenancyCandidate,
} from './contract.ts';
import { seedDocumentTypes } from './fixtures/document-types.ts';

const AT = new Date('2026-09-08T09:00:00.000Z');
const NAV = signedInChrome('x'.repeat(64), 'documents', true);
const BUCKET = 'dona-v5-test-lease';
const MARKERS = 'חוזה שכירות המושכר תקופת השכירות השוכר';
// The fake page is one word per `word_id`, and a finding whose word_id is past the end is dropped
// on the floor rather than erroring. 6.5's leases name four people, so the page has to be long
// enough to carry them — this filler is the difference between a pairing case and a silent zero.
const PAGE_WORDS = `${MARKERS} ${'מילה '.repeat(24).trim()}`;
const ADDRESS = 'רקפת 12';

/** Slice 6.5: the proposal writes an audit line now, so it takes the deps the confirm always did. */
const READ_BY = 'ops@example.test';
const leaseDeps = (db: PoolClient) => ({
  db,
  audit: createAuditLog(db, fixedClock(AT)),
  clock: fixedClock(AT),
});

const pdfBytes = (marker: string): Buffer =>
  Buffer.from(`%PDF-1.4\n% ${marker}\n`, 'latin1');

async function insertUnit(
  db: PoolClient,
  unitNumber: string,
  addressLine: string,
): Promise<string> {
  const buildingId = newId();
  const unitId = newId();
  await db.query(
    `INSERT INTO building (building_id, name, address_line, city,
                           handover_date, warranty_end_date, status)
     VALUES ($1, 'lease-building', $2, $3, '2020-01-01', '2022-01-01', 'ACTIVE')`,
    // **The tail, not the head.** Ids here are UUIDv7, so the first eight hex characters are a
    // 48-bit millisecond timestamp: two buildings created in the same millisecond share them. This
    // token has to be unique because `building_address_unique` is on `(city, address_line)`, and
    // 6.5 is the first slice to put two buildings at one address in one tick — it failed 23505 on
    // the way in. The last twelve characters are the random half.
    [buildingId, addressLine, `Shoham-${buildingId.slice(24)}`],
  );
  await db.query(
    `INSERT INTO space (space_id, building_id, space_kind, name)
     VALUES ($1, $2, 'UNIT', $3)`,
    [unitId, buildingId, `דירה ${unitNumber}`],
  );
  await db.query(
    `INSERT INTO unit (unit_id, unit_number, rooms, has_mamad, condition_status)
     VALUES ($1, $2, 3.5, true, 'READY')`,
    [unitId, unitNumber],
  );
  return unitId;
}

async function fileLease(
  db: PoolClient,
  unitId: string,
  findings: Array<{ field_key: string; value: string; word_ids: number[] }>,
  marker: string,
  // Slice 6.5. The identifier fields are declared from 13 Sep (6.4's seed rows), and R18's version
  // window is live rather than decorative: a case clocked before that date reads a catalogue that
  // does not declare them and extracts nothing. 6.4 paid one confused run to learn that.
  at: Date = AT,
) {
  const extractor = createFakeExtractor(() => ({ findings }));
  const filed = await fileDocument(
    {
      db,
      objects: createMemoryStore(),
      pdf: createFakePdfText([PAGE_WORDS]),
      audit: createAuditLog(db, fixedClock(at)),
      clock: fixedClock(at),
      bucket: BUCKET,
      extractor,
      extractModel: 'gpt-test',
    } satisfies IntakeDeps,
    {
      bytes: pdfBytes(marker),
      typeKey: 'lease',
      place: { kind: 'UNIT', id: unitId },
      tenancyId: null,
    },
  );
  assert.equal(filed.filed, true);
  if (!filed.filed) {
    throw new Error('not filed');
  }
  return filed.documentId;
}

const matchingFindings = [
  { field_key: 'start_date', value: '2026-03-01', word_ids: [0] },
  { field_key: 'end_date', value: '2027-02-28', word_ids: [1] },
  { field_key: 'apartment_number', value: '12', word_ids: [2] },
  { field_key: 'address', value: 'רקפת 12 שוהם', word_ids: [3] },
  { field_key: 'tenant_name', value: 'יעל כהן', word_ids: [4] },
  { field_key: 'tenant_name', value: 'דן לוי', word_ids: [5] },
];

describe('evidence · flow A2 confirms a lease into a draft tenancy', () => {
  it('writes two tenants, no guarantors, and a second confirm is a no-op', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        await applyDocumentTypeCatalogue(db, seedDocumentTypes);
        const unitId = await insertUnit(db, '12', ADDRESS);
        await upsertTermsProfile(db, `a2-${unitId.slice(24)}`);
        const documentId = await fileLease(
          db,
          unitId,
          matchingFindings,
          'a2-two',
        );
        const proposed = await proposeLeaseTenancy(leaseDeps(db), {
          documentId,
          readBy: READ_BY,
        });
        assert.equal(proposed.matchesUnit, true);
        assert.equal(proposed.people.length, 2);
        assert.equal(proposed.people[0]?.proposedRole, 'PRIMARY_TENANT');
        assert.equal(proposed.people[1]?.proposedRole, 'CO_TENANT');
        assert.ok(
          proposed.termsProfileNames.includes(`a2-${unitId.slice(24)}`),
        );

        const roles = Object.fromEntries(
          proposed.people.map((person) => [
            person.extractedFieldId,
            person.proposedRole,
          ]),
        );
        const deps = {
          db,
          audit: createAuditLog(db, fixedClock(AT)),
          clock: fixedClock(AT),
        };
        const confirmed = await confirmLeaseTenancy(deps, {
          documentId,
          termsProfileName: `a2-${unitId.slice(24)}`,
          confirmedBy: 'אסף',
          roles,
        });
        assert.equal(confirmed.alreadyEstablished, false);
        assert.equal(confirmed.partiesWritten, 2);

        const tenancy = await db.query<{ status: string; start_date: string }>(
          `SELECT status, start_date::text FROM tenancy WHERE tenancy_id = $1`,
          [confirmed.tenancyId],
        );
        assert.equal(tenancy.rows[0]?.status, 'DRAFT');
        assert.equal(tenancy.rows[0]?.start_date, '2026-03-01');

        const parties = await db.query<{ role: string }>(
          `SELECT role FROM tenancy_party WHERE tenancy_id = $1 ORDER BY role`,
          [confirmed.tenancyId],
        );
        assert.deepEqual(
          parties.rows.map((row) => row.role),
          ['CO_TENANT', 'PRIMARY_TENANT'],
        );

        const guarantors = await db.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM tenancy_party
            WHERE tenancy_id = $1 AND role = 'GUARANTOR'`,
          [confirmed.tenancyId],
        );
        assert.equal(guarantors.rows[0]?.n, '0');

        const stamped = await listExtractedFields(db, documentId);
        assert.equal(
          stamped.find((row) => row.fieldKey === 'start_date')?.promotedTo,
          'tenancy.start_date',
        );

        const again = await confirmLeaseTenancy(deps, {
          documentId,
          termsProfileName: `a2-${unitId.slice(24)}`,
          confirmedBy: 'אסף',
          roles,
        });
        assert.equal(again.alreadyEstablished, true);
        assert.equal(again.partiesWritten, 0);
        const partyCount = await db.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM tenancy_party WHERE tenancy_id = $1`,
          [confirmed.tenancyId],
        );
        assert.equal(partyCount.rows[0]?.n, '2');
      });
    } finally {
      await pool.end();
    }
  });

  it('refuses a wrong apartment and writes no party', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        await applyDocumentTypeCatalogue(db, seedDocumentTypes);
        const unitId = await insertUnit(db, '12', ADDRESS);
        await upsertTermsProfile(db, `a2-miss-${unitId.slice(24)}`);
        const documentId = await fileLease(
          db,
          unitId,
          [
            ...matchingFindings.filter(
              (row) => row.field_key !== 'apartment_number',
            ),
            {
              field_key: 'apartment_number',
              value: '4',
              word_ids: [2],
            },
          ],
          'a2-wrong',
        );
        const proposed = await proposeLeaseTenancy(leaseDeps(db), {
          documentId,
          readBy: READ_BY,
        });
        assert.equal(proposed.matchesUnit, false);
        const roles = Object.fromEntries(
          proposed.people.map((person) => [
            person.extractedFieldId,
            person.proposedRole,
          ]),
        );
        await assert.rejects(
          () =>
            confirmLeaseTenancy(
              {
                db,
                audit: createAuditLog(db, fixedClock(AT)),
                clock: fixedClock(AT),
              },
              {
                documentId,
                termsProfileName: `a2-miss-${unitId.slice(24)}`,
                confirmedBy: 'אסף',
                roles,
              },
            ),
          (error: KernelError) =>
            error.code === 'invalid' && error.message.includes('match'),
        );
        const parties = await db.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM tenancy_party tp
             JOIN tenancy t ON t.tenancy_id = tp.tenancy_id
            WHERE t.unit_id = $1`,
          [unitId],
        );
        assert.equal(parties.rows[0]?.n, '0');
        const tenancies = await db.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM tenancy WHERE unit_id = $1`,
          [unitId],
        );
        assert.equal(tenancies.rows[0]?.n, '0');
      });
    } finally {
      await pool.end();
    }
  });
});

describe('evidence · confirm screen lists terms profiles', () => {
  const unit = {
    unit_id: '11111111-1111-4111-8111-111111111111',
    unit_number: '4',
    building_id: '22222222-2222-4222-8222-222222222222',
    building_name: 'בדיקה',
    address_line: 'האלון 12',
    city: 'אשדוד',
  };
  const base = {
    documentId: '33333333-3333-4333-8333-333333333333',
    typeKey: 'lease' as const,
    unit,
    startDate: '2026-09-15',
    endDate: '2027-09-14',
    apartmentNumber: '4',
    address: 'האלון 12',
    people: [
      {
        extractedFieldId: '44444444-4444-4444-8444-444444444444',
        fieldKey: 'tenant_name' as const,
        value: 'יעל',
        proposedRole: 'PRIMARY_TENANT' as const,
        hasIdentifier: false,
      },
    ],
    matchesUnit: true,
    alreadyEstablished: false,
    boundToTenancy: false,
    crossCheck: {
      addressRead: true,
      apartmentRead: true,
      addressFits: true,
      apartmentFits: true,
    },
    candidates: [],
    proposedTenancyId: null,
    identifiersRead: 0,
    identifiersPaired: 0,
  };

  it('is a select of existing names, not a typed field', () => {
    const html = renderTenancyPage({
      nav: NAV,
      csrf: '',
      ...base,
      termsProfileNames: ['נספח תחזוקה — תקן'],
    });
    assert.match(html, /<select name="terms_profile"/);
    assert.match(html, /נספח תחזוקה — תקן/);
    assert.match(html, /אישור וכתיבה/);
  });

  it('withholds the write when none exist rather than inventing one', () => {
    const html = renderTenancyPage({
      nav: NAV,
      csrf: '',
      ...base,
      termsProfileNames: [],
    });
    assert.match(html, /אין נספח תחזוקה במערכת/);
    assert.doesNotMatch(html, /אישור וכתיבה/);
    assert.doesNotMatch(html, /<select name="terms_profile"/);
  });
});

// -------------------------------------------------------------------------------------------
// Slice 6.5 — which letting, and one person rather than two.
//
// Clocked at **13 Sep**, not at this file's own 8 Sep: `tenant_id_number` and `guarantor_id_number`
// are declared from the 13th (6.4's seed rows) and R18's version window is live, so an earlier
// clock reads a catalogue that declares neither and extracts nothing. 6.4 paid a run to learn that;
// this comment is the receipt.
// -------------------------------------------------------------------------------------------

const AT_ID = new Date('2026-09-13T09:00:00.000Z');

/**
 * **A ת.ז. no other run is holding.**
 *
 * `party_natural_key` is a UNIQUE index, so a fixture that hard-codes an identifier fails the moment
 * anything else in the database already holds it — which is what happened here, against rows a walk
 * on `:3000` had left behind. Nine digits off a fresh UUIDv7's random half are unique per run and
 * still fold the way a real one does.
 */
function idNumber(): string {
  return newId().replace(/\D/g, '').slice(-9).padStart(9, '1');
}

const idDeps = (db: PoolClient) => ({
  db,
  audit: createAuditLog(db, fixedClock(AT_ID)),
  clock: fixedClock(AT_ID),
});

const leaseFindings = (over: {
  unitNumber: string;
  address: string;
  startDate?: string;
  endDate?: string;
  tenants?: string[];
  tenantIds?: string[];
  guarantors?: string[];
  guarantorIds?: string[];
}): Array<{ field_key: string; value: string; word_ids: number[] }> => {
  const findings = [
    {
      field_key: 'start_date',
      value: over.startDate ?? '2026-03-01',
      word_ids: [0],
    },
    {
      field_key: 'end_date',
      value: over.endDate ?? '2027-02-28',
      word_ids: [1],
    },
    { field_key: 'apartment_number', value: over.unitNumber, word_ids: [2] },
    { field_key: 'address', value: `${over.address} שוהם`, word_ids: [3] },
  ];
  let word = 4;
  for (const [key, values] of [
    ['tenant_name', over.tenants ?? ['יעל כהן']],
    ['tenant_id_number', over.tenantIds ?? []],
    ['guarantor_name', over.guarantors ?? []],
    ['guarantor_id_number', over.guarantorIds ?? []],
  ] as const) {
    for (const value of values) {
      findings.push({ field_key: key, value, word_ids: [word] });
      word += 1;
    }
  }
  return findings;
};

async function partyCount(db: PoolClient): Promise<number> {
  const rows = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM party`,
  );
  return Number(rows.rows[0]?.n ?? '0');
}

async function confirm(
  db: PoolClient,
  documentId: string,
  profile: string,
  extra: { attachTenancyId?: string | null } = {},
) {
  const proposed = await proposeLeaseTenancy(idDeps(db), {
    documentId,
    readBy: READ_BY,
  });
  return {
    proposed,
    result: await confirmLeaseTenancy(idDeps(db), {
      documentId,
      termsProfileName: profile,
      confirmedBy: READ_BY,
      roles: Object.fromEntries(
        proposed.people.map((person) => [
          person.extractedFieldId,
          person.proposedRole,
        ]),
      ),
      ...extra,
    }),
  };
}

describe('evidence · flow A2 resolves which letting a lease belongs to', () => {
  // **The first acceptance case.** The same ת.ז. on two leases in two flats. Before 6.5 this was
  // two parties, because every party a lease wrote went through `createParty`.
  it('one identifier in two flats is one party and two tenancies', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        await applyDocumentTypeCatalogue(db, seedDocumentTypes);
        const first = await insertUnit(db, '12', ADDRESS);
        const second = await insertUnit(db, '19', 'כלנית 4');
        const profile = `a2id-${first.slice(24)}`;
        await upsertTermsProfile(db, profile);

        const yael = idNumber();
        const before = await partyCount(db);
        const oneDoc = await fileLease(
          db,
          first,
          leaseFindings({
            unitNumber: '12',
            address: ADDRESS,
            tenantIds: [yael],
          }),
          '65-flat-one',
          AT_ID,
        );
        const one = await confirm(db, oneDoc, profile);
        assert.equal(one.proposed.identifiersRead, 1);
        assert.equal(one.proposed.identifiersPaired, 1);
        assert.equal(one.proposed.people[0]?.hasIdentifier, true);
        assert.equal(one.result.partiesWritten, 1);

        // The second flat, the same person, and the ת.ז. written with the separators a person
        // types — so the match is the database's fold and not string equality.
        const twoDoc = await fileLease(
          db,
          second,
          leaseFindings({
            unitNumber: '19',
            address: 'כלנית 4',
            startDate: '2026-06-01',
            endDate: '2027-05-31',
            // The separators a person types, so the match is the database's fold and not equality.
            tenantIds: [
              `${yael.slice(0, 3)}-${yael.slice(3, 6)}-${yael.slice(6)}`,
            ],
          }),
          '65-flat-two',
          AT_ID,
        );
        const two = await confirm(db, twoDoc, profile);
        assert.equal(two.result.partiesWritten, 1);
        assert.notEqual(two.result.tenancyId, one.result.tenancyId);

        // **One party, two tenancies.** The count is the assertion, not the ids.
        assert.equal(await partyCount(db), before + 1);
        const households = await db.query<{ n: string }>(
          `SELECT count(DISTINCT tp.party_id)::text AS n
             FROM tenancy_party tp
            WHERE tp.tenancy_id = ANY($1::uuid[])`,
          [[one.result.tenancyId, two.result.tenancyId]],
        );
        assert.equal(households.rows[0]?.n, '1');
        // Scoped to this household: the developer's own database holds 2,871 parties from the
        // generated register, and a count over the whole table measures the fixture.
        const identified = await db.query<{ n: string }>(
          `SELECT count(DISTINCT p.party_id)::text AS n
             FROM party p
             JOIN tenancy_party tp ON tp.party_id = p.party_id
            WHERE tp.tenancy_id = ANY($1::uuid[]) AND p.national_id IS NOT NULL`,
          [[one.result.tenancyId, two.result.tenancyId]],
        );
        assert.equal(identified.rows[0]?.n, '1');
      });
    } finally {
      await pool.end();
    }
  });

  // **The second acceptance case.** A second lease on the unit and start date a letting already
  // holds. Before 6.5 this died on `conflict` and there was nothing an operator could do.
  it('offers the existing letting on an equal start date, and attaching writes no dates', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        await applyDocumentTypeCatalogue(db, seedDocumentTypes);
        const unitId = await insertUnit(db, '12', ADDRESS);
        const profile = `a2att-${unitId.slice(24)}`;
        await upsertTermsProfile(db, profile);
        const yael = idNumber();
        const dan = idNumber();
        const firstDoc = await fileLease(
          db,
          unitId,
          leaseFindings({
            unitNumber: '12',
            address: ADDRESS,
            tenantIds: [yael],
          }),
          '65-attach-one',
          AT_ID,
        );
        const first = await confirm(db, firstDoc, profile);

        // The same household, the same flat, the same start date — a copy of the paper, or the
        // countersigned one arriving second.
        const secondDoc = await fileLease(
          db,
          unitId,
          leaseFindings({
            unitNumber: '12',
            address: ADDRESS,
            // The letting's end date must not move, so this paper says something different.
            endDate: '2027-06-30',
            tenants: ['יעל כהן', 'דן לוי'],
            tenantIds: [yael, dan],
          }),
          '65-attach-two',
          AT_ID,
        );
        const proposed = await proposeLeaseTenancy(idDeps(db), {
          documentId: secondDoc,
          readBy: READ_BY,
        });
        // The existing letting is offered, pre-selected, and ranked on the identifier it shares.
        assert.equal(proposed.proposedTenancyId, first.result.tenancyId);
        assert.equal(proposed.candidates.length, 1);
        assert.equal(proposed.candidates[0]?.identifierMatches, 1);
        assert.ok((proposed.candidates[0]?.dayOverlap ?? 0) > 300);

        const lettingsBefore = await db.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM tenancy WHERE unit_id = $1`,
          [unitId],
        );
        const attached = await confirmLeaseTenancy(idDeps(db), {
          documentId: secondDoc,
          termsProfileName: '',
          confirmedBy: READ_BY,
          roles: Object.fromEntries(
            proposed.people.map((person) => [
              person.extractedFieldId,
              person.proposedRole,
            ]),
          ),
          attachTenancyId: first.result.tenancyId,
        });
        assert.equal(attached.attached, true);
        assert.equal(attached.tenancyId, first.result.tenancyId);

        // **No second letting, and no annex was asked for.**
        const lettingsAfter = await db.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM tenancy WHERE unit_id = $1`,
          [unitId],
        );
        assert.equal(lettingsAfter.rows[0]?.n, lettingsBefore.rows[0]?.n);

        // **And no dates.** The letting still ends when its own paper said, not when this one does.
        const term = await db.query<{ end_date: string; status: string }>(
          `SELECT end_date::text, status FROM tenancy WHERE tenancy_id = $1`,
          [first.result.tenancyId],
        );
        assert.equal(term.rows[0]?.end_date, '2027-02-28');
        assert.equal(term.rows[0]?.status, 'DRAFT');

        // The second tenant came in under the letting that was already there.
        const people = await db.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM tenancy_party WHERE tenancy_id = $1`,
          [first.result.tenancyId],
        );
        assert.equal(people.rows[0]?.n, '2');

        // A second attach of the same document is a no-op, the way a second create is.
        const again = await confirmLeaseTenancy(idDeps(db), {
          documentId: secondDoc,
          termsProfileName: '',
          confirmedBy: READ_BY,
          roles: {},
          attachTenancyId: first.result.tenancyId,
        });
        assert.equal(again.alreadyEstablished, true);
        assert.equal(again.partiesWritten, 0);
      });
    } finally {
      await pool.end();
    }
  });

  // **The third acceptance case**, and it is the one that must not regress: A2 step 3 says zero
  // identifiers is a correct result, and an invented lease, an older form and a bad scan all
  // produce it.
  it('a lease naming no identifier still writes a party and a draft', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        await applyDocumentTypeCatalogue(db, seedDocumentTypes);
        const unitId = await insertUnit(db, '12', ADDRESS);
        const profile = `a2none-${unitId.slice(24)}`;
        await upsertTermsProfile(db, profile);
        const documentId = await fileLease(
          db,
          unitId,
          leaseFindings({ unitNumber: '12', address: ADDRESS }),
          '65-no-id',
          AT_ID,
        );
        const { proposed, result } = await confirm(db, documentId, profile);
        assert.equal(proposed.identifiersRead, 0);
        assert.equal(proposed.people[0]?.hasIdentifier, false);
        assert.equal(result.partiesWritten, 1);
        assert.equal(result.attached, false);

        const party = await db.query<{ national_id: string | null }>(
          `SELECT p.national_id FROM party p
             JOIN tenancy_party tp ON tp.party_id = p.party_id
            WHERE tp.tenancy_id = $1`,
          [result.tenancyId],
        );
        assert.equal(party.rows.length, 1);
        assert.equal(party.rows[0]?.national_id, null);

        // Nothing was compared, so nothing was logged. Withholding is not a read, and neither is
        // having nothing to read.
        const matched = await db.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM audit_log
            WHERE action = 'evidence.match_identifier' AND subject_id = $1`,
          [documentId],
        );
        assert.equal(matched.rows[0]?.n, '0');
      });
    } finally {
      await pool.end();
    }
  });

  it('pairs nobody when the counts disagree, and refuses two people who are one', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        await applyDocumentTypeCatalogue(db, seedDocumentTypes);
        const unitId = await insertUnit(db, '12', ADDRESS);
        const profile = `a2pair-${unitId.slice(24)}`;
        await upsertTermsProfile(db, profile);

        // Two names and one identifier. Which of them it belongs to is not knowable, and the
        // operator is not shown the value, so nobody gets it.
        const yael = idNumber();
        const dan = idNumber();
        const lopsided = await fileLease(
          db,
          unitId,
          leaseFindings({
            unitNumber: '12',
            address: ADDRESS,
            tenants: ['יעל כהן', 'דן לוי'],
            tenantIds: [yael],
          }),
          '65-lopsided',
          AT_ID,
        );
        const proposed = await proposeLeaseTenancy(idDeps(db), {
          documentId: lopsided,
          readBy: READ_BY,
        });
        assert.equal(proposed.identifiersRead, 1);
        assert.equal(proposed.identifiersPaired, 0);
        assert.deepEqual(
          proposed.people.map((person) => person.hasIdentifier),
          [false, false],
        );
        // No probe, so no comparison and no audit line — the read never happened.
        const matched = await db.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM audit_log
            WHERE action = 'evidence.match_identifier' AND subject_id = $1`,
          [lopsided],
        );
        assert.equal(matched.rows[0]?.n, '0');

        const written = await confirm(db, lopsided, profile);
        assert.equal(written.result.partiesWritten, 2);
        const identified = await db.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM party p
             JOIN tenancy_party tp ON tp.party_id = p.party_id
            WHERE tp.tenancy_id = $1 AND p.national_id IS NOT NULL`,
          [written.result.tenancyId],
        );
        assert.equal(identified.rows[0]?.n, '0');

        // A guarantor with no identifier does not discard the tenants' — the families are counted
        // on their own, which is A2 step 5's amendment and the ordinary shape of a real lease.
        const other = await insertUnit(db, '20', 'כלנית 4');
        const mixed = await fileLease(
          db,
          other,
          leaseFindings({
            unitNumber: '20',
            address: 'כלנית 4',
            tenants: ['יעל כהן', 'דן לוי'],
            tenantIds: [yael, dan],
            guarantors: ['רותם ערב'],
          }),
          '65-mixed',
          AT_ID,
        );
        const mixedProposal = await proposeLeaseTenancy(idDeps(db), {
          documentId: mixed,
          readBy: READ_BY,
        });
        assert.deepEqual(
          mixedProposal.people.map((person) => person.hasIdentifier),
          [true, true, false],
        );

        // Two people, one identifier printed twice — a refusal, not one party silently holding
        // two roles through `(tenancy_id, party_id)`.
        const third = await insertUnit(db, '21', 'כלנית 4');
        const doubled = await fileLease(
          db,
          third,
          leaseFindings({
            unitNumber: '21',
            address: 'כלנית 4',
            tenants: ['יעל כהן', 'דן לוי'],
            // One person printed twice, the second time with the separators. Two strings, one ת.ז.
            tenantIds: [
              yael,
              `${yael.slice(0, 3)}-${yael.slice(3, 6)}-${yael.slice(6)}`,
            ],
          }),
          '65-doubled',
          AT_ID,
        );
        const before = await partyCount(db);
        await assert.rejects(
          () => confirm(db, doubled, profile),
          (error: KernelError) => {
            assert.equal(error.code, 'invalid');
            assert.match(error.message, /one person/);
            return true;
          },
        );
        assert.equal(await partyCount(db), before);
      });
    } finally {
      await pool.end();
    }
  });
});

describe('evidence · ranking a flat’s lettings is arithmetic, not SQL', () => {
  it('counts both endpoints, and nothing at all without dates', () => {
    const letting = { start_date: '2026-01-01', end_date: '2026-12-31' };
    // One day shared is one day, not zero: the last day of a lease is a day of it, which is the
    // same convention the isolation window keeps.
    assert.equal(
      dayOverlap({ startDate: '2026-12-31', endDate: '2027-06-30' }, letting),
      1,
    );
    assert.equal(
      dayOverlap({ startDate: '2027-01-01', endDate: '2027-06-30' }, letting),
      0,
    );
    assert.equal(
      dayOverlap({ startDate: '2026-01-01', endDate: '2026-12-31' }, letting),
      365,
    );
    // Extraction returning no date is a correct result, and it must not rank a letting to the top.
    assert.equal(dayOverlap({ startDate: null, endDate: null }, letting), 0);
    assert.equal(
      dayOverlap({ startDate: '2026-01-01', endDate: null }, letting),
      0,
    );
  });

  it('puts identifier overlap first, then days, then the newest letting', () => {
    const at = (over: Partial<TenancyCandidate>): TenancyCandidate => ({
      tenancyId: '00000000-0000-4000-8000-000000000000',
      startDate: '2020-01-01',
      endDate: '2021-01-01',
      status: 'ENDED',
      identifierMatches: 0,
      dayOverlap: 0,
      ...over,
    });
    const ranked = rankCandidates([
      at({ tenancyId: 'c', dayOverlap: 400, startDate: '2025-01-01' }),
      at({ tenancyId: 'a', identifierMatches: 1, dayOverlap: 1 }),
      at({ tenancyId: 'd', dayOverlap: 400, startDate: '2019-01-01' }),
      at({ tenancyId: 'b', identifierMatches: 2 }),
    ]);
    assert.deepEqual(
      ranked.map((candidate) => candidate.tenancyId),
      ['b', 'a', 'c', 'd'],
    );
  });
});

/**
 * **Slice 6.10.** The demo's document carries `SUBJECT` links to three flats, filed before the
 * refusal above existed, and this is the question they leave behind: *which flat is the confirm
 * screen about?*
 *
 * Until here the answer was `unitIdOf`'s unordered `LIMIT 1` — either row, and the suite could not
 * tell which, because a small table hands back its physical order and the physical order happened to
 * be the order the links went in. So each case below states the same expectation twice, once with
 * the anchor's link written first and once with it written last. One of the two was red.
 */
describe('evidence · which flat a document is about, when it is linked to two', () => {
  it('is the flat its bytes are filed under, whichever link comes back first', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }

    const linked = async (
      db: PoolClient,
      documentId: string,
      unitId: string,
    ): Promise<void> => {
      await db.query(
        `INSERT INTO document_link (document_id, entity_type, entity_id, link_role)
         VALUES ($1, 'UNIT', $2, 'SUBJECT')`,
        [documentId, unitId],
      );
    };

    await t.test('the anchor’s link written first', async () => {
      await inRolledBackTransaction(pool, async (db) => {
        await applyDocumentTypeCatalogue(db, seedDocumentTypes);
        const anchor = await insertUnit(db, '12', ADDRESS);
        const other = await insertUnit(db, '206', 'דם המכבים 38');
        const documentId = await fileLease(
          db,
          anchor,
          matchingFindings,
          '6.10 anchor first',
        );
        await linked(db, documentId, other);

        const proposed = await proposeLeaseTenancy(leaseDeps(db), {
          documentId,
          readBy: READ_BY,
        });
        assert.equal(proposed.unit.unit_id, anchor);
      });
    });

    await t.test('the anchor’s link written last', async () => {
      await inRolledBackTransaction(pool, async (db) => {
        await applyDocumentTypeCatalogue(db, seedDocumentTypes);
        const anchor = await insertUnit(db, '12', ADDRESS);
        const other = await insertUnit(db, '206', 'דם המכבים 38');
        const documentId = await fileLease(
          db,
          anchor,
          matchingFindings,
          '6.10 anchor last',
        );
        // The other flat's link first, then the anchor's again — which is the row order a document
        // re-filed and re-linked over a week leaves behind, and the order that made the demo's
        // confirm screen speak about a flat the director had never opened.
        await db.query(
          `DELETE FROM document_link
            WHERE document_id = $1 AND entity_type = 'UNIT' AND entity_id = $2`,
          [documentId, anchor],
        );
        await linked(db, documentId, other);
        await linked(db, documentId, anchor);

        const proposed = await proposeLeaseTenancy(leaseDeps(db), {
          documentId,
          readBy: READ_BY,
        });
        assert.equal(
          proposed.unit.unit_id,
          anchor,
          'the flat the bytes are filed under, not the first link the table returns',
        );
      });
    });
  });
});

// POLICY — a tenant sees their own calls, on any channel, and not another
// tenant's. A band, a clock, a brief and a draft never reach the page. #281.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Pool } from 'pg';
import { buildApp } from '../../src/app.ts';
import {
  exitCall,
  identifyCall,
  openCall,
  openIntakeCall,
  setCallCategory,
} from '../../src/calls/contract.ts';
import { createRecordingCodeSender } from '../../src/channel/contract.ts';
import { fixedClock } from '../../src/kernel/clock.ts';
import { newId } from '../../src/kernel/ids.ts';
import { addOperator } from '../../src/staff/contract.ts';
import { asTenant } from '../support/session.ts';
import { seedOccupancy } from './fixtures.ts';
import { policyPool, skipReason } from './support.ts';

const AT = new Date('2026-10-21T06:00:00.000Z');
const PLUMBING = 'a1830001-0000-4000-8000-000000000001';
const PHONES = ['+972520002811', '+972520002812'] as const;
const [MINE, THEIRS] = PHONES;
const SECRET_BRIEF = 'משפט תקציר סודי 281';
const SECRET_DRAFT = 'משפט טיוטה סודי 281';
const SECRET_SUMMARY = 'סיכום מסווג סודי 281';
const SECRET_ANSWER = 'הערה פנימית של מענה 281';
const OFFICE = 'נבדוק את הציר מחר';
const TENANT_LINE = 'הדלת חורקת מהבוקר';
const CANCEL = 'הדיירת ביקשה לבטל 281';
const NEIGHBOUR = 'קריאה של השכן 281';
const FILTERED = 'קריאה שסוננה 281';

function minute(): number {
  return 60 * 1000;
}

async function place(
  pool: Pool,
  phone: string,
  unit: string,
  line: string,
  city: string,
): Promise<{ partyId: string; tenancyId: string }> {
  const seeded = await seedOccupancy(pool, unit, {
    phone,
    contactFrom: '2026-01-01',
    contactTo: null,
    tenancyFrom: '2026-01-01',
    tenancyTo: '2027-01-01',
    address: { line, city },
  });
  await pool.query(
    `UPDATE building SET portal_enabled = true
      WHERE building_id = (SELECT building_id FROM space WHERE space_id = $1)`,
    [seeded.unitId],
  );
  return { partyId: seeded.partyId, tenancyId: seeded.tenancyId };
}

async function cleanup(pool: Pool): Promise<void> {
  await pool.query(
    `DELETE FROM call_turn
      WHERE call_thread_id IN (
        SELECT call_thread_id FROM call_thread
         WHERE service_call_id IN (
           SELECT service_call_id FROM service_call
            WHERE requester_party_id IN (
              SELECT party_id FROM party_contact WHERE value = ANY($1::text[])
            )
         )
      )`,
    [PHONES],
  );
  await pool.query(
    `DELETE FROM call_thread
      WHERE service_call_id IN (
        SELECT service_call_id FROM service_call
         WHERE requester_party_id IN (
           SELECT party_id FROM party_contact WHERE value = ANY($1::text[])
         )
      )`,
    [PHONES],
  );
  await pool.query(
    `DELETE FROM message
      WHERE service_call_id IN (
        SELECT service_call_id FROM service_call
         WHERE requester_party_id IN (
           SELECT party_id FROM party_contact WHERE value = ANY($1::text[])
         )
      )`,
    [PHONES],
  );
  await pool.query(
    `DELETE FROM service_call_transition
      WHERE service_call_id IN (
        SELECT service_call_id FROM service_call
         WHERE requester_party_id IN (
           SELECT party_id FROM party_contact WHERE value = ANY($1::text[])
         )
      )`,
    [PHONES],
  );
  await pool.query(
    `DELETE FROM service_call
      WHERE requester_party_id IN (
        SELECT party_id FROM party_contact WHERE value = ANY($1::text[])
      )`,
    [PHONES],
  );
  await pool.query(
    `DELETE FROM audit_log
      WHERE actor_id IN (
        SELECT portal_identity_id::text FROM portal_identity WHERE phone = ANY($1::text[])
      )`,
    [PHONES],
  );
  await pool.query(
    `DELETE FROM portal_acknowledgement
      WHERE portal_identity_id IN (
        SELECT portal_identity_id FROM portal_identity WHERE phone = ANY($1::text[])
      )`,
    [PHONES],
  );
  await pool.query(
    `DELETE FROM portal_session
      WHERE portal_identity_id IN (
        SELECT portal_identity_id FROM portal_identity WHERE phone = ANY($1::text[])
      )`,
    [PHONES],
  );
  await pool.query(
    `DELETE FROM portal_sign_in_code WHERE phone = ANY($1::text[])`,
    [PHONES],
  );
  await pool.query(
    `DELETE FROM portal_identity WHERE phone = ANY($1::text[])`,
    [PHONES],
  );
  await pool.query(
    `DELETE FROM tenancy_party
      WHERE party_id IN (SELECT party_id FROM party_contact WHERE value = ANY($1::text[]))`,
    [PHONES],
  );
  await pool.query(
    `DELETE FROM tenancy
      WHERE unit_id IN (
        SELECT u.unit_id FROM unit u
        JOIN space s ON s.space_id = u.unit_id
        JOIN building b ON b.building_id = s.building_id
        WHERE b.city LIKE 'פורטל 281%'
      )`,
  );
  await pool.query(
    `WITH gone AS (
       DELETE FROM party_contact WHERE value = ANY($1::text[])
       RETURNING party_id
     )
     DELETE FROM party WHERE party_id IN (SELECT party_id FROM gone)`,
    [PHONES],
  );
  await pool.query(
    `DELETE FROM unit
      WHERE unit_id IN (
        SELECT s.space_id FROM space s
        JOIN building b ON b.building_id = s.building_id
        WHERE b.city LIKE 'פורטל 281%'
      )`,
  );
  await pool.query(
    `DELETE FROM space
      WHERE building_id IN (SELECT building_id FROM building WHERE city LIKE 'פורטל 281%')`,
  );
  await pool.query(`DELETE FROM building WHERE city LIKE 'פורטל 281%'`);
  await pool.query(
    `DELETE FROM staff_account WHERE email = 'open@portal-281.test'`,
  );
}

describe('portal calls', () => {
  it('lists the tenant’s own calls and hides the office’s words', async (t) => {
    const pool = await policyPool();
    if (pool === null) return t.skip(skipReason);
    await cleanup(pool);
    const clock = fixedClock(AT);
    const sender = createRecordingCodeSender();
    const app = buildApp({
      pool,
      clock,
      version: '9.9.9-test',
      codeSender: sender,
    });
    t.after(async () => {
      await cleanup(pool);
      await app.close();
      await pool.end();
    });

    const staff = await addOperator(pool, clock, {
      email: 'open@portal-281.test',
      role: 'OPERATOR',
    });
    const actor = staff.account.staffAccountId;
    const mine = await place(pool, MINE, '12', 'רחוב 281', 'פורטל 281א');
    const theirs = await place(pool, THEIRS, '4', 'רחוב 281 שכן', 'פורטל 281ב');

    const phone = await openCall(pool, clock, {
      sourceChannel: 'PHONE',
      description: 'נזילה בטלפון',
      sender: { kind: 'unknown' },
      openedBy: actor,
      actorRole: 'OPERATOR',
    });
    await identifyCall(pool, clock, {
      callId: phone.id,
      partyId: mine.partyId,
      actorId: actor,
      actorRole: 'OPERATOR',
    });
    await pool.query(
      `UPDATE service_call SET opened_at = $2 WHERE service_call_id = $1`,
      [phone.id, new Date('2026-09-01T07:00:00.000Z')],
    );

    clock.advance(minute());
    const whatsapp = await openIntakeCall(pool, clock, {
      sourceChannel: 'WHATSAPP',
      description: 'דלת בוואטסאפ',
      senderAddress: MINE,
      emergency: false,
      toReview: false,
      sorterLabel: 'call',
      summary: SECRET_SUMMARY,
      proposedCategoryId: null,
      predecessorId: null,
      openedBy: null,
      sorterModel: null,
      sorterPrompt: null,
    });
    await identifyCall(pool, clock, {
      callId: whatsapp.id,
      partyId: mine.partyId,
      actorId: actor,
      actorRole: 'OPERATOR',
    });
    await setCallCategory(pool, clock, {
      callId: whatsapp.id,
      categoryId: PLUMBING,
      actorId: actor,
      actorRole: 'OPERATOR',
    });
    const conversation = newId();
    await pool.query(
      `INSERT INTO conversation (conversation_id, source_channel, external_thread_id)
       VALUES ($1, 'WHATSAPP', $2)`,
      [conversation, `281-${whatsapp.id}`],
    );
    await pool.query(
      `INSERT INTO message (
         message_id, conversation_id, source_channel, external_message_id,
         sender_address, received_at, body_original, is_echo, attachments,
         service_call_id
       ) VALUES ($1, $2, 'WHATSAPP', $3, $4, $5, $6, false, '[]'::jsonb, $7)`,
      [
        newId(),
        conversation,
        `281-msg-${whatsapp.id}`,
        MINE,
        clock.now(),
        TENANT_LINE,
        whatsapp.id,
      ],
    );
    await pool.query(
      `INSERT INTO service_call_transition
         (transition_id, service_call_id, kind, actor_id, at, note, reply_mark)
       VALUES ($1, $2, 'REPLIED', $3, $4, $5, 'edited')`,
      [newId(), whatsapp.id, actor, clock.now(), OFFICE],
    );
    const threadId = newId();
    await pool.query(
      `INSERT INTO call_thread (call_thread_id, service_call_id, status, created_at)
       VALUES ($1, $2, 'ready', $3)`,
      [threadId, whatsapp.id, clock.now()],
    );
    await pool.query(
      `INSERT INTO call_turn (
         call_turn_id, call_thread_id, asked_at, ordinal, asker, question,
         answer, refused, citations, hit_ids
       ) VALUES ($1, $2, $3, 0, 'copilot', 'מה קרה', $4, false, '[]'::jsonb, '{}')`,
      [newId(), threadId, clock.now(), SECRET_BRIEF],
    );
    await pool.query(
      `INSERT INTO call_turn (
         call_turn_id, call_thread_id, asked_at, ordinal, asker, question,
         answer, refused, citations, hit_ids, kind, rendering
       ) VALUES ($1, $2, $3, 1, 'copilot', 'טיוטה', $4, false, '[]'::jsonb, '{}',
                 'draft', $4)`,
      [newId(), threadId, clock.now(), SECRET_DRAFT],
    );

    clock.advance(minute());
    const waiting = await openIntakeCall(pool, clock, {
      sourceChannel: 'PORTAL',
      description: 'ממתין בפורטל',
      senderAddress: MINE,
      emergency: false,
      toReview: false,
      sorterLabel: null,
      summary: null,
      proposedCategoryId: null,
      predecessorId: null,
      openedBy: null,
      sorterModel: null,
      sorterPrompt: null,
    });
    await identifyCall(pool, clock, {
      callId: waiting.id,
      partyId: mine.partyId,
      actorId: actor,
      actorRole: 'OPERATOR',
    });
    await setCallCategory(pool, clock, {
      callId: waiting.id,
      categoryId: PLUMBING,
      actorId: actor,
      actorRole: 'OPERATOR',
    });
    await pool.query(
      `UPDATE service_call SET state = 'WINDOWS_COLLECTED' WHERE service_call_id = $1`,
      [waiting.id],
    );

    clock.advance(minute());
    const answered = await openIntakeCall(pool, clock, {
      sourceChannel: 'EMAIL',
      description: 'העתק חוזה',
      senderAddress: MINE,
      emergency: false,
      toReview: false,
      sorterLabel: null,
      summary: null,
      proposedCategoryId: null,
      predecessorId: null,
      openedBy: null,
      sorterModel: null,
      sorterPrompt: null,
    });
    await identifyCall(pool, clock, {
      callId: answered.id,
      partyId: mine.partyId,
      actorId: actor,
      actorRole: 'OPERATOR',
    });
    await exitCall(pool, clock, {
      callId: answered.id,
      kind: 'ANSWERED',
      note: SECRET_ANSWER,
      actorId: actor,
      actorRole: 'OPERATOR',
    });

    clock.advance(minute());
    const cancelled = await openCall(pool, clock, {
      sourceChannel: 'WALK_IN',
      description: 'ביקור שבוטל',
      sender: { kind: 'unknown' },
      openedBy: actor,
      actorRole: 'OPERATOR',
    });
    await identifyCall(pool, clock, {
      callId: cancelled.id,
      partyId: mine.partyId,
      actorId: actor,
      actorRole: 'OPERATOR',
    });
    await exitCall(pool, clock, {
      callId: cancelled.id,
      kind: 'CANCELLED',
      note: CANCEL,
      actorId: actor,
      actorRole: 'OPERATOR',
    });

    clock.advance(minute());
    const visit = await openCall(pool, clock, {
      sourceChannel: 'PHONE',
      description: 'דוד עם ביקור',
      sender: { kind: 'unknown' },
      openedBy: actor,
      actorRole: 'OPERATOR',
    });
    await identifyCall(pool, clock, {
      callId: visit.id,
      partyId: mine.partyId,
      actorId: actor,
      actorRole: 'OPERATOR',
    });
    await setCallCategory(pool, clock, {
      callId: visit.id,
      categoryId: PLUMBING,
      actorId: actor,
      actorRole: 'OPERATOR',
    });
    await pool.query(
      `UPDATE service_call
          SET state = 'SCHEDULED', visit_starts_at = $2, visit_ends_at = $3
        WHERE service_call_id = $1`,
      [
        visit.id,
        new Date('2026-10-22T07:00:00.000Z'),
        new Date('2026-10-22T09:00:00.000Z'),
      ],
    );

    clock.advance(minute());
    const returned = await openIntakeCall(pool, clock, {
      sourceChannel: 'WHATSAPP',
      description: FILTERED,
      senderAddress: MINE,
      emergency: false,
      toReview: false,
      sorterLabel: null,
      summary: null,
      proposedCategoryId: null,
      predecessorId: null,
      openedBy: null,
      sorterModel: null,
      sorterPrompt: null,
    });
    await identifyCall(pool, clock, {
      callId: returned.id,
      partyId: mine.partyId,
      actorId: actor,
      actorRole: 'OPERATOR',
    });
    await pool.query(
      `UPDATE service_call
          SET returned_at = $2, returned_by = $3, office_label = 'returned'
        WHERE service_call_id = $1`,
      [returned.id, clock.now(), actor],
    );

    const neighbour = await openCall(pool, clock, {
      sourceChannel: 'PHONE',
      description: NEIGHBOUR,
      sender: { kind: 'unknown' },
      openedBy: actor,
      actorRole: 'OPERATOR',
    });
    await identifyCall(pool, clock, {
      callId: neighbour.id,
      partyId: theirs.partyId,
      actorId: actor,
      actorRole: 'OPERATOR',
    });

    const tenant = await asTenant(app, '052-000-2811', sender, {
      remoteAddress: '10.281.0.1',
    });
    const home = await tenant.inject({ method: 'GET', url: '/' });
    assert.equal(home.statusCode, 200);
    assert.match(home.body, /הביקור הבא/);
    assert.match(home.body, /דוד עם ביקור/);
    assert.match(home.body, /10:00/);
    assert.match(home.body, /12:00/);
    assert.match(home.body, /הכול/);
    assert.ok(
      home.body.indexOf('דוד עם ביקור') < home.body.indexOf('ממתין בפורטל'),
    );
    assert.doesNotMatch(home.body, /דלת בוואטסאפ/);
    assert.doesNotMatch(home.body, /נזילה בטלפון/);

    const open = await tenant.inject({ method: 'GET', url: '/calls' });
    assert.equal(open.statusCode, 200);
    assert.match(open.body, /פתוחות · <span dir="ltr">4<\/span>/);
    assert.match(open.body, /סגורות · <span dir="ltr">2<\/span>/);
    assert.match(open.body, /נזילה בטלפון/);
    assert.match(open.body, /בטלפון/);
    assert.match(open.body, /ללא סיווג/);
    assert.match(open.body, /01\.09/);
    assert.match(open.body, /data-status="received"/);
    assert.match(open.body, /דלת בוואטסאפ/);
    assert.match(open.body, /בוואטסאפ/);
    assert.match(open.body, /data-status="handling"/);
    assert.match(open.body, /ממתין בפורטל/);
    assert.match(open.body, /בפורטל/);
    assert.match(open.body, /data-status="waiting"/);
    assert.match(open.body, /is-waiting/);
    assert.match(open.body, /המשרד מחכה לתשובה מכם/);
    assert.match(open.body, /ביקור ב-/);
    assert.match(open.body, /22\.10/);
    assert.match(open.body, /class="tp-meta tp-ellipsis"/);
    const order = [
      'דוד עם ביקור',
      'ממתין בפורטל',
      'דלת בוואטסאפ',
      'נזילה בטלפון',
    ];
    let at = -1;
    for (const title of order) {
      const next = open.body.indexOf(title);
      assert.ok(next > at, title);
      at = next;
    }
    assert.doesNotMatch(open.body, /העתק חוזה/);
    assert.doesNotMatch(open.body, /ביקור שבוטל/);

    const closed = await tenant.inject({
      method: 'GET',
      url: '/calls?closed=1',
    });
    assert.match(closed.body, /נענתה/);
    assert.match(closed.body, /העתק חוזה/);
    assert.match(closed.body, /בוטלה/);
    assert.match(closed.body, /ביקור שבוטל/);
    assert.match(closed.body, new RegExp(CANCEL));
    assert.match(closed.body, /באימייל/);
    assert.match(closed.body, /בהגעה/);
    assert.doesNotMatch(closed.body, /דוד עם ביקור/);
    assert.doesNotMatch(closed.body, new RegExp(SECRET_ANSWER));

    const thread = await tenant.inject({
      method: 'GET',
      url: `/calls/${whatsapp.id}`,
    });
    assert.equal(thread.statusCode, 200);
    assert.match(thread.body, new RegExp(TENANT_LINE));
    assert.match(thread.body, /המשרד/);
    assert.match(thread.body, new RegExp(OFFICE));
    assert.match(thread.body, /התקבלה/);
    assert.match(thread.body, /בטיפול/);
    assert.match(thread.body, /נקבע ביקור/);
    assert.match(thread.body, /טופלה/);

    const scheduled = await tenant.inject({
      method: 'GET',
      url: `/calls/${visit.id}`,
    });
    assert.match(scheduled.body, /10:00/);
    assert.match(scheduled.body, /12:00/);
    assert.match(scheduled.body, /יום חמישי/);
    assert.match(scheduled.body, /ביקור טכנאי/);

    const missing = await tenant.inject({
      method: 'GET',
      url: `/calls/${neighbour.id}`,
    });
    assert.equal(missing.statusCode, 404);
    assert.match(missing.body, /לא נמצא/);
    assert.doesNotMatch(missing.body, new RegExp(NEIGHBOUR));

    const pages = [
      home.body,
      open.body,
      closed.body,
      thread.body,
      scheduled.body,
    ];
    for (const body of pages) {
      assert.doesNotMatch(
        body,
        /בזמן|קרוב ליעד|מעבר ליעד|תקציר|טיוטה|TRIAGED|data-brief/,
      );
      assert.doesNotMatch(body, new RegExp(SECRET_BRIEF));
      assert.doesNotMatch(body, new RegExp(SECRET_DRAFT));
      assert.doesNotMatch(body, new RegExp(SECRET_SUMMARY));
      assert.doesNotMatch(body, new RegExp(FILTERED));
      assert.doesNotMatch(body, new RegExp(NEIGHBOUR));
    }

    await pool.query(
      `UPDATE service_call
          SET visit_starts_at = NULL, visit_ends_at = NULL
        WHERE service_call_id = $1`,
      [visit.id],
    );
    const without = await tenant.inject({ method: 'GET', url: '/' });
    assert.equal(without.statusCode, 200);
    assert.doesNotMatch(without.body, /הביקור הבא/);
    assert.doesNotMatch(without.body, /10:00/);
  });
});

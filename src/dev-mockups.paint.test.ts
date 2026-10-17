// The two paints for #248. They are files under `mockups/`, deleted when the flows are wired,
// and this file goes with them: a test that still wanted them after that deletion would be red
// at the moment the guard is right (see the note on `renderMockup` in `guard.test.ts`).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderMockup } from './dev-mockups.ts';

function panel(html: string, state: string): string {
  const match = html.match(
    new RegExp(`<section data-state="${state}">([\\s\\S]*?)</section>`),
  );
  assert.ok(match, `missing state ${state}`);
  return match[1] ?? '';
}

describe('call copilot paint', () => {
  it('renders in the live shell, listed from the mockups index', () => {
    const index = renderMockup('index', 'csrf');
    assert.match(index, /<html lang="he" dir="rtl">/);
    assert.match(index, /href="\/dev\/mockups\/call-copilot"/);
    assert.match(index, /href="\/dev\/mockups\/policy-library"/);

    const page = renderMockup('call-copilot', 'csrf');
    assert.match(page, /class="ops"/);
    assert.match(page, /data-paint="call-copilot"/);
  });

  it('shows the brief, the thread, the draft, and send and copy', () => {
    const page = renderMockup('call-copilot', 'csrf');
    const ready = panel(page, 'ready');
    assert.match(ready, /רענון/);
    assert.match(ready, /חוזה §7\.2/);
    assert.match(ready, /נוהל שירות §3/);
    assert.match(ready, /דין/);
    assert.match(ready, /נוהל חברה/);
    assert.match(ready, /מיה הדגמה/);
    assert.match(ready, /The water heater/);
    assert.match(ready, /דוד המים/);
    assert.match(ready, /שליחה/);
    assert.match(ready, /העתקה/);
    assert.match(page, /for="st-ready"/);
  });

  it('shows the brief still being written', () => {
    const page = renderMockup('call-copilot', 'csrf');
    const writing = panel(page, 'writing');
    assert.match(writing, /נכתב/);
    assert.doesNotMatch(writing, /חוזה §7\.2/);
    assert.doesNotMatch(writing, /שליחה/);
    assert.match(page, /for="st-writing"/);
  });

  it('shows the frozen refusal with no citation', () => {
    const refusal = panel(renderMockup('call-copilot', 'csrf'), 'refusal');
    assert.match(refusal, /אין במסמכים האלה תשובה לשאלה הזו\./);
    assert.doesNotMatch(refusal, /חוזה §/);
    assert.doesNotMatch(refusal, /נוהל שירות §/);
    assert.match(renderMockup('call-copilot', 'csrf'), /for="st-refusal"/);
  });

  it('gives a guarantor-only requester no brief', () => {
    const guarantor = panel(renderMockup('call-copilot', 'csrf'), 'guarantor');
    assert.match(guarantor, /ערב בלבד/);
    assert.doesNotMatch(guarantor, /חוזה §/);
    assert.doesNotMatch(guarantor, /נוהל שירות/);
    assert.doesNotMatch(guarantor, /The water heater/);
    assert.doesNotMatch(guarantor, /שליחה/);
    assert.match(renderMockup('call-copilot', 'csrf'), /for="st-guarantor"/);
  });

  it('offers copy only when the WhatsApp window is closed', () => {
    const closed = panel(
      renderMockup('call-copilot', 'csrf'),
      'whatsapp-closed',
    );
    assert.match(closed, /24/);
    assert.match(closed, /העתקה/);
    assert.doesNotMatch(closed, /שליחה/);
    assert.match(
      renderMockup('call-copilot', 'csrf'),
      /for="st-whatsapp-closed"/,
    );
  });

  it('shows copy and not send without calls.reply', () => {
    const viewer = panel(renderMockup('call-copilot', 'csrf'), 'no-reply');
    assert.match(viewer, /העתקה/);
    assert.doesNotMatch(viewer, /שליחה/);
    assert.match(renderMockup('call-copilot', 'csrf'), /for="st-no-reply"/);
  });

  it('marks a sent reply as edited or as written', () => {
    const sent = panel(renderMockup('call-copilot', 'csrf'), 'sent');
    assert.match(sent, /data-mark="as-written"/);
    assert.match(sent, /data-mark="edited"/);
    assert.match(sent, /כפי שנכתב/);
    assert.match(sent, /נערך/);
    assert.match(renderMockup('call-copilot', 'csrf'), /for="st-sent"/);
  });
});

describe('policy library paint', () => {
  it('renders in the live shell from the mockups index', () => {
    const page = renderMockup('policy-library', 'csrf');
    assert.match(page, /class="ops"/);
    assert.match(page, /data-paint="policy-library"/);
    assert.match(page, /מדיניות/);
  });

  it('shows both sections, a version history, and an admin upload', () => {
    const admin = panel(renderMockup('policy-library', 'csrf'), 'admin');
    assert.match(admin, /דין/);
    assert.match(admin, /נוהל חברה/);
    assert.match(admin, /data-effective-from="2020-01-01"/);
    assert.match(admin, /data-effective-to="2023-12-31"/);
    assert.match(admin, /data-effective-from="2024-01-01"/);
    assert.match(admin, /type="file"/);
    assert.match(admin, /העלאה/);
    assert.match(renderMockup('policy-library', 'csrf'), /for="pol-admin"/);
  });

  it('shows the same library without upload to someone who is not an admin', () => {
    const reader = panel(renderMockup('policy-library', 'csrf'), 'reader');
    assert.match(reader, /דין/);
    assert.match(reader, /נוהל חברה/);
    assert.match(reader, /data-effective-from="2020-01-01"/);
    assert.match(reader, /data-effective-to="2023-12-31"/);
    assert.doesNotMatch(reader, /type="file"/);
    assert.doesNotMatch(reader, /העלאה/);
    assert.match(renderMockup('policy-library', 'csrf'), /for="pol-reader"/);
  });
});

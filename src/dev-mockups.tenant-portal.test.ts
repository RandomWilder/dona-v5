// The tenant-portal paint for #271. Deleted by the last ticket that wires a screen.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderMockup } from './dev-mockups.ts';

function panel(html: string, state: string): string {
  const match = html.match(
    new RegExp(`<section data-state="${state}"([^>]*)>([\\s\\S]*?)</section>`),
  );
  assert.ok(match, `missing state ${state}`);
  return `${match[1] ?? ''}\n${match[2] ?? ''}`;
}

describe('tenant portal paint', () => {
  it('renders in the live shell, listed from the mockups index', () => {
    const index = renderMockup('index', 'csrf');
    assert.match(index, /href="\/dev\/mockups\/tenant-portal"/);

    const page = renderMockup('tenant-portal', 'csrf');
    assert.match(page, /<html lang="he" dir="rtl">/);
    assert.match(page, /class="ops"/);
    assert.match(page, /data-paint="tenant-portal"/);
  });

  it('opens on a phone number, then a WhatsApp code with an SMS choice', () => {
    const page = renderMockup('tenant-portal', 'csrf');
    const phone = panel(page, 'phone');
    assert.match(phone, /מספר נייד/);
    assert.match(phone, /type="tel"/);
    assert.match(phone, /\+972/);
    const code = panel(page, 'code');
    assert.match(code, /וואטסאפ/);
    assert.match(code, /מסרון/);
    assert.match(code, /for="code-sms"/);
    assert.doesNotMatch(code, />כניסה</);
    assert.match(page, /for="st-phone"/);
    assert.match(page, /for="st-code"/);
  });

  it('offers a passkey after the code', () => {
    const page = renderMockup('tenant-portal', 'csrf');
    const passkey = panel(page, 'passkey');
    assert.match(passkey, /מפתח/);
    assert.match(passkey, /טביעת אצבע/);
    assert.match(page, /for="st-passkey"/);
  });

  it('shows the first-visit notice and an acknowledgement', () => {
    const page = renderMockup('tenant-portal', 'csrf');
    const notice = panel(page, 'notice');
    assert.match(notice, /הודעת פרטיות/);
    assert.match(notice, /קראתי/);
    assert.match(notice, /role="switch"/);
    assert.doesNotMatch(notice, /role="switch"[^>]*checked/);
    assert.match(page, /for="st-notice"/);
  });

  it('shows the reply line on the home screen', () => {
    const page = renderMockup('tenant-portal', 'csrf');
    const home = panel(page, 'home');
    assert.match(home, /אנחנו עונים בתוך 2 ימי עסקים/);
    assert.match(page, /for="st-home"/);
  });

  it('lets a tenant choose between two tenancies on my flat', () => {
    const page = renderMockup('tenant-portal', 'csrf');
    const flat = panel(page, 'flat');
    assert.match(flat, /רחוב הדגמה 8/);
    assert.match(flat, /רחוב אחר 2/);
    assert.match(flat, /חניה/);
    assert.match(flat, /מחסן/);
    assert.match(page, /for="st-flat"/);
  });

  it('lists the tenancy papers on the flat screen', () => {
    const page = renderMockup('tenant-portal', 'csrf');
    const flat = panel(page, 'flat');
    assert.match(flat, /מסמכים/);
    assert.match(flat, /חוזה/);
    assert.match(page, /for="st-papers"/);
  });

  it('switches tenancy and language in bottom sheets', () => {
    const page = renderMockup('tenant-portal', 'csrf');
    const tenancy = panel(page, 'tenancy');
    assert.match(tenancy, /בחירת דירה/);
    assert.match(tenancy, /for="tenancy-a"/);
    assert.match(tenancy, /for="tenancy-b"/);
    const lang = panel(page, 'lang');
    assert.match(lang, /for="st-english"/);
    assert.match(lang, /for="st-russian"/);
    assert.match(page, /for="st-tenancy"/);
    assert.match(page, /for="st-lang"/);
  });

  it('lists calls in the tenant status words', () => {
    const page = renderMockup('tenant-portal', 'csrf');
    const calls = panel(page, 'calls');
    assert.match(calls, /התקבלה/);
    assert.match(calls, /בטיפול/);
    assert.match(calls, /ממתין לתיאום/);
    assert.match(calls, /נקבע ביקור/);
    assert.match(calls, /בוטלה/);
    assert.match(page, /for="st-calls"/);
  });

  it('opens a call thread with a follow-up box', () => {
    const page = renderMockup('tenant-portal', 'csrf');
    const thread = panel(page, 'thread');
    assert.match(thread, /דוד המים/);
    assert.match(thread, /עוד פרט לקריאה/);
    assert.match(page, /for="st-thread"/);
    const closed = panel(page, 'thread-closed');
    assert.match(closed, /פתיחת קריאה המשך/);
    assert.doesNotMatch(closed, /עוד פרט לקריאה/);
    assert.match(page, /for="st-thread-closed"/);
  });

  it('paints report an issue in three steps: category, details, entry, then sent', () => {
    const page = renderMockup('tenant-portal', 'csrf');
    const report = panel(page, 'report');
    assert.match(report, /כונן/);
    assert.match(report, /href="tel:/);
    assert.ok(
      report.indexOf('tel:') < report.indexOf('name="category"'),
      'the emergency call comes before the form',
    );
    assert.match(report, /אינסטלציה/);
    assert.match(panel(page, 'report-2'), /type="file"/);
    assert.match(panel(page, 'report-3'), /להיכנס לדירה/);
    assert.match(panel(page, 'report-sent'), /הדיווח התקבל/);
    for (const id of [
      'st-report',
      'st-report-2',
      'st-report-3',
      'st-report-sent',
    ]) {
      assert.match(page, new RegExp(`for="${id}"`));
    }
  });

  it('paints ask the office', () => {
    const page = renderMockup('tenant-portal', 'csrf');
    const ask = panel(page, 'ask');
    assert.match(ask, /שאלה/);
    assert.match(ask, /<textarea/);
    assert.match(page, /for="st-ask"/);
  });

  it('tells a tenant their building is not in the portal yet, without the flat', () => {
    const page = renderMockup('tenant-portal', 'csrf');
    const locked = panel(page, 'not-yet');
    assert.match(locked, /עוד לא בפורטל/);
    assert.match(locked, /שאלה/);
    assert.doesNotMatch(locked, /חוזה/);
    assert.doesNotMatch(locked, /חניה/);
    assert.match(page, /for="st-not-yet"/);
  });

  it('shows one screen in English, left to right', () => {
    const page = renderMockup('tenant-portal', 'csrf');
    const english = panel(page, 'english');
    assert.match(english, /lang="en"/);
    assert.match(english, /dir="ltr"/);
    assert.match(english, /We reply within 2 business days/);
    assert.match(page, /for="st-english"/);
  });

  it('paints the building switch, and the refusal while a legal text is a placeholder', () => {
    const page = renderMockup('tenant-portal', 'csrf');
    const building = panel(page, 'switch');
    assert.match(building, /בניין הדגמה/);
    assert.match(building, /פורטל/);
    const refusal = panel(page, 'refusal');
    assert.match(refusal, /מציין מקום/);
    assert.match(refusal, /לא ניתן/);
    assert.match(page, /for="st-switch"/);
    assert.match(page, /for="st-refusal"/);
  });

  it('paints the settings additions for business days and the reply target', () => {
    const page = renderMockup('tenant-portal', 'csrf');
    const settings = panel(page, 'settings');
    assert.match(settings, /תאריכים לא עובדים/);
    assert.match(settings, /ימי עסקים/);
    assert.match(settings, /יעד מענה/);
    assert.match(settings, /הצגה לדיירים/);
    assert.match(page, /for="st-settings"/);
  });
});

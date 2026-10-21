// The portal's three languages. The choice wins, then the party's language when
// it is one of the three, otherwise Hebrew. Every Hebrew row has the other two.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  bindPortalLanguage,
  PORTAL_COPY,
  portalText,
} from './internal/copy.ts';
import { languageReturn, startingLanguage } from './internal/language.ts';
import { chooseShown } from './internal/legal.ts';
import { renderNoticePage, renderPhonePage } from './internal/views.ts';

describe('portal language', () => {
  it('starts from the choice, then the party, then Hebrew', () => {
    assert.equal(startingLanguage({ chosen: 'en', preferred: 'ru' }), 'en');
    assert.equal(startingLanguage({ chosen: null, preferred: 'ru' }), 'ru');
    assert.equal(startingLanguage({ chosen: 'ar', preferred: 'ar' }), 'he');
    assert.equal(startingLanguage({ chosen: null, preferred: null }), 'he');
  });

  it('keeps a return path on this host', () => {
    assert.equal(languageReturn('/more'), '/more');
    assert.equal(languageReturn('/sign-in/code'), '/sign-in/code');
    assert.equal(languageReturn('https://evil.example'), '/');
    assert.equal(languageReturn('//evil.example'), '/');
  });

  it('has every Hebrew row in English and Russian', () => {
    const hebrew = PORTAL_COPY.filter((row) => row.language === 'he').map(
      (row) => row.key,
    );
    assert.ok(hebrew.length > 100);
    for (const key of hebrew) {
      assert.equal(typeof portalText(key, 'en'), 'string', key);
      assert.equal(typeof portalText(key, 'ru'), 'string', key);
      if (key === 'flat.months_left') continue;
      assert.notEqual(portalText(key, 'en'), '', `${key} en`);
      assert.notEqual(portalText(key, 'ru'), '', `${key} ru`);
    }
    assert.equal(portalText('flat.months_left', 'en'), '');
    assert.throws(() => portalText('missing.key', 'en'), /missing portal copy/);
  });

  it('lays English out left to right and keeps Hebrew right to left', () => {
    bindPortalLanguage('en');
    const english = renderPhonePage({
      csrf: 'csrf',
      notice: null,
      caption: 'sign_in.caption',
      canSend: true,
      options: { publicKey: {} },
    });
    assert.match(english, /<html lang="en" dir="ltr">/);
    assert.match(english, /Enter the mobile number the office has for you/);
    assert.match(english, /שפה · Language · Язык/);
    assert.match(english, /lang="ru" dir="ltr"/);
    assert.doesNotMatch(english, /הזינו את מספר/);
    bindPortalLanguage('he');
    const hebrew = renderPhonePage({
      csrf: 'csrf',
      notice: null,
      caption: 'sign_in.caption',
      canSend: true,
      options: { publicKey: {} },
    });
    assert.match(hebrew, /<html lang="he" dir="rtl">/);
    assert.match(hebrew, /הזינו את מספר הנייד/);
  });

  it('shows a missing legal translation as Hebrew and says so', () => {
    const chosen = chooseShown(
      [
        {
          language: 'he',
          kind: 'privacy',
          opt_in_key: '',
          title: 'הודעת פרטיות',
        },
        {
          language: 'en',
          kind: 'terms',
          opt_in_key: '',
          title: 'Terms of use',
        },
        {
          language: 'he',
          kind: 'terms',
          opt_in_key: '',
          title: 'תנאי שימוש',
        },
      ],
      'en',
    );
    const privacy = chosen.find((item) => item.row.kind === 'privacy');
    const terms = chosen.find((item) => item.row.kind === 'terms');
    assert.equal(privacy?.fallback, true);
    assert.equal(privacy?.row.title, 'הודעת פרטיות');
    assert.equal(terms?.fallback, false);
    assert.equal(terms?.row.title, 'Terms of use');

    bindPortalLanguage('en');
    const page = renderNoticePage({
      csrf: 'csrf',
      privacy: {
        id: 'a2760001-0000-4000-8000-000000000001',
        title: 'הודעת פרטיות',
        summary: 'עברית',
        fallback: true,
      },
      terms: {
        id: 'a2760001-0000-4000-8000-000000000005',
        title: 'Terms of use',
        summary: 'Use is for viewing your tenancy.',
        fallback: false,
      },
      optIns: [],
    });
    assert.match(page, /Shown in Hebrew, because there is no translation yet/);
    assert.match(page, /lang="he" dir="rtl"/);
    assert.match(page, /הודעת פרטיות/);
    bindPortalLanguage('he');
  });

  it('keeps portal pages free of a literal sentence', () => {
    const files = [
      'src/portal/internal/views.ts',
      'src/portal/internal/call-screen.ts',
      'src/portal/internal/when.ts',
    ];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      assert.doesNotMatch(source, /[\u0590-\u05FF]/, file);
      assert.doesNotMatch(source, /[\u0400-\u04FF]/, file);
    }
  });
});

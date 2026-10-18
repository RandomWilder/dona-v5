// The two-button login paint for #260. Deleted when #263 wires the screen.
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

function buttons(html: string): { className: string; label: string }[] {
  return [...html.matchAll(/<a class="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map(
    (match) => ({ className: match[1] ?? '', label: match[2] ?? '' }),
  );
}

describe('two-button login paint', () => {
  it('renders in the live shell, in Hebrew, listed from the mockups index', () => {
    const index = renderMockup('index', 'csrf');
    assert.match(index, /<html lang="he" dir="rtl">/);
    assert.match(index, /href="\/dev\/mockups\/login"/);

    const page = renderMockup('login', 'csrf');
    assert.match(page, /<html lang="he" dir="rtl">/);
    assert.match(page, /class="ops"/);
    assert.match(page, /data-paint="login"/);
  });

  it('offers two equal buttons, Google then Microsoft, and a note naming both', () => {
    const page = renderMockup('login', 'csrf');
    const both = panel(page, 'both');
    const offered = buttons(both);
    assert.deepEqual(
      offered.map((button) => button.label),
      ['המשך עם Google', 'המשך עם Microsoft'],
    );
    assert.equal(offered[0]?.className, offered[1]?.className);
    assert.match(offered[0]?.className ?? '', /btn-primary/);
    assert.doesNotMatch(offered[0]?.className ?? '', /btn-secondary|btn-ghost/);
    assert.match(
      both,
      /הכניסה היא דרך חשבון Google או חשבון Microsoft\. אין כאן סיסמה ואין קוד\./,
    );
    assert.doesNotMatch(
      both,
      /הכניסה היא דרך חשבון Google\. אין כאן סיסמה ואין קוד\./,
    );
    assert.match(page, /for="st-both"/);
  });

  it('shows Google alone when Microsoft is unconfigured', () => {
    const page = renderMockup('login', 'csrf');
    const alone = panel(page, 'google-only');
    assert.deepEqual(
      buttons(alone).map((button) => button.label),
      ['המשך עם Google'],
    );
    assert.match(
      alone,
      /הכניסה היא דרך חשבון Google\. אין כאן סיסמה ואין קוד\./,
    );
    assert.doesNotMatch(alone, /Microsoft/);
    assert.match(page, /for="st-google-only"/);
  });
});

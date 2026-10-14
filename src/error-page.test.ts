import { strictEqual } from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  errorSentenceHe,
  renderErrorPage,
  wantsHtml,
  wayBack,
} from './error-page.ts';
import type { ErrorCode } from './kernel/errors.ts';

const CODES: readonly ErrorCode[] = [
  'invalid',
  'conflict',
  'not_found',
  'not_allowed',
  'too_many',
  'unavailable',
];

describe('the error page (#233)', () => {
  it('gives every code its own Hebrew sentence', () => {
    const sentences = new Set(CODES.map(errorSentenceHe));
    strictEqual(sentences.size, CODES.length);
    for (const s of sentences) strictEqual(/[֐-׿]/.test(s), true);
    for (const s of sentences) strictEqual(/[A-Za-z]/.test(s), false);
  });

  it('renders the guest frame without a session and the rail with one', () => {
    const guest = renderErrorPage({ code: 'not_allowed', back: '/' });
    strictEqual(guest.includes('class="ops-nav"'), false);
    strictEqual(guest.includes(errorSentenceHe('not_allowed')), true);
    const signed = renderErrorPage({
      code: 'conflict',
      back: '/estate/inventory',
      signedIn: { csrf: 't', mayFile: true, mayReadParties: true },
    });
    strictEqual(signed.includes('class="ops-nav"'), true);
    strictEqual(signed.includes('href="/estate/inventory"'), true);
  });

  it('asks for HTML only when Accept names text/html', () => {
    strictEqual(wantsHtml(undefined), false);
    strictEqual(wantsHtml('application/json'), false);
    strictEqual(wantsHtml('*/*'), false);
    strictEqual(wantsHtml('text/html,*/*;q=0.8'), true);
  });

  it('goes back only to this host', () => {
    strictEqual(wayBack('http://h:3000/a?b=1', 'h:3000'), '/a?b=1');
    strictEqual(wayBack('https://other/a', 'h:3000'), '/');
    strictEqual(wayBack('not a url', 'h:3000'), '/');
    strictEqual(wayBack('http://h:3000//evil.example/x', 'h:3000'), '/');
    strictEqual(wayBack(undefined, 'h:3000'), '/');
  });
});

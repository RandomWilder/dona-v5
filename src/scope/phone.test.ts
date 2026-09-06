// E.164 normalisation, and the reason it is a gate rather than a nicety.
//
// The workbook's note on PartyContact.value is "One format, always. Mixed formats break the inbound
// lookup silently." A number stored as +972521234567 and asked for as 052-123-4567 resolves to
// nobody — and a scope of nothing is what correct isolation looks like too. There is no screen on
// which that failure is visible, which is why the conversion is tested harder than its size
// suggests.
//
// Slice 2.1 landed the storage half as `phone_is_e164` on party_contact; this is the conversion
// half, and SPEC-scope.md is where the pairing is written down.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { KernelError } from '../kernel/errors.ts';
import { E164_PATTERN, normalisePhone } from './contract.ts';

const MOBILE = '+972521234567';

describe('scope · E.164 at the edge', () => {
  it('converts the formats a register and a person actually type', () => {
    // Every one of these is the same Israeli mobile. The first is what a spreadsheet export holds,
    // the last is what the database stores.
    for (const written of [
      '052-123-4567',
      '052 123 4567',
      '(052) 123-4567',
      '052.123.4567',
      '0521234567',
      '+972 52 123 4567',
      '+972-52-123-4567',
      '00972521234567',
      '972521234567',
      MOBILE,
    ]) {
      assert.equal(normalisePhone(written), MOBILE, written);
    }
  });

  it('keeps a number that is already international and is not ours', () => {
    // A foreign party is ordinary — an owner abroad, a contractor's head office — and the default
    // region may not be applied to a number that already carries its own.
    assert.equal(normalisePhone('+1 (415) 555-2671'), '+14155552671');
    assert.equal(normalisePhone('+44 20 7946 0958'), '+442079460958');
  });

  it('strips the bidi marks a Hebrew interface pastes in', () => {
    // A number copied out of an RTL screen arrives wrapped in direction marks. They are invisible,
    // and without this they reach the CHECK as characters and the row is rejected for no reason
    // anybody can see.
    assert.equal(normalisePhone('‏052-123-4567‎'), MOBILE);
  });

  it('refuses a national number with no country to attach it to', () => {
    // 521234567 is nine digits that pass the E.164 shape as +521234567 — a Mexican number. Guessing
    // is how one register row silently becomes a different country's subscriber, so a bare number is
    // accepted only when it already starts with the default country code.
    assert.throws(
      () => normalisePhone('521234567'),
      (error: unknown) => {
        assert.ok(error instanceof KernelError);
        assert.equal(error.code, 'invalid');
        return true;
      },
    );
  });

  it('refuses the leading zero kept after a country code', () => {
    // +972 concatenated onto 0521234567, which is the single most common way a phone column is
    // wrongly internationalised. It passes the E.164 shape and matches nothing, ever.
    assert.throws(() => normalisePhone('+9720521234567'), KernelError);
  });

  it('refuses what is not a number at all', () => {
    for (const bad of [
      '',
      '   ',
      'not a phone',
      '052-123-456a',
      '+972',
      '05212',
      '+9725212345678901234',
      '+0521234567',
    ]) {
      assert.throws(() => normalisePhone(bad), KernelError, bad);
    }
  });

  it('refuses a value that is not a string', () => {
    // The edge is where an inbound webhook's JSON arrives; `undefined` reaching a query parameter is
    // how a lookup silently becomes "WHERE value IS NULL".
    for (const bad of [undefined, null, 972521234567, {}]) {
      assert.throws(
        () => normalisePhone(bad as unknown as string),
        KernelError,
      );
    }
  });

  it('agrees with the database, not merely with itself', () => {
    // The one assertion that keeps the two halves in step: the expression this validates against is
    // the expression 0006_parties.sql's `phone_is_e164` CHECK holds. If the migration's changes, this
    // fails rather than the edge quietly accepting what the database will reject.
    const migration = readFileSync(
      new URL('../kernel/migrations/0006_parties.sql', import.meta.url),
      'utf8',
    );
    assert.ok(
      migration.includes(`'${E164_PATTERN.source}'`),
      'the CHECK in 0006_parties.sql no longer holds the pattern this module validates against',
    );
  });
});

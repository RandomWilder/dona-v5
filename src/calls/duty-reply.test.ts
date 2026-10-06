// #185. The fixed duty reply is composed from the duty rows. The sentence is a
// placeholder until the director approves the text. It calls no model: the
// return is a string, not a promise.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { composeDutyReply } from './contract.ts';

describe('calls · the duty reply', () => {
  it('produces the placeholder sentence from the duty phone and hours', () => {
    const reply = composeDutyReply({
      phone: '000-000-0000',
      hours: 'א׳–ה׳ 08:00–17:00',
    });
    assert.equal(typeof reply, 'string');
    assert.equal(
      reply,
      'קריאת חירום. להתקשר לכונן: 000-000-0000. שעות כונן: א׳–ה׳ 08:00–17:00.',
    );
  });
});

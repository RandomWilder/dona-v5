import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type ErrorCode,
  httpStatus,
  KernelError,
  toErrorBody,
} from './errors.ts';

const codes: readonly ErrorCode[] = [
  'not_found',
  'not_allowed',
  'conflict',
  'invalid',
  // Slice 5.2, and the sixth: a per-caller cap refusal.
  'too_many',
  'unavailable',
];

describe('KernelError', () => {
  it('renders every category through the one shape', () => {
    for (const code of codes) {
      const body = toErrorBody(new KernelError(code, `${code} happened`));
      assert.deepEqual(body, { code, message: `${code} happened` });
    }
  });

  it('carries optional details through to the body', () => {
    const body = toErrorBody(
      new KernelError('invalid', 'bad phone number', { field: 'phone' }),
    );
    assert.deepEqual(body, {
      code: 'invalid',
      message: 'bad phone number',
      details: { field: 'phone' },
    });
  });

  it('is a real Error with a name and stack', () => {
    const error = new KernelError('conflict', 'offer already accepted');
    assert.ok(error instanceof Error);
    assert.equal(error.name, 'KernelError');
    assert.ok(error.stack);
  });
});

describe('toErrorBody', () => {
  it('never leaks internals from unknown errors', () => {
    for (const raw of [
      new Error('connect ECONNREFUSED 127.0.0.1:5434'),
      'string thrown',
      undefined,
    ]) {
      const body = toErrorBody(raw);
      assert.deepEqual(body, {
        code: 'unavailable',
        message: 'unexpected error',
      });
    }
  });
});

describe('httpStatus', () => {
  it('maps every code to its status', () => {
    assert.equal(httpStatus('invalid'), 400);
    assert.equal(httpStatus('not_allowed'), 403);
    assert.equal(httpStatus('not_found'), 404);
    assert.equal(httpStatus('conflict'), 409);
    assert.equal(httpStatus('too_many'), 429);
    assert.equal(httpStatus('unavailable'), 503);
  });
});

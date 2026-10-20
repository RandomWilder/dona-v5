import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { codeSenderFromEnv } from './contract.ts';

describe('the portal code sender', () => {
  it('writes the code and not the number on a laptop', async () => {
    const lines: string[] = [];
    const sender = codeSenderFromEnv({}, (line) => {
      lines.push(line);
    });
    await sender.send({ to: '+972520000191', code: '123456' });
    assert.deepEqual(lines, ['portal sign-in code 123456']);
  });

  it('refuses to boot the log sender on staging or production', () => {
    assert.throws(
      () =>
        codeSenderFromEnv(
          {
            K_SERVICE: 'dona-staging',
            DOCS_BUCKET: 'dona-v5-staging-docs',
            PORTAL_CODE_LOG: '1',
          },
          () => {},
        ),
      /cannot be configured on staging or production/,
    );
    assert.throws(
      () =>
        codeSenderFromEnv(
          { K_SERVICE: 'dona-prod', PORTAL_CODE_LOG: '1' },
          () => {},
        ),
      /cannot be configured on staging or production/,
    );
  });

  it('does not deliver when a revision is deployed and the log was not asked for', async () => {
    const sender = codeSenderFromEnv({ K_SERVICE: 'dona-staging' }, () => {
      throw new Error('logged');
    });
    await assert.rejects(
      () => sender.send({ to: '+972520000191', code: '123456' }),
      /not configured/,
    );
  });
});

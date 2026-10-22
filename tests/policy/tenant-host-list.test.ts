// POLICY — the second hostname of a tenant host list is the tenant audience. #291.
//
// A staff route requested there is not found. The list did not exist when this case was written,
// so the second name was still the office and the route answered. docs/pipeline.md §6.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildApp } from '../../src/app.ts';
import { policyPool, skipReason } from './support.ts';

const SECOND = 'second.localhost';

describe('policy · a staff route on the second tenant hostname is not found', () => {
  it('does not find a staff route on the second hostname of a two-entry tenant host', async (t) => {
    const pool = await policyPool();
    if (pool === null) return t.skip(skipReason);
    t.after(() => pool.end());

    const app = buildApp({
      pool,
      version: '9.9.9-test',
      tenantHost: `tenant.localhost,${SECOND}`,
    });
    t.after(() => app.close());

    const response = await app.inject({
      method: 'GET',
      url: '/estate',
      headers: { host: SECOND },
    });
    assert.equal(response.statusCode, 404);
    assert.equal(
      response.body,
      '{"code":"not_found","message":"route not found"}',
    );
  });
});

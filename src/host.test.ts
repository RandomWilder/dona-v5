// The two hosts. #272.
//
// A staff route on the tenant host is not found, and a tenant route on the office host is not
// found. The tenant host's one page is a placeholder. Existing office requests carry no Host that
// names the tenant host, and they must keep answering as they do.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Pool } from 'pg';
import { buildApp, hostOf, tenantHostLine } from './app.ts';

const TENANT_HOST = 'tenant.localhost';

function deadPool(): Pool {
  return new Pool({
    connectionString: 'postgres://dona:dona@127.0.0.1:59999/dona',
    connectionTimeoutMillis: 500,
    allowExitOnIdle: true,
  });
}

describe('the two hosts', () => {
  it('does not find a staff route on the tenant host', async () => {
    const pool = deadPool();
    const app = buildApp({ pool, version: '9.9.9-test' });
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/estate',
        headers: { host: TENANT_HOST },
      });
      assert.equal(response.statusCode, 404);
      assert.equal(
        response.body,
        '{"code":"not_found","message":"route not found"}',
      );
    } finally {
      await app.close();
      await pool.end();
    }
  });

  it('does not find a tenant route on the office host, and serves it on the tenant host', async () => {
    const pool = deadPool();
    const app = buildApp({ pool, version: '9.9.9-test' });
    app.get(
      '/only-here',
      { config: { tenant: 'public' } },
      async () => 'tenant-only',
    );
    try {
      const office = await app.inject({
        method: 'GET',
        url: '/only-here',
        headers: { host: 'localhost' },
      });
      assert.equal(office.statusCode, 404);
      assert.equal(
        office.body,
        '{"code":"not_found","message":"route not found"}',
      );

      const tenant = await app.inject({
        method: 'GET',
        url: '/only-here',
        headers: { host: TENANT_HOST },
      });
      assert.equal(tenant.statusCode, 200);
      assert.equal(tenant.body, 'tenant-only');
    } finally {
      await app.close();
      await pool.end();
    }
  });

  it('serves one placeholder on the tenant host, and the office home is not that page', async () => {
    const pool = deadPool();
    const app = buildApp({ pool, version: '9.9.9-test' });
    try {
      const tenant = await app.inject({
        method: 'GET',
        url: '/',
        headers: { host: TENANT_HOST },
      });
      assert.equal(tenant.statusCode, 200);
      assert.match(tenant.body, /כניסה לפורטל הדיירים/);
      assert.match(tenant.body, /href="\/ui\/portal.css"/);

      const office = await app.inject({
        method: 'GET',
        url: '/',
        headers: { host: 'localhost' },
      });
      assert.equal(office.statusCode, 303);
      assert.equal(office.headers.location, '/staff/login');
      assert.equal(office.body.includes('שליחת קוד'), false);
    } finally {
      await app.close();
      await pool.end();
    }
  });

  it('refuses a route that declares both audiences, or a tenant stance beside a staff typo', () => {
    const pool = deadPool();
    const app = buildApp({ pool, version: '9.9.9-test' });
    assert.throws(() => {
      app.get(
        '/both',
        { config: { staff: 'estate.read', tenant: 'public' } },
        async () => 'no',
      );
    }, /declares no staff stance/);
    assert.throws(() => {
      app.get(
        '/typo',
        { config: { staff: 'estate.reed', tenant: 'public' } },
        async () => 'no',
      );
    }, /declares no staff stance/);
    void pool.end();
  });

  it('reads the host from the HTTP/2 authority when Host is absent', () => {
    // Inject always sets Host, so this is the header shape Cloud Run actually sends.
    assert.equal(hostOf({ ':authority': `${TENANT_HOST}:443` }), TENANT_HOST);
    assert.equal(
      hostOf({ host: 'localhost:3000', ':authority': TENANT_HOST }),
      'localhost',
    );
  });

  it('still serves the stylesheet on the tenant host', async () => {
    // The placeholder is a page. A page that cannot load the stylesheet is not a page.
    const pool = deadPool();
    const app = buildApp({ pool, version: '9.9.9-test' });
    try {
      const css = await app.inject({
        method: 'GET',
        url: '/ui/tokens.css',
        headers: { host: TENANT_HOST },
      });
      assert.equal(css.statusCode, 200);
    } finally {
      await app.close();
      await pool.end();
    }
  });
});

describe('a list of tenant hostnames', () => {
  it('serves a tenant route on each of two hostnames and not a staff route, and a third hostname is the office', async () => {
    const pool = deadPool();
    const app = buildApp({
      pool,
      version: '9.9.9-test',
      tenantHost: 'alpha.localhost,beta.localhost',
    });
    app.get(
      '/only-here',
      { config: { tenant: 'public' } },
      async () => 'tenant-only',
    );
    try {
      for (const host of ['alpha.localhost', 'beta.localhost']) {
        const tenant = await app.inject({
          method: 'GET',
          url: '/only-here',
          headers: { host },
        });
        assert.equal(tenant.statusCode, 200);
        assert.equal(tenant.body, 'tenant-only');

        const staff = await app.inject({
          method: 'GET',
          url: '/estate',
          headers: { host },
        });
        assert.equal(staff.statusCode, 404);
        assert.equal(
          staff.body,
          '{"code":"not_found","message":"route not found"}',
        );
      }

      const third = await app.inject({
        method: 'GET',
        url: '/only-here',
        headers: { host: 'gamma.localhost' },
      });
      assert.equal(third.statusCode, 404);
      const office = await app.inject({
        method: 'GET',
        url: '/',
        headers: { host: 'gamma.localhost' },
      });
      assert.equal(office.statusCode, 303);
      assert.equal(office.headers.location, '/staff/login');
    } finally {
      await app.close();
      await pool.end();
    }
  });

  it('matches an entry written with upper case, a port, surrounding spaces, or IPv6 brackets', async () => {
    const pool = deadPool();
    const app = buildApp({
      pool,
      version: '9.9.9-test',
      tenantHost: ' Alpha.Localhost:3000 , [2001:db8::1]:443 ',
    });
    app.get(
      '/only-here',
      { config: { tenant: 'public' } },
      async () => 'tenant-only',
    );
    try {
      for (const host of ['alpha.localhost', '[2001:db8::1]']) {
        const tenant = await app.inject({
          method: 'GET',
          url: '/only-here',
          headers: { host },
        });
        assert.equal(tenant.statusCode, 200, host);
      }
    } finally {
      await app.close();
      await pool.end();
    }
  });

  it('does not treat an empty entry between two commas as a hostname', async () => {
    const pool = deadPool();
    const app = buildApp({
      pool,
      version: '9.9.9-test',
      tenantHost: 'alpha.localhost,,beta.localhost',
    });
    app.get(
      '/only-here',
      { config: { tenant: 'public' } },
      async () => 'tenant-only',
    );
    try {
      // `:` is a hostname that normalises to nothing. An empty header is not, because the
      // injector replaces it, and that would pass even if the empty entry were kept.
      const empty = await app.inject({
        method: 'GET',
        url: '/only-here',
        headers: { host: ':' },
      });
      assert.equal(empty.statusCode, 404);

      const named = await app.inject({
        method: 'GET',
        url: '/only-here',
        headers: { host: 'beta.localhost' },
      });
      assert.equal(named.statusCode, 200);
    } finally {
      await app.close();
      await pool.end();
    }
  });

  it('keeps a single configured hostname exclusive of the default', async () => {
    const pool = deadPool();
    const app = buildApp({
      pool,
      version: '9.9.9-test',
      tenantHost: 'only.localhost',
    });
    app.get(
      '/only-here',
      { config: { tenant: 'public' } },
      async () => 'tenant-only',
    );
    try {
      const named = await app.inject({
        method: 'GET',
        url: '/only-here',
        headers: { host: 'only.localhost' },
      });
      assert.equal(named.statusCode, 200);
      const fallback = await app.inject({
        method: 'GET',
        url: '/only-here',
        headers: { host: TENANT_HOST },
      });
      assert.equal(fallback.statusCode, 404);
    } finally {
      await app.close();
      await pool.end();
    }
  });

  it('prints the whole list on the boot line', () => {
    assert.equal(
      tenantHostLine('alpha.localhost,beta.localhost'),
      'tenant host: alpha.localhost, beta.localhost',
    );
    assert.equal(tenantHostLine(undefined), 'tenant host: tenant.localhost');
    assert.equal(tenantHostLine(''), 'tenant host: tenant.localhost');
    assert.equal(
      tenantHostLine(' Alpha.Localhost:443 , beta.localhost , '),
      'tenant host: alpha.localhost, beta.localhost',
    );
  });
});

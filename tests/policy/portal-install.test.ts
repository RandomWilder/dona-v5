// POLICY — the installed portal caches no tenant data. #286. docs/pipeline.md §6.
//
// The worker may keep the stylesheets, the fonts and the icons. A page, and anything
// else that can carry a tenant's data, is not on that list and is not intercepted.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Pool } from 'pg';
import { buildApp } from '../../src/app.ts';

const HOST = { host: 'tenant.localhost' };

const STATIC =
  /^\/ui\/(?:tokens\.css|portal\.css|fonts\/[a-z0-9.-]+\.woff2|icons\/portal-icon-(?:180|192|512)\.png)$/;

function deadPool(): Pool {
  return new Pool({
    connectionString: 'postgres://dona:dona@127.0.0.1:59999/dona',
    connectionTimeoutMillis: 500,
    allowExitOnIdle: true,
  });
}

describe('policy · the portal installs without caching tenant data', () => {
  it('serves a manifest and a worker that caches only static assets', async () => {
    const pool = deadPool();
    const app = buildApp({ pool, version: '9.9.9-test' });
    try {
      const manifest = await app.inject({
        method: 'GET',
        url: '/manifest.webmanifest',
        headers: HOST,
      });
      assert.equal(manifest.statusCode, 200);
      assert.match(
        String(manifest.headers['content-type']),
        /application\/manifest\+json/,
      );
      const doc = manifest.json() as {
        name: string;
        short_name: string;
        start_url: string;
        scope: string;
        display: string;
        lang: string;
        dir: string;
        icons: Array<{ src: string; sizes: string; type: string }>;
      };
      assert.equal(doc.name, 'פורטל הדיירים');
      assert.equal(doc.short_name, 'דונה');
      assert.equal(doc.start_url, '/');
      assert.equal(doc.scope, '/');
      assert.equal(doc.display, 'standalone');
      assert.equal(doc.lang, 'he');
      assert.equal(doc.dir, 'rtl');
      const sizes = doc.icons.map((icon) => icon.sizes);
      assert.ok(sizes.includes('192x192'));
      assert.ok(sizes.includes('512x512'));
      for (const icon of doc.icons) {
        assert.equal(icon.type, 'image/png');
        assert.match(icon.src, STATIC);
        const file = await app.inject({
          method: 'GET',
          url: icon.src,
          headers: HOST,
        });
        assert.equal(file.statusCode, 200, icon.src);
        assert.equal(file.headers['content-type'], 'image/png');
        assert.equal(file.rawPayload[0], 0x89);
      }

      const english = await app.inject({
        method: 'GET',
        url: '/manifest.webmanifest',
        headers: { ...HOST, cookie: 'dona_portal_lang=en' },
      });
      const en = english.json() as {
        name: string;
        short_name: string;
        dir: string;
        lang: string;
      };
      assert.equal(en.name, 'Tenant portal');
      assert.equal(en.short_name, 'Dona');
      assert.equal(en.lang, 'en');
      assert.equal(en.dir, 'ltr');

      const russian = await app.inject({
        method: 'GET',
        url: '/manifest.webmanifest',
        headers: { ...HOST, cookie: 'dona_portal_lang=ru' },
      });
      const ru = russian.json() as {
        name: string;
        short_name: string;
        lang: string;
      };
      assert.equal(ru.name, 'Портал жильцов');
      assert.equal(ru.short_name, 'Дона');
      assert.equal(ru.lang, 'ru');

      const office = await app.inject({
        method: 'GET',
        url: '/manifest.webmanifest',
        headers: { host: 'localhost' },
      });
      assert.equal(office.statusCode, 404);

      const worker = await app.inject({
        method: 'GET',
        url: '/sw.js',
        headers: HOST,
      });
      assert.equal(worker.statusCode, 200);
      assert.match(String(worker.headers['content-type']), /javascript/);
      const list = /const STATIC = (\[[\s\S]*?\]);/.exec(worker.body);
      assert.ok(list?.[1]);
      const paths = JSON.parse(list[1]) as string[];
      assert.ok(paths.length > 0);
      for (const path of paths) assert.match(path, STATIC);
      assert.match(
        worker.body,
        /if \(!STATIC\.includes\(url\.pathname\)\) return;/,
      );
      assert.doesNotMatch(worker.body, /text\/html/);

      const officeWorker = await app.inject({
        method: 'GET',
        url: '/sw.js',
        headers: { host: 'localhost' },
      });
      assert.equal(officeWorker.statusCode, 404);

      const page = await app.inject({
        method: 'GET',
        url: '/',
        headers: HOST,
      });
      assert.equal(page.statusCode, 200);
      assert.match(page.body, /rel="manifest" href="\/manifest\.webmanifest"/);
      assert.match(
        page.body,
        /rel="apple-touch-icon" href="\/ui\/icons\/portal-icon-180\.png"/,
      );
      assert.match(
        page.body,
        /name="apple-mobile-web-app-capable" content="yes"/,
      );
      assert.match(page.body, /name="mobile-web-app-capable" content="yes"/);
      assert.match(page.body, /apple-mobile-web-app-title" content="דונה"/);
      assert.match(page.body, /dona\.portal\.install/);
      assert.match(page.body, /serviceWorker\.register\('\/sw\.js'\)/);
      assert.doesNotMatch(page.body, /<script[^>]*\ssrc=/);

      const englishPage = await app.inject({
        method: 'GET',
        url: '/',
        headers: { ...HOST, cookie: 'dona_portal_lang=en' },
      });
      assert.match(
        englishPage.body,
        /apple-mobile-web-app-title" content="Dona"/,
      );
    } finally {
      await app.close();
      await pool.end();
    }
  });
});

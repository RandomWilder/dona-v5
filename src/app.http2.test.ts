// The 100 MB upload bound is a Cloud Run problem before it is a parser problem.
//
// An HTTP/1 request above 32 MiB is refused by Google's edge, with the English page, and this
// process never sees it. The hosted service speaks cleartext HTTP/2 so that edge steps aside and
// the parser's 100 MB is the limit that answers. This file is that claim: a body over 32 MiB is
// read, the listener is HTTP/2 only when asked, and both deploys keep the flags that make it true.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { connect } from 'node:http2';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import { Pool } from 'pg';
import { buildApp, createH2cServer, h2cSessionMib } from './app.ts';

const HTTP1_CEILING = 32 * 1024 * 1024;

function deadPool(): Pool {
  return new Pool({
    connectionString: 'postgres://dona:dona@127.0.0.1:59999/dona',
    connectionTimeoutMillis: 500,
    allowExitOnIdle: true,
  });
}

describe('a hosted upload follows the 100 MB bound', () => {
  it('reads a body Cloud Run would refuse on HTTP/1', async () => {
    const size = HTTP1_CEILING + 1;
    const server = createH2cServer((req, res) => {
      let received = 0;
      req.on('data', (chunk: Buffer) => {
        received += chunk.length;
      });
      req.on('end', () => {
        res.writeHead(200);
        res.end(String(received));
      });
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const { port } = server.address() as AddressInfo;
    try {
      const received = await new Promise<number>((resolve, reject) => {
        const client = connect(`http://127.0.0.1:${port}`);
        client.on('error', reject);
        const req = client.request({ ':method': 'POST', ':path': '/' });
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          client.close();
          resolve(Number(Buffer.concat(chunks).toString()));
        });
        req.on('error', reject);
        req.end(Buffer.alloc(size, 1));
      });
      assert.equal(received, size);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('gives the session room for a 100 MB scan', () => {
    assert.ok(h2cSessionMib >= 100);
  });

  it('listens with HTTP/2 only when the hosted service asks', async () => {
    const hosted = buildApp({
      pool: deadPool(),
      version: 'http2-test',
      http2: true,
    });
    const local = buildApp({ pool: deadPool(), version: 'http2-test' });
    try {
      assert.equal(hosted.server.constructor.name, 'Http2Server');
      assert.equal(local.server.constructor.name, 'Server');
    } finally {
      await hosted.close();
      await local.close();
    }
  });

  it('keeps HTTP/2 and 2Gi on both deploys', () => {
    for (const file of [
      '.github/workflows/deploy.yml',
      '.github/workflows/release.yml',
    ]) {
      const text = readFileSync(file, 'utf8');
      assert.match(text, /--use-http2/);
      assert.match(text, /--memory 2Gi/);
    }
  });
});

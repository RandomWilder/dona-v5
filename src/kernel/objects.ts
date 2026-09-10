import { createHash, createHmac } from 'node:crypto';
import { GoogleAuth } from 'google-auth-library';
import { KernelError } from './errors.ts';

// Object storage, on the same footing as db.ts: the shape of a transfer and no
// business logic. It does not know what a lease is. The paths it is handed are
// built by the module that owns them -- `src/evidence/internal/storage-path.ts`
// and SPEC-evidence.md, "The object path convention" -- and it never invents
// one. (This cited SPEC-occupancy.md until slice 3.2, which is a v3 filename
// that has never existed in this repository: the 1.4 lift brought the comment
// with the code, and 3.2 is the slice that gave the sentence a real referent.)
//
// **There is no `delete` here, and there is not going to be one.** The bucket
// holds signed contracts. The runtime account carries objectViewer +
// objectCreator and deliberately not objectAdmin (slice 1.5, re-applied on every
// bootstrap run), so a delete would fail at the credential anyway -- having
// neither is the point, and the absent method is the control a reader can check
// without a cloud console. Permanent removal is an act somebody performs through
// a script with its own refusals (infra/corpus-delete.sh, slice 1.12), never a
// method the application happens to hold.

export interface StoredObject {
  bytes: Buffer;
  contentType: string;
}

export interface ObjectStore {
  // The name is `put` rather than `upload`: writing the same path twice
  // replaces, and the bucket's versioning is what keeps the previous bytes.
  put(path: string, bytes: Buffer, contentType: string): Promise<void>;
  read(path: string): Promise<StoredObject>;
  /**
   * Slice 5.4. A GCS V4 GET URL for this path. `expiresAt` at or before `now` is `invalid`.
   * `now` comes from the injected clock; this port does not read the wall.
   */
  signRead(path: string, expiresAt: Date, now: Date): Promise<string>;
  // For the boot line. A deployed revision running on memory is wrong in the
  // same visible way a `-dev` version string is, so it has to be sayable.
  describe(): string;
}

/** Fifteen minutes. Short because the URL is a bearer token for one object. */
export const SIGN_READ_TTL_MS = 15 * 60 * 1000;

const HOST = 'storage.googleapis.com';
const UNSIGNED = 'UNSIGNED-PAYLOAD';

function googDate(at: Date): string {
  return at
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function canonicalUri(bucket: string, objectPath: string): string {
  const encoded = objectPath
    .split('/')
    .map((segment) => encodeRfc3986(segment))
    .join('/');
  return `/${bucket}/${encoded}`;
}

function canonicalQuery(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map((key) => `${encodeRfc3986(key)}=${encodeRfc3986(params[key] ?? '')}`)
    .join('&');
}

function v4StringToSign(
  bucket: string,
  objectPath: string,
  params: Record<string, string>,
  datetime: string,
  date: string,
): string {
  const canonicalRequest = [
    'GET',
    canonicalUri(bucket, objectPath),
    canonicalQuery(params),
    `host:${HOST}\n`,
    'host',
    UNSIGNED,
  ].join('\n');
  const hashed = createHash('sha256').update(canonicalRequest).digest('hex');
  return [
    params['X-Goog-Algorithm'],
    datetime,
    `${date}/auto/storage/goog4_request`,
    hashed,
  ].join('\n');
}

function v4Url(
  bucket: string,
  objectPath: string,
  params: Record<string, string>,
  signatureHex: string,
): string {
  const query = canonicalQuery({
    ...params,
    'X-Goog-Signature': signatureHex,
  });
  return `https://${HOST}${canonicalUri(bucket, objectPath)}?${query}`;
}

function readTtlSeconds(expiresAt: Date, now: Date): number {
  if (expiresAt.getTime() <= now.getTime()) {
    throw new KernelError('invalid', 'signed read has expired');
  }
  return Math.max(1, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
}

/**
 * When this URL stops being live, from `X-Goog-Date` + `X-Goog-Expires`.
 * A missing or unreadable pair is already stale.
 */
export function signedReadLiveUntil(url: string): Date | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const datetime = parsed.searchParams.get('X-Goog-Date');
  const expires = parsed.searchParams.get('X-Goog-Expires');
  if (!datetime || !expires) return null;
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(datetime);
  if (!match) return null;
  const seconds = Number(expires);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const start = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  );
  return new Date(start + seconds * 1000);
}

async function mintV4Url(
  bucket: string,
  objectPath: string,
  expiresAt: Date,
  now: Date,
  algorithm: string,
  credentialEmail: string,
  sign: (payload: Buffer) => Promise<Buffer>,
): Promise<string> {
  const ttl = readTtlSeconds(expiresAt, now);
  const datetime = googDate(now);
  const date = datetime.slice(0, 8);
  const params = {
    'X-Goog-Algorithm': algorithm,
    'X-Goog-Credential': `${credentialEmail}/${date}/auto/storage/goog4_request`,
    'X-Goog-Date': datetime,
    'X-Goog-Expires': String(ttl),
    'X-Goog-SignedHeaders': 'host',
  };
  const toSign = v4StringToSign(bucket, objectPath, params, datetime, date);
  const signature = await sign(Buffer.from(toSign, 'utf8'));
  return v4Url(bucket, objectPath, params, signature.toString('hex'));
}

// What the tests use, and what `npm run dev` falls back to. No bucket, no
// network, no credentials -- a clean clone still runs.
export function createMemoryStore(): ObjectStore {
  const objects = new Map<string, StoredObject>();
  return {
    async put(path, bytes, contentType) {
      objects.set(path, { bytes: Buffer.from(bytes), contentType });
    },
    async read(path) {
      const found = objects.get(path);
      if (!found) {
        throw new KernelError('not_found', 'object not found');
      }
      return {
        bytes: Buffer.from(found.bytes),
        contentType: found.contentType,
      };
    },
    async signRead(path, expiresAt, now) {
      return mintV4Url(
        'dona-v5-memory-docs',
        path,
        expiresAt,
        now,
        'GOOG4-HMAC-SHA256',
        'memory@dona-v5.test',
        async (payload) =>
          createHmac('sha256', 'dona-v5-memory-sign').update(payload).digest(),
      );
    },
    describe: () => 'memory',
  };
}

const scope = 'https://www.googleapis.com/auth/devstorage.read_write';

export interface GcsOptions {
  bucket: string;
  // Injected in tests so the fetch and the token are both fakeable; production
  // passes neither.
  fetchImpl?: typeof fetch;
  token?: () => Promise<string>;
  /** The SA `signBlob` signs as. Tests pass it; Cloud Run reads it from metadata. */
  serviceAccountEmail?: string;
  /** Tests pass a fake; production POSTs IAM Credentials. */
  signBlob?: (payload: Buffer) => Promise<Buffer>;
}

export function createGcsStore(options: GcsOptions): ObjectStore {
  const { bucket } = options;
  const call = options.fetchImpl ?? fetch;
  // Lazily, and once: constructing this reads ADC from disk on a laptop, and
  // boot must not depend on that when the store is never used.
  let auth: GoogleAuth | null = null;
  const token =
    options.token ??
    (async () => {
      auth ??= new GoogleAuth({ scopes: [scope] });
      const value = await auth.getAccessToken();
      if (!value) {
        throw new KernelError('unavailable', 'no access token for storage');
      }
      return value;
    });

  // Percent-encoded whole, slashes included: the object name is one opaque
  // string to the API, and a path segment that looked like a URL path would
  // address a different object.
  const objectUrl = (path: string, kind: 'upload' | 'read'): string =>
    kind === 'upload'
      ? `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(path)}`
      : `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(path)}?alt=media`;

  return {
    async put(path, bytes, contentType) {
      const response = await call(objectUrl(path, 'upload'), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${await token()}`,
          'content-type': contentType,
        },
        body: new Uint8Array(bytes),
      });
      if (!response.ok) {
        // The status and nothing from the body: an error body from a storage
        // API can echo the object name, and the name is on its way into a log.
        throw new KernelError('unavailable', 'object could not be stored', {
          status: response.status,
        });
      }
    },

    async read(path) {
      const response = await call(objectUrl(path, 'read'), {
        headers: { authorization: `Bearer ${await token()}` },
      });
      if (response.status === 404) {
        throw new KernelError('not_found', 'object not found');
      }
      if (!response.ok) {
        throw new KernelError('unavailable', 'object could not be read', {
          status: response.status,
        });
      }
      return {
        bytes: Buffer.from(await response.arrayBuffer()),
        contentType:
          response.headers.get('content-type') ?? 'application/octet-stream',
      };
    },

    async signRead(path, expiresAt, now) {
      const email =
        options.serviceAccountEmail ?? (await serviceAccountEmail(call));
      const sign =
        options.signBlob ??
        ((payload: Buffer) => iamSignBlob(call, token, email, payload));
      return mintV4Url(
        bucket,
        path,
        expiresAt,
        now,
        'GOOG4-RSA-SHA256',
        email,
        sign,
      );
    },

    describe: () => `gs://${bucket}`,
  };
}

async function serviceAccountEmail(call: typeof fetch): Promise<string> {
  const response = await call(
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email',
    { headers: { 'Metadata-Flavor': 'Google' } },
  );
  if (!response.ok) {
    throw new KernelError('unavailable', 'no service account to sign with', {
      status: response.status,
    });
  }
  const email = (await response.text()).trim();
  if (!email) {
    throw new KernelError('unavailable', 'no service account to sign with');
  }
  return email;
}

async function iamSignBlob(
  call: typeof fetch,
  token: () => Promise<string>,
  email: string,
  payload: Buffer,
): Promise<Buffer> {
  const response = await call(
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(email)}:signBlob`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await token()}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ payload: payload.toString('base64') }),
    },
  );
  if (!response.ok) {
    throw new KernelError('unavailable', 'object could not be signed', {
      status: response.status,
    });
  }
  const body = (await response.json()) as { signedBlob?: string };
  if (!body.signedBlob) {
    throw new KernelError('unavailable', 'object could not be signed');
  }
  return Buffer.from(body.signedBlob, 'base64');
}

/**
 * The store this process is configured for, on `createPool`'s pattern of reading the environment in
 * the kernel and nowhere deeper.
 *
 * **An absent `DOCS_BUCKET` falls back to memory and the caller says so on the boot line.** It is
 * not an error: locally there is no bucket and `npm run dev` must still start. It is not silent
 * either — a deployed revision running on memory is wrong in the same visible way a `-dev` version
 * string is, and `deploy.yml` has injected `DOCS_BUCKET` since slice 1.6 while nothing in this
 * repository read it, so until slice 3.2 that failure had no way to be seen at all.
 */
export function createConfiguredStore(
  env: Record<string, string | undefined> = process.env,
): ObjectStore {
  const bucket = env.DOCS_BUCKET;
  return bucket ? createGcsStore({ bucket }) : createMemoryStore();
}

// The name a `storage_uri` carries when nothing configured a bucket. Slice 3.3.
//
// `document.storage_uri` holds `gs://<bucket>/<path>` and a read refuses a bucket that is not the
// one this process is configured for, so a row written on a laptop still has to name a bucket. It
// names this one rather than a deployment's, because a local row pointing at
// `dona-v5-staging-docs` would be a row that a staging process would happily follow.
export const devBucketName = 'dona-v5-dev-docs';

/** The bucket this process writes into rows, beside the store it writes objects into. */
export function configuredBucket(
  env: Record<string, string | undefined> = process.env,
): string {
  return env.DOCS_BUCKET ?? devBucketName;
}

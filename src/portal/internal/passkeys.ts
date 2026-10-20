// WebAuthn passkeys. The browser performs the ceremony; this file checks it and
// stores the result. Attestation is none: Safari and Chrome are asked not to
// send a certificate, and any other format is refused. An assertion is checked
// with the stored P-256 key. #275.
import {
  createHash,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify,
} from 'node:crypto';
import type { AuditLog } from '../../kernel/audit.ts';
import type { Clock } from '../../kernel/clock.ts';
import { KernelError } from '../../kernel/errors.ts';
import { newId } from '../../kernel/ids.ts';
import type { Queryable } from './types.ts';

const CEREMONY_MS = 5 * 60 * 1000;
const REFUSED = new KernelError('invalid', 'passkey was not accepted');
const UP = 0x01;
const UV = 0x04;
const AT = 0x40;
const ED = 0x80;

type Cbor = number | string | Uint8Array | Cbor[] | Map<Cbor, Cbor>;

export interface PasskeyRow {
  passkeyId: string;
  addedOn: Date;
}

export interface CeremonyContext {
  origin: string;
  rpId: string;
}

function refuse(): never {
  throw REFUSED;
}

function bytesOf(value: string, max: number): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > max) refuse();
  return new Uint8Array(Buffer.from(value, 'base64url'));
}

function b64url(value: Uint8Array): string {
  return Buffer.from(value).toString('base64url');
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function sha256(value: Uint8Array | string): Uint8Array {
  const hash = createHash('sha256');
  hash.update(value);
  return new Uint8Array(hash.digest());
}

function readLength(
  data: Uint8Array,
  offset: number,
  info: number,
): { value: number; end: number } {
  if (info < 24) return { value: info, end: offset };
  const widths = [1, 2, 4, 8];
  const width = widths[info - 24];
  if (width === undefined || offset + width > data.length) refuse();
  let value = 0;
  for (let i = 0; i < width; i += 1) {
    value = value * 256 + (data[offset + i] ?? 0);
  }
  if (!Number.isSafeInteger(value)) refuse();
  return { value, end: offset + width };
}

function decodeAt(
  data: Uint8Array,
  offset: number,
): { value: Cbor; end: number } {
  const initial = data[offset];
  if (initial === undefined) refuse();
  const major = initial >> 5;
  const info = initial & 0x1f;
  const length = readLength(data, offset + 1, info);
  if (major === 0) return { value: length.value, end: length.end };
  if (major === 1) return { value: -1 - length.value, end: length.end };
  if (major === 2 || major === 3) {
    const end = length.end + length.value;
    if (end > data.length) refuse();
    const slice = data.slice(length.end, end);
    if (major === 2) return { value: slice, end };
    return { value: Buffer.from(slice).toString('utf8'), end };
  }
  if (major === 4) {
    const items: Cbor[] = [];
    let cursor = length.end;
    for (let i = 0; i < length.value; i += 1) {
      const item = decodeAt(data, cursor);
      items.push(item.value);
      cursor = item.end;
    }
    return { value: items, end: cursor };
  }
  if (major === 5) {
    const map = new Map<Cbor, Cbor>();
    let cursor = length.end;
    for (let i = 0; i < length.value; i += 1) {
      const key = decodeAt(data, cursor);
      const item = decodeAt(data, key.end);
      map.set(key.value, item.value);
      cursor = item.end;
    }
    return { value: map, end: cursor };
  }
  refuse();
}

function asMap(value: Cbor): Map<Cbor, Cbor> {
  if (!(value instanceof Map)) refuse();
  return value;
}

function mapValue(map: Map<Cbor, Cbor>, key: string | number): Cbor {
  for (const [held, value] of map) {
    if (held === key) return value;
  }
  refuse();
}

function asBytes(value: Cbor): Uint8Array {
  if (!(value instanceof Uint8Array)) refuse();
  return value;
}

function asText(value: Cbor): string {
  if (typeof value !== 'string') refuse();
  return value;
}

function asNumber(value: Cbor): number {
  if (typeof value !== 'number') refuse();
  return value;
}

function readClientData(encoded: string): {
  type: string;
  origin: string;
  challenge: Uint8Array;
  raw: Uint8Array;
  crossOrigin: boolean;
} {
  const raw = bytesOf(encoded, 16_384);
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw).toString('utf8'));
  } catch {
    refuse();
  }
  if (parsed === null || typeof parsed !== 'object') refuse();
  const record = parsed as Record<string, unknown>;
  if (typeof record.type !== 'string' || typeof record.origin !== 'string') {
    refuse();
  }
  if (typeof record.challenge !== 'string') refuse();
  return {
    type: record.type,
    origin: record.origin,
    challenge: bytesOf(record.challenge, 128),
    raw,
    crossOrigin: record.crossOrigin === true,
  };
}

interface AuthData {
  signCount: number;
  credentialId: Uint8Array | null;
  publicKey: Uint8Array | null;
}

function authenticatorData(
  raw: Uint8Array,
  rpId: string,
  attested: boolean,
): AuthData {
  if (raw.length < 37) refuse();
  const rpHash = raw.slice(0, 32);
  if (!sameBytes(rpHash, sha256(rpId))) refuse();
  const flags = raw[32] ?? 0;
  if ((flags & UP) === 0 || (flags & UV) === 0 || (flags & ED) !== 0) {
    refuse();
  }
  const signCount =
    (raw[33] ?? 0) * 0x1000000 +
    (raw[34] ?? 0) * 0x10000 +
    (raw[35] ?? 0) * 0x100 +
    (raw[36] ?? 0);
  if (!attested) {
    if ((flags & AT) !== 0) refuse();
    return { signCount, credentialId: null, publicKey: null };
  }
  if ((flags & AT) === 0 || raw.length < 55) refuse();
  const idLength = ((raw[53] ?? 0) << 8) | (raw[54] ?? 0);
  if (idLength < 16 || idLength > 1023) refuse();
  const idEnd = 55 + idLength;
  if (idEnd > raw.length) refuse();
  const credentialId = raw.slice(55, idEnd);
  const cose = decodeAt(raw, idEnd);
  if (cose.end !== raw.length) refuse();
  const key = asMap(cose.value);
  if (asNumber(mapValue(key, 1)) !== 2) refuse();
  if (asNumber(mapValue(key, 3)) !== -7) refuse();
  if (asNumber(mapValue(key, -1)) !== 1) refuse();
  const x = asBytes(mapValue(key, -2));
  const y = asBytes(mapValue(key, -3));
  if (x.length !== 32 || y.length !== 32) refuse();
  const point = new Uint8Array(65);
  point[0] = 0x04;
  point.set(x, 1);
  point.set(y, 33);
  return { signCount, credentialId, publicKey: point };
}

async function consumeChallenge(
  db: Queryable,
  clock: Clock,
  challenge: Uint8Array,
  kind: 'register' | 'authenticate',
  identityId: string | null,
): Promise<{ origin: string; rpId: string } | null> {
  const now = clock.now();
  const { rows } = await db.query<{ origin: string; rp_id: string }>(
    `UPDATE portal_passkey_challenge
        SET consumed_at = $2
      WHERE challenge = $1
        AND kind = $3
        AND consumed_at IS NULL
        AND expires_at > $2
        AND ($4::uuid IS NULL OR portal_identity_id = $4)
      RETURNING origin, rp_id`,
    [Buffer.from(challenge), now, kind, identityId],
  );
  const row = rows[0];
  if (row === undefined) return null;
  return { origin: row.origin, rpId: row.rp_id };
}

async function issueChallenge(
  db: Queryable,
  clock: Clock,
  kind: 'register' | 'authenticate',
  identityId: string | null,
  ceremony: CeremonyContext,
): Promise<string> {
  const challenge = randomBytes(32);
  const now = clock.now();
  await db.query(
    `INSERT INTO portal_passkey_challenge
       (challenge_id, kind, portal_identity_id, challenge, origin, rp_id,
        expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      newId(clock),
      kind,
      identityId,
      challenge,
      ceremony.origin,
      ceremony.rpId,
      new Date(now.getTime() + CEREMONY_MS),
    ],
  );
  return b64url(challenge);
}

export async function beginRegistration(
  db: Queryable,
  clock: Clock,
  identity: {
    portalIdentityId: string;
    accountName: string;
    displayName: string;
  },
  ceremony: CeremonyContext,
): Promise<Record<string, unknown>> {
  const challenge = await issueChallenge(
    db,
    clock,
    'register',
    identity.portalIdentityId,
    ceremony,
  );
  const { rows } = await db.query<{ credential_id: Buffer }>(
    `SELECT credential_id FROM portal_passkey
      WHERE portal_identity_id = $1 AND removed_at IS NULL`,
    [identity.portalIdentityId],
  );
  const userId = Buffer.from(identity.portalIdentityId, 'utf8');
  return {
    publicKey: {
      challenge,
      rp: { id: ceremony.rpId, name: identity.displayName },
      user: {
        id: b64url(userId),
        name: identity.accountName,
        displayName: identity.displayName,
      },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      timeout: 60_000,
      attestation: 'none',
      authenticatorSelection: {
        residentKey: 'required',
        requireResidentKey: true,
        userVerification: 'required',
        authenticatorAttachment: 'platform',
      },
      excludeCredentials: rows.map((row) => ({
        type: 'public-key',
        id: b64url(row.credential_id),
      })),
    },
  };
}

export async function finishRegistration(
  db: Queryable,
  clock: Clock,
  audit: AuditLog,
  identityId: string,
  posted: { clientDataJSON: string; attestationObject: string },
): Promise<void> {
  const client = readClientData(posted.clientDataJSON);
  if (client.type !== 'webauthn.create' || client.crossOrigin) refuse();
  const issued = await consumeChallenge(
    db,
    clock,
    client.challenge,
    'register',
    identityId,
  );
  if (issued === null || client.origin !== issued.origin) refuse();
  let parsed: AuthData;
  try {
    const attestation = decodeAt(bytesOf(posted.attestationObject, 65_536), 0);
    const object = asMap(attestation.value);
    if (asText(mapValue(object, 'fmt')) !== 'none') refuse();
    parsed = authenticatorData(
      asBytes(mapValue(object, 'authData')),
      issued.rpId,
      true,
    );
  } catch (error) {
    if (error instanceof KernelError) throw error;
    refuse();
  }
  if (parsed.credentialId === null || parsed.publicKey === null) refuse();
  const passkeyId = newId(clock);
  try {
    await db.query(
      `INSERT INTO portal_passkey
         (passkey_id, portal_identity_id, credential_id, public_key,
          sign_count, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        passkeyId,
        identityId,
        Buffer.from(parsed.credentialId),
        Buffer.from(parsed.publicKey),
        parsed.signCount,
        clock.now(),
      ],
    );
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === '23505') refuse();
    throw error;
  }
  await audit.write(
    {
      actorKind: 'tenant',
      actorId: identityId,
      action: 'portal.passkey.add',
      subjectId: passkeyId,
      inputs: {},
    },
    { outcome: 'ok' },
  );
}

export async function beginAuthentication(
  db: Queryable,
  clock: Clock,
  ceremony: CeremonyContext,
): Promise<Record<string, unknown>> {
  const challenge = await issueChallenge(
    db,
    clock,
    'authenticate',
    null,
    ceremony,
  );
  return {
    publicKey: {
      challenge,
      rpId: ceremony.rpId,
      timeout: 60_000,
      userVerification: 'required',
    },
  };
}

export async function finishAuthentication(
  db: Queryable,
  clock: Clock,
  posted: {
    id: string;
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle: string;
  },
): Promise<string> {
  const credentialId = bytesOf(posted.id, 2048);
  const { rows } = await db.query<{
    portal_identity_id: string;
    public_key: Buffer;
    sign_count: number;
  }>(
    `SELECT portal_identity_id, public_key, sign_count
       FROM portal_passkey
      WHERE credential_id = $1
        AND removed_at IS NULL`,
    [Buffer.from(credentialId)],
  );
  const row = rows[0];
  if (row === undefined) refuse();
  const handle = Buffer.from(bytesOf(posted.userHandle, 256)).toString('utf8');
  if (handle !== row.portal_identity_id) refuse();
  const client = readClientData(posted.clientDataJSON);
  if (client.type !== 'webauthn.get' || client.crossOrigin) refuse();
  const issued = await consumeChallenge(
    db,
    clock,
    client.challenge,
    'authenticate',
    null,
  );
  if (issued === null || client.origin !== issued.origin) refuse();
  const authRaw = bytesOf(posted.authenticatorData, 65_536);
  const parsed = authenticatorData(authRaw, issued.rpId, false);
  const signature = bytesOf(posted.signature, 256);
  const point = new Uint8Array(row.public_key);
  if (point.length !== 65 || point[0] !== 0x04) refuse();
  let ok = false;
  try {
    const key = createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: b64url(point.slice(1, 33)),
        y: b64url(point.slice(33, 65)),
      },
      format: 'jwk',
    });
    ok = verify(
      'sha256',
      Buffer.concat([authRaw, sha256(client.raw)]),
      { key, dsaEncoding: 'der' },
      signature,
    );
  } catch (error) {
    if (error instanceof KernelError) throw error;
    refuse();
  }
  if (!ok) refuse();
  const held = Number(row.sign_count);
  if (parsed.signCount > 0 && held > 0 && parsed.signCount <= held) refuse();
  if (parsed.signCount > held) {
    await db.query(
      `UPDATE portal_passkey
          SET sign_count = $2
        WHERE credential_id = $1
          AND removed_at IS NULL`,
      [Buffer.from(credentialId), parsed.signCount],
    );
  }
  return row.portal_identity_id;
}

export async function listPasskeys(
  db: Queryable,
  identityId: string,
): Promise<PasskeyRow[]> {
  const { rows } = await db.query<{
    passkey_id: string;
    created_at: Date;
  }>(
    `SELECT passkey_id, created_at
       FROM portal_passkey
      WHERE portal_identity_id = $1
        AND removed_at IS NULL
      ORDER BY created_at`,
    [identityId],
  );
  return rows.map((row) => ({
    passkeyId: row.passkey_id,
    addedOn: row.created_at,
  }));
}

const PASSKEY_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function removePasskey(
  db: Queryable,
  clock: Clock,
  audit: AuditLog,
  identityId: string,
  passkeyId: string,
): Promise<boolean> {
  if (!PASSKEY_ID.test(passkeyId)) return false;
  const { rowCount } = await db.query(
    `UPDATE portal_passkey
        SET removed_at = $3
      WHERE passkey_id = $1
        AND portal_identity_id = $2
        AND removed_at IS NULL`,
    [passkeyId, identityId, clock.now()],
  );
  if (rowCount !== 1) return false;
  await audit.write(
    {
      actorKind: 'tenant',
      actorId: identityId,
      action: 'portal.passkey.remove',
      subjectId: passkeyId,
      inputs: {},
    },
    { outcome: 'ok' },
  );
  return true;
}

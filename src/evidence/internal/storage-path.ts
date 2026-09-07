// Where a document's bytes live, and what the path is allowed to say. Slice 3.2, and the rule is in
// SPEC-evidence.md, "The object path convention".
//
// `src/kernel/objects.ts` is infrastructure and does not know what a lease is: it stores the path it
// is handed and never invents one. This file is the module that owns the paper deciding what that
// path may contain.
//
//   gs://<bucket>/<place kind>/<place id>/<type key>/<file hash>.<ext>
//
// **The path carries the place and never the people.** Two streets that transliterate alike would
// file one flat's lease under another's — a correctness failure with isolation flavour, and it
// arrives quietly, because nothing about the row looks wrong afterwards. So every segment is a uuid,
// a word from a fixed vocabulary, or a hex digest, and there is no name, no address and no
// uploader-supplied filename anywhere in it.
import { createHash } from 'node:crypto';
import { KernelError } from '../../kernel/errors.ts';
import { validId } from '../../kernel/validate.ts';

/**
 * The kinds of thing a document may be filed *under*.
 *
 * Deliberately narrower than `LinkEntityType`, which carries eight values: `TENANCY`, `PARTY`,
 * `ASSET` and `OBLIGATION` are not places and are absent, so a lease cannot be filed under a
 * signatory's id even by a caller who wants to. That is the convention's headline rule enforced by
 * the type system rather than by care.
 *
 * A tenancy is the *binding* an upload asks for (SPEC-flows.md invariant 1) and stays a
 * `document_link` row: a tenancy is temporal, and rooting the filing cabinet at it would scatter one
 * flat's papers across its lettings.
 */
export type PlaceKind = 'PROJECT' | 'BUILDING' | 'SPACE' | 'UNIT';

const placeSegments: Record<PlaceKind, string> = {
  PROJECT: 'project',
  BUILDING: 'building',
  SPACE: 'space',
  UNIT: 'unit',
};

/**
 * What may sit after the dot.
 *
 * Small on purpose, and it grows by a decision rather than by whatever arrived. A file this system
 * cannot read is refused at the door instead of filed unreadable, and the same list is what slice
 * 3.3's upload validator offers.
 */
export const documentExtensions = ['pdf', 'jpg', 'png', 'tif'] as const;
export type DocumentExtension = (typeof documentExtensions)[number];

/** What the object is stored as. One list, beside the extensions, so the two cannot disagree. */
export const documentContentTypes: Record<DocumentExtension, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  png: 'image/png',
  tif: 'image/tiff',
};

// The first bytes of each kind we store. TIFF is here twice because the two byte orders are two
// signatures for one format -- `II` is little-endian and `MM` is big-endian, and a scanner picks
// whichever its vendor picked.
const signatures: Array<[DocumentExtension, number[]]> = [
  ['pdf', [0x25, 0x50, 0x44, 0x46, 0x2d]],
  ['jpg', [0xff, 0xd8, 0xff]],
  ['png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  ['tif', [0x49, 0x49, 0x2a, 0x00]],
  ['tif', [0x4d, 0x4d, 0x00, 0x2a]],
];

/**
 * What kind of file this is, **read from the bytes and never from the upload** (slice 3.3).
 *
 * A browser sends a filename and a content type, and both are the caller's opinion. The filename is
 * the sharper problem: it routinely carries a household's name — `שכירות כהן.pdf` — and this whole
 * convention exists to keep a person out of the object path, so taking the extension off it would
 * put the rest of the name one edit away from a path segment. It is not read here, not stored, not
 * logged and not rendered.
 *
 * A file that is none of the four is `invalid` at the edge rather than an unreadable object in the
 * bucket, which is what the extension list has said since 3.2.
 */
export function sniffExtension(bytes: Buffer): DocumentExtension {
  for (const [extension, signature] of signatures) {
    if (
      bytes.length >= signature.length &&
      signature.every((byte, at) => bytes[at] === byte)
    ) {
      return extension;
    }
  }
  throw new KernelError('invalid', 'file is not one of the kinds we store', {
    accepted: documentExtensions.join(', '),
  });
}

// The catalogue's own `type_key` shape (`lease`, `handover_protocol`, …). Checked here as well as
// seeded there, because the path is built from the key and a key with a slash in it would address a
// directory rather than name a type.
const typeKeyPattern = /^[a-z][a-z0-9_]*$/;
// sha256, lowercase, as `documentFileHash` produces it. Uppercase is refused rather than folded: two
// spellings of one digest are two paths for one file.
const fileHashPattern = /^[0-9a-f]{64}$/;
// Cloud Storage bucket naming, in the subset we ever create: lowercase, 3–63 characters, starting
// and ending alphanumeric.
const bucketPattern = /^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/;

export interface Place {
  kind: PlaceKind;
  id: string;
}

export interface ObjectPathSpec {
  place: Place;
  typeKey: string;
  fileHash: string;
  extension: DocumentExtension;
}

/**
 * The value `document.file_hash` holds — sha256 over the bytes, hex, lowercase.
 *
 * Taken at ingest and immutable thereafter, which the `document_is_immutable` trigger enforces
 * rather than asks for (slice 3.1). It is also the object path's leaf, so hashing is the first act
 * of an ingest and everything else is computable from it.
 */
export function documentFileHash(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Builds the object path for one document.
 *
 * **Every input is validated and none is sanitised.** A builder that cleaned a street name into a
 * path segment would be the transliteration collision this convention exists to prevent, wearing a
 * helmet: the caller would get a plausible path for the wrong flat and nothing would look wrong
 * afterwards. Anything that is not a uuid, a `type_key`-shaped word, a 64-character lowercase digest
 * or an allowed extension is `invalid` here, at the edge (SPEC.md).
 */
export function documentObjectPath(spec: ObjectPathSpec): string {
  const segment = placeSegments[spec.place.kind];
  if (!segment) {
    throw new KernelError(
      'invalid',
      'a document is filed under a place, never under a person',
      { kind: String(spec.place.kind) },
    );
  }
  const placeId = validId(spec.place.id, `${segment} id`);
  if (!typeKeyPattern.test(spec.typeKey)) {
    throw new KernelError('invalid', 'document type key is not a type key');
  }
  if (!fileHashPattern.test(spec.fileHash)) {
    throw new KernelError('invalid', 'file hash is not a sha256 digest');
  }
  if (!(documentExtensions as readonly string[]).includes(spec.extension)) {
    throw new KernelError('invalid', 'file extension is not one we store', {
      accepted: documentExtensions.join(', '),
    });
  }
  return `${segment}/${placeId}/${spec.typeKey}/${spec.fileHash}.${spec.extension}`;
}

/** `gs://<bucket>/<path>` — what `document.storage_uri` holds. */
export function documentStorageUri(bucket: string, path: string): string {
  if (!bucketPattern.test(bucket)) {
    throw new KernelError('invalid', 'bucket is not a bucket name');
  }
  return `gs://${bucket}/${path}`;
}

/**
 * Reads a `storage_uri` back, and **refuses a bucket that is not the one this process is configured
 * for.**
 *
 * A database cloned from staging to a laptop carries staging's rows, so a `storage_uri` has to name
 * the bucket it means rather than assume the reader's. Refusing the mismatch is what stops a process
 * following a row into another environment's documents — the cheap half of an isolation property,
 * available here because the uri is self-describing.
 *
 * The path is re-checked against the convention on the way out for the same reason it is checked on
 * the way in: a row edited by hand must not be able to point a read at an arbitrary object in the
 * bucket.
 */
export function parseStorageUri(
  uri: string,
  expectedBucket: string,
): { bucket: string; path: string } {
  const match = /^gs:\/\/([^/]+)\/(.+)$/.exec(uri);
  if (!match) {
    throw new KernelError('invalid', 'storage uri is not a gs:// uri');
  }
  const [, bucket = '', path = ''] = match;
  if (bucket !== expectedBucket) {
    throw new KernelError('invalid', 'storage uri names another bucket', {
      expected: expectedBucket,
      found: bucket,
    });
  }
  parseObjectPath(path);
  return { bucket, path };
}

/**
 * The inverse of `documentObjectPath`, and the check that a path is one of ours.
 *
 * Used by `parseStorageUri` and by the tests that prove the round trip. It re-derives the place
 * kind, so a path rooted at anything outside `PlaceKind` fails here too — the rule holds in both
 * directions rather than only where the path was built.
 */
export function parseObjectPath(path: string): ObjectPathSpec {
  const parts = path.split('/');
  if (parts.length !== 4) {
    throw new KernelError('invalid', 'object path is not a document path');
  }
  const [segment = '', placeId = '', typeKey = '', leaf = ''] = parts;
  const kind = (Object.keys(placeSegments) as PlaceKind[]).find(
    (candidate) => placeSegments[candidate] === segment,
  );
  if (!kind) {
    throw new KernelError(
      'invalid',
      'a document is filed under a place, never under a person',
      { segment },
    );
  }
  const dot = leaf.lastIndexOf('.');
  if (dot <= 0) {
    throw new KernelError('invalid', 'object path has no file extension');
  }
  const spec: ObjectPathSpec = {
    place: { kind, id: placeId },
    typeKey,
    fileHash: leaf.slice(0, dot),
    extension: leaf.slice(dot + 1) as DocumentExtension,
  };
  // Rebuilt rather than trusted: whatever comes back out has been through the same validation the
  // way in used, and equals the path it was parsed from.
  if (documentObjectPath(spec) !== path) {
    throw new KernelError('invalid', 'object path is not a document path');
  }
  return spec;
}

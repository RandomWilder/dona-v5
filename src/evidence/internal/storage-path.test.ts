import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { KernelError } from '../../kernel/errors.ts';
import {
  documentFileHash,
  documentObjectPath,
  documentStorageUri,
  parseObjectPath,
  parseStorageUri,
  sniffExtension,
} from './storage-path.ts';

// No database and no bucket: the convention is a pure function, and it is the one part of slice 3.2
// that can be proved exhaustively rather than demonstrated once on staging.

const unitId = '019a4c7e-2b31-7f0c-8d55-6f1a0d3e9b42';
const hash = documentFileHash(Buffer.from('%PDF-1.7 a lease'));

function rejects(build: () => unknown, expected: string): void {
  assert.throws(build, (error: KernelError) => {
    assert.equal(error.code, 'invalid');
    assert.match(error.message, new RegExp(expected));
    return true;
  });
}

describe('document object path', () => {
  it('is a place, an id, a type key and the digest', () => {
    assert.equal(
      documentObjectPath({
        place: { kind: 'UNIT', id: unitId },
        typeKey: 'lease',
        fileHash: hash,
        extension: 'pdf',
      }),
      `unit/${unitId}/lease/${hash}.pdf`,
    );
  });

  it('says nothing about anybody — every segment is an id, a vocabulary word or a digest', () => {
    const path = documentObjectPath({
      place: { kind: 'BUILDING', id: unitId },
      typeKey: 'handover_protocol',
      fileHash: hash,
      extension: 'pdf',
    });
    // The whole point of the convention, asserted as a property of the output rather than as a
    // promise in a comment: nothing here is a word somebody typed.
    for (const segment of path.split('/')) {
      assert.match(segment, /^[a-z0-9._-]+$/);
    }
    assert.ok(!/[֐-׿]/.test(path), 'no Hebrew in an object path');
  });

  it('is the same path for the same file, every time', () => {
    const spec = {
      place: { kind: 'UNIT', id: unitId },
      typeKey: 'lease',
      fileHash: hash,
      extension: 'pdf',
    } as const;
    assert.equal(documentObjectPath(spec), documentObjectPath(spec));
  });

  it('hashes the bytes and not the name — two copies of one file land in one place', () => {
    assert.equal(
      documentFileHash(Buffer.from('%PDF-1.7 a lease')),
      documentFileHash(Buffer.from('%PDF-1.7 a lease')),
    );
    assert.notEqual(hash, documentFileHash(Buffer.from('%PDF-1.7 a bill')));
    assert.match(hash, /^[0-9a-f]{64}$/);
  });

  // The refusals. Each one is a way the place could have become a person, a directory or a guess.

  it('refuses an id that is a transliterated address rather than an id', () => {
    rejects(
      () =>
        documentObjectPath({
          place: { kind: 'UNIT', id: 'hertzl-14-tel-aviv' },
          typeKey: 'lease',
          fileHash: hash,
          extension: 'pdf',
        }),
      'is not an id',
    );
    rejects(
      () =>
        documentObjectPath({
          place: { kind: 'UNIT', id: 'רחוב הרצל 14' },
          typeKey: 'lease',
          fileHash: hash,
          extension: 'pdf',
        }),
      'is not an id',
    );
  });

  it('refuses a place kind that is a person or a tenancy', () => {
    // `LinkEntityType` carries eight values and `PlaceKind` carries four. TypeScript refuses these
    // at compile time; the cast is what a caller reaching this function from JSON would look like,
    // and the answer has to be the same.
    for (const kind of ['PARTY', 'TENANCY', 'ASSET', 'OBLIGATION']) {
      rejects(
        () =>
          documentObjectPath({
            place: { kind: kind as 'UNIT', id: unitId },
            typeKey: 'lease',
            fileHash: hash,
            extension: 'pdf',
          }),
        'never under a person',
      );
    }
  });

  it('refuses a type key that would address a directory', () => {
    for (const typeKey of ['../lease', 'lease/2026', 'Lease', '']) {
      rejects(
        () =>
          documentObjectPath({
            place: { kind: 'UNIT', id: unitId },
            typeKey,
            fileHash: hash,
            extension: 'pdf',
          }),
        'is not a type key',
      );
    }
  });

  it('refuses a digest that is the wrong length, the wrong case or not a digest', () => {
    for (const fileHash of [hash.toUpperCase(), hash.slice(0, 63), 'abc', '']) {
      rejects(
        () =>
          documentObjectPath({
            place: { kind: 'UNIT', id: unitId },
            typeKey: 'lease',
            fileHash,
            extension: 'pdf',
          }),
        'is not a sha256 digest',
      );
    }
  });

  it('refuses an extension outside the list, rather than storing what it cannot read', () => {
    for (const extension of ['exe', 'PDF', 'pdf.exe', '']) {
      rejects(
        () =>
          documentObjectPath({
            place: { kind: 'UNIT', id: unitId },
            typeKey: 'lease',
            fileHash: hash,
            extension: extension as 'pdf',
          }),
        'is not one we store',
      );
    }
  });
});

describe('storage uri', () => {
  const bucket = 'dona-v5-staging-docs';
  const path = documentObjectPath({
    place: { kind: 'UNIT', id: unitId },
    typeKey: 'lease',
    fileHash: hash,
    extension: 'pdf',
  });

  it('names the bucket it means, and round-trips', () => {
    const uri = documentStorageUri(bucket, path);
    assert.equal(uri, `gs://${bucket}/${path}`);
    assert.deepEqual(parseStorageUri(uri, bucket), { bucket, path });
  });

  it('refuses to follow a row into another environment bucket', () => {
    // A database cloned from staging to a laptop carries staging's rows. The uri is self-describing
    // precisely so the mismatch is refusable rather than invisible.
    rejects(
      () => parseStorageUri(`gs://dona-v5-prod-docs/${path}`, bucket),
      'names another bucket',
    );
  });

  it('refuses anything that is not a gs:// uri', () => {
    for (const uri of [
      `https://storage.googleapis.com/${bucket}/${path}`,
      `/${path}`,
      'gs://only-a-bucket',
    ]) {
      rejects(() => parseStorageUri(uri, bucket), 'gs://|document path');
    }
  });

  it('refuses a hand-edited row that points at an arbitrary object', () => {
    rejects(
      () => parseStorageUri(`gs://${bucket}/secrets/dump.pdf`, bucket),
      'never under a person|is not a document path',
    );
    rejects(
      () =>
        parseStorageUri(
          `gs://${bucket}/party/${unitId}/id/${hash}.pdf`,
          bucket,
        ),
      'never under a person',
    );
  });

  it('parses a path back into the spec it was built from', () => {
    assert.deepEqual(parseObjectPath(path), {
      place: { kind: 'UNIT', id: unitId },
      typeKey: 'lease',
      fileHash: hash,
      extension: 'pdf',
    });
  });
});

// The kind of a file, read from the file. Slice 3.3.
describe('sniffing the kind of an uploaded file', () => {
  const png = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
  ]);

  it('reads the kind out of the bytes', () => {
    assert.equal(sniffExtension(Buffer.from('%PDF-1.7 a lease')), 'pdf');
    assert.equal(sniffExtension(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'jpg');
    assert.equal(sniffExtension(png), 'png');
    assert.equal(sniffExtension(Buffer.from([0x49, 0x49, 0x2a, 0x00])), 'tif');
    assert.equal(sniffExtension(Buffer.from([0x4d, 0x4d, 0x00, 0x2a])), 'tif');
  });

  it('believes the bytes and not the name', () => {
    // The upload route never sees this file's name. A `.pdf` that is a PNG is filed as a PNG, and a
    // `.jpg` that is a Windows executable is refused — which is the whole reason the extension in
    // the object path is derived here rather than taken from the form.
    assert.equal(sniffExtension(png), 'png');
    rejects(
      () => sniffExtension(Buffer.from([0x4d, 0x5a, 0x90, 0x00])),
      'is not one of the kinds we store',
    );
  });

  it('refuses an empty file and a file too short to have a signature', () => {
    rejects(() => sniffExtension(Buffer.alloc(0)), 'is not one of the kinds');
    rejects(
      () => sniffExtension(Buffer.from([0x25, 0x50])),
      'is not one of the kinds',
    );
  });
});

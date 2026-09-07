// Slice 3.2's Verify step, as a program rather than as a session of gcloud commands.
//
//   npm run docs:probe
//
// The bar is "the app can write and read a contract and cannot delete one", and the proof has to be
// made **as the runtime account** — a policy says what was granted, an impersonated call says what
// is enforced (slice 1.5). So this runs on staging as a Cloud Run job from the serving image, as
// `app-staging`, which is this repository's standing practice for a fixture nobody wants wired into
// a workflow (1.11, 2.6, 3.1).
//
// **Three legs, and the first two are the positive control.** 1.5's denial looked textbook on the
// first attempt and was actually an impersonation grant that had not propagated — the call never
// reached Secret Manager at all. The positive control failing in the same run is what exposed it. A
// denial is only evidence when the same mechanism can be shown to allow something, so a run where
// the write or the read fails is a failed run and not three-quarters of a proof.
//
// **The delete goes around `ObjectStore` on purpose.** src/kernel/objects.ts has no `delete` and is
// never getting one, so the only way to ask the question is to issue the request by hand with the
// store's own credentials. That is what makes the evidence two independent controls rather than one:
// the application has no method, *and* the credential has no permission. Note that the OAuth scope
// the store asks for — devstorage.read_write — does permit deletion; what refuses it is the IAM
// grant, objectViewer + objectCreator and deliberately not objectAdmin (infra/bootstrap.sh).
import { GoogleAuth } from 'google-auth-library';
import {
  documentFileHash,
  documentObjectPath,
  documentStorageUri,
  parseStorageUri,
} from './evidence/contract.ts';
import { createConfiguredStore } from './kernel/objects.ts';

// A fixed place id, not a generated one, so a second run overwrites the same object instead of
// littering a new one — and so the object named in tasks/evidence/3.2.md is the object an admin can
// go and remove. The random half is all zeroes, which no `newId()` will ever produce: this is
// visibly a probe and not a flat.
const PROBE_PLACE = '019a0000-0000-7000-8000-000000000000';
// No personal data, no money, nothing resembling a real document — the same bar every tier-1 file
// clears (SPEC.md, "The corpus, in three tiers").
const PROBE_BYTES = Buffer.from(
  '%PDF-1.7\n% dona-v5 slice 3.2 storage probe\n',
);

const bucket = process.env.DOCS_BUCKET;
const store = createConfiguredStore();

const fileHash = documentFileHash(PROBE_BYTES);
const path = documentObjectPath({
  place: { kind: 'UNIT', id: PROBE_PLACE },
  typeKey: 'lease',
  fileHash,
  extension: 'pdf',
});

console.log(`docs:probe — store ${store.describe()}`);
console.log(`  path  ${path}`);

// Leg 1 — write. objectCreator.
await store.put(path, PROBE_BYTES, 'application/pdf');
console.log(`  put   ok — ${PROBE_BYTES.length} bytes`);

// Leg 2 — read it back, and compare. objectViewer. This is the positive control, and comparing the
// bytes rather than counting them is the difference between "something is there" and "our object is
// there": a 200 carrying the wrong body would pass a length check on a file this small.
const read = await store.read(path);
if (!read.bytes.equals(PROBE_BYTES)) {
  console.error('  read  FAILED — bytes differ from what was written');
  process.exit(1);
}
console.log(`  read  ok — ${read.bytes.length} bytes, ${read.contentType}`);

if (!bucket) {
  // Locally there is no bucket and no runtime identity, so the leg that matters cannot be run. Said
  // out loud rather than skipped quietly: a probe that reports success having asked nothing is the
  // silent-skip failure docs/pipeline.md §7 names, in a different costume.
  console.log(
    '  del   NOT RUN — no DOCS_BUCKET, so this is the memory store. The delete leg is the',
  );
  console.log(
    '        slice Verify step and only means anything as app-staging against the real bucket.',
  );
  process.exit(0);
}

// The uri that would land in `document.storage_uri`, round-tripped through the parser so the probe
// also exercises the foreign-bucket refusal on the way past.
const uri = documentStorageUri(bucket, path);
parseStorageUri(uri, bucket);
console.log(`  uri   ${uri}`);

// Leg 3 — delete, expecting to be refused.
const auth = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/devstorage.read_write'],
});
const token = await auth.getAccessToken();
const response = await fetch(
  `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(path)}`,
  { method: 'DELETE', headers: { authorization: `Bearer ${token}` } },
);

if (response.ok || response.status === 204) {
  console.error(
    `  del   FAILED — the runtime account DELETED the object (HTTP ${response.status}).`,
  );
  console.error(
    '        objectAdmin has been granted somewhere, or the bucket IAM has drifted.',
  );
  process.exit(1);
}

// The body is printed here and nowhere else in this system. Everywhere else a storage error body is
// swallowed because it can echo an object name into a log (kernel/objects.ts); here the object name
// is a probe constant and the body *is* the evidence — it names the permission that was missing.
const body = await response.text();
console.log(`  del   DENIED — HTTP ${response.status}`);
for (const line of body.trim().split('\n')) {
  console.log(`        ${line}`);
}

if (response.status !== 403) {
  console.error(
    `  del   but ${response.status} is not 403 — a refusal for the wrong reason is not the proof.`,
  );
  process.exit(1);
}

console.log('docs:probe — write ok, read ok, delete denied');

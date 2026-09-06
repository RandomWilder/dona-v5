// The generated register's entry point -- `npm run register:generate -- <units> <file.csv> [seed]`.
// Slice 2.6.
//
// It writes a file rather than loading one, and that is the point of it: the artefact is the same
// twenty-two columns an administrator is handed and the same file 2.5's real export will be, so what
// gets timed at 1,500 units is the whole path -- read, parse, validate, write -- and not a shortcut
// through it. `src/seed-register.ts` is the other door, for an environment that needs volume without
// a file.
//
// **The day is printed with the seed**, because both are needed to reproduce the file: "leases
// ending in the next 60 days" is a question about a day, and a fixed one would answer it emptily.
import { writeFile } from 'node:fs/promises';
import { generateRegister } from './register/fixtures/generate.ts';

const units = Number(process.argv[2]);
const out = process.argv[3];
const seed = process.argv[4] ? Number(process.argv[4]) : undefined;

if (!Number.isInteger(units) || units < 1 || !out) {
  console.error(
    'usage: npm run register:generate -- <units> <file.csv> [seed]\n' +
      'the format is SPEC-register.md; load it with npm run import:register',
  );
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
const { csv, summary } = generateRegister({ units, today, seed });
await writeFile(out, csv, 'utf8');

console.log(`generate: ${out} — ${today}, seed ${seed ?? 2026}`);
for (const [name, value] of Object.entries(summary)) {
  console.log(`generate: ${name} — ${value}`);
}

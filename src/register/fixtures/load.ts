// The designed register, and the deliberately broken one. Slice 2.4.
//
// **Ours, and designed for coverage of the cases that break things** — docs/pipeline.md §1 principle
// 5, and SPEC.md's tier 3. The addresses are not Dona Dom's and the people do not exist. The real
// register belongs to step 4 of the method (SPEC-flows.md) and reaches this same importer through
// this same format, which is the point of proving the path against a file we control first.
//
// **The cities, the phone numbers and the identifiers are all this suite's own**, and that is not
// tidiness. `node --test` runs files in parallel against one database, and two transactions
// inserting the same `party_contact` value with overlapping dates each block on the other's
// speculative insertion: the first draft of this fixture reused `+972521234567` from
// src/parties/schema.test.ts and turned thirteen tests across five files into `40P01 deadlock
// detected`. The phone block is `+97258201xxxx` and `+97258260xxxx`, the identifiers are `0715…`
// and `0726…`, and nothing else in the repository uses either.
//
// **`terms_profile.name` is part of that namespace and 2.4 missed it**, which slice 2.6 found by
// loading a generated register into the same database and watching three suites go red on
// `terms_profile_natural_key`. The key is global -- a profile is identified by its name and by
// nothing else (0009) -- so a fixture naming a plausible annex collides with the register that
// eventually names the real one. Every profile in these two files now carries the same suffix its
// cities do.
//
// The cities carry a suffix no other suite uses. These fixtures are applied against a database other
// test files are using at the same moment — `node --test` runs files in parallel and
// src/estate/routes.test.ts commits — so every assertion in the suite is scoped to a city and
// nothing ever counts a whole table (slice 1.11, learned in CI within the hour).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const read = (name: string): string =>
  readFileSync(path.join(here, name), 'utf8');

/**
 * Nine rows over two buildings, carrying every case that breaks an importer:
 *
 * - **one person under two spellings of one ת.ז.** — `071500001` and `71500001`, which is what a
 *   spreadsheet does to a leading zero — on two tenancies in two cities;
 * - **a recycled phone number**, held by one party to 30 June and by another from 15 July;
 * - **a guarantor**, who is on the lease and is not a service contact;
 * - **two tenancies on one unit**, one `ENDED` and one `ACTIVE`, which is a vacancy followed by a
 *   letting rather than an overlap;
 * - **a company party** whose name contains a quotation mark, which is the CSV rule most exports
 *   get wrong;
 * - **a building with no project** (R15), and **a `DRAFT` tenancy** that has not started.
 */
export const registerFixture = (): string => read('register.csv');

/**
 * Eleven rows, nine of them broken and each in one way, with a good row first and a good row last.
 *
 * The last row is the assertion the file exists for: **the import did not stop.** Its defects are
 * ordered so that the four rejected by the *database* — the guarantor, the overlapping lease, the
 * duplicated number and the natural-key collision — sit between two rows that must land.
 */
export const brokenFixture = (): string => read('broken.csv');

/** The cities these fixtures use, and the scope every assertion in the suite is taken within. */
export const REGISTER_CITIES = [
  'לוד — מרשם בדיקה',
  'אשקלון — מרשם בדיקה',
] as const;
export const BROKEN_CITY = 'רמלה — מרשם שבור';

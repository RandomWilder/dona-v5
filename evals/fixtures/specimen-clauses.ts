// The tier-1 corpus, loaded from the files it lives in.
//
// **This file used to *be* the corpus.** Nine passages were authored here at
// slice 1.8 because the specimens did not exist yet, and the header said in so
// many words that 1.12 would swap them in. It did. The passages now live in
// `docs/corpus/`, where they can be read as documents rather than as a string
// literal, and this file is the loader over them.
//
// The point of loading rather than duplicating: a corpus and a gate that hold
// two copies of the same clause drift, and the drift is invisible until a rank
// moves for a reason nobody can find. A clause renamed in `docs/corpus/` breaks
// this import, at parse, in `npm test` -- not the gate at 2am.
//
// What a specimen file may never contain -- no sum of money, no real person --
// is asserted in `specimen-clauses.test.ts` beside this, because "contains no
// real person" is the kind of promise that has to be something CI reads.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export type ClauseSource = 'lease' | 'policy';

export interface SpecimenClause {
  /** The citation, spelled as an answer would cite it. */
  ref: string;
  source: ClauseSource;
  body: string;
}

export interface SpecimenDocument {
  /** File name, so a failure names the file a reader can open. */
  file: string;
  /** The published form this follows, or the note that it follows none. */
  form: string;
  follows: string;
  /** Where that form is published. `—` for the one document that is ours. */
  source: string;
  clauseSource: ClauseSource;
  clauses: readonly SpecimenClause[];
  /**
   * The whole document below the front matter — title, commentary and every clause.
   *
   * The clauses are what a *question* is graded against, and this is what a *file* looks like to
   * something reading it whole. Slice 3.3's verification guard needs the second: the marker terms
   * of a form are printed in its title as often as in its clauses (`חוזה שכירות` appears on the
   * standard lease's first line and in none of its numbered sections), so a guard graded against
   * clause bodies alone would refuse the very document it was seeded from.
   *
   * Added here rather than in a second reader of `docs/corpus/`, because two loaders over one
   * directory is the drift this file exists to prevent.
   */
  text: string;
}

export const CORPUS_DIR = path.join('docs', 'corpus');

// From this file rather than from `process.cwd()`: `npm test`, the evals runner
// and a `node --test` invoked from a subdirectory must all find the same corpus.
const corpusPath = path.resolve(
  import.meta.dirname,
  '..',
  '..',
  'docs',
  'corpus',
);

// A clause is a `###` heading, and the heading *is* the citation. Everything
// until the next heading is the body; prose before the first heading is
// commentary about the file and is deliberately not indexed.
const HEADING = /^###\s+(.+?)\s*$/;

function parseFrontMatter(
  file: string,
  text: string,
): { keys: Record<string, string>; rest: string } {
  const lines = text.split('\n');
  if (lines[0]?.trim() !== '---') {
    throw new Error(`${file}: every specimen needs front matter`);
  }
  const end = lines.indexOf('---', 1);
  if (end === -1) {
    throw new Error(`${file}: front matter is not closed`);
  }
  const keys: Record<string, string> = {};
  for (const line of lines.slice(1, end)) {
    const at = line.indexOf(':');
    if (at === -1) continue;
    keys[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return { keys, rest: lines.slice(end + 1).join('\n') };
}

function required(
  file: string,
  keys: Record<string, string>,
  name: string,
): string {
  const value = keys[name];
  if (!value) throw new Error(`${file}: front matter is missing \`${name}\``);
  return value;
}

function parseDocument(file: string, text: string): SpecimenDocument {
  const { keys, rest } = parseFrontMatter(file, text);
  const clauseSource = required(file, keys, 'clause_source');
  if (clauseSource !== 'lease' && clauseSource !== 'policy') {
    throw new Error(
      `${file}: clause_source is lease or policy, not ${clauseSource}`,
    );
  }

  const clauses: SpecimenClause[] = [];
  let ref: string | undefined;
  let body: string[] = [];
  const flush = (): void => {
    if (!ref) return;
    // Wrapped lines are joined with a space: the files are hard-wrapped for
    // review, and a chunk embedded with its newlines in it is not the chunk a
    // reader sees.
    const joined = body.join(' ').replace(/\s+/g, ' ').trim();
    if (!joined) throw new Error(`${file}: clause ${ref} has no body`);
    clauses.push({ ref, source: clauseSource, body: joined });
  };
  for (const line of rest.split('\n')) {
    const heading = HEADING.exec(line);
    if (heading?.[1]) {
      flush();
      ref = heading[1];
      body = [];
    } else if (ref) {
      body.push(line);
    }
  }
  flush();

  if (clauses.length === 0) {
    throw new Error(
      `${file}: no clauses -- a specimen with no \`###\` heading indexes nothing`,
    );
  }
  return {
    file,
    form: required(file, keys, 'form'),
    follows: required(file, keys, 'follows'),
    source: required(file, keys, 'source'),
    clauseSource,
    clauses,
    text: rest.trim(),
  };
}

function load(): SpecimenDocument[] {
  const files = readdirSync(corpusPath)
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .sort();
  if (files.length === 0) {
    // The same failure mode the grep guards have: a loader that reads no files
    // returns an empty corpus, and an empty corpus grades nothing while looking
    // exactly like a green run.
    throw new Error(`no specimen files under ${CORPUS_DIR}`);
  }
  return files.map((name) =>
    parseDocument(name, readFileSync(path.join(corpusPath, name), 'utf8')),
  );
}

export const specimenDocuments: readonly SpecimenDocument[] = load();

export const specimenClauses: readonly SpecimenClause[] = specimenDocuments
  .flatMap((document) => document.clauses)
  // A duplicate ref would make a citation ambiguous and a rank meaningless --
  // two rows, one name, and no way to say which one won.
  .map((clause, at, all) => {
    if (all.findIndex((other) => other.ref === clause.ref) !== at) {
      throw new Error(`duplicate clause ref across the corpus: ${clause.ref}`);
    }
    return clause;
  });

// The clause references the cases name, so a case and the corpus cannot drift
// apart silently: a rename breaks the import, not the gate at 2am. Checked
// against what was actually loaded, because a constant that names a clause
// nobody wrote is the same lie one file further along.
function ref(value: string): string {
  if (!specimenClauses.some((clause) => clause.ref === value)) {
    throw new Error(`${value} is named by a case and is not in ${CORPUS_DIR}`);
  }
  return value;
}

export const specimenRefs = {
  ownerRepairs: ref('חוזה §7.2'),
  tenantDamage: ref('חוזה §7.5'),
  commonParts: ref('חוזה §7.9'),
  officeHours: ref('נוהל שירות §2'),
  reportFault: ref('נוהל שירות §3'),
} as const;

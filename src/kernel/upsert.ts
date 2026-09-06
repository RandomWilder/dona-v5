// The one fragment that makes an import report a fact about *this* import. Slice 2.4, lifted out of
// src/estate/internal/importer.ts (1.11) when parties, tenancy and register became its second,
// third and fourth callers.
//
// `xmax = 0` on the row an `ON CONFLICT DO UPDATE` returns is true when the row was inserted and
// false when it was updated: a freshly inserted tuple carries no deleting transaction id and the
// update path sets one. It is the only way to tell the two apart in one statement.
//
// It replaced a `count(*)` before and after, which was wrong in a way that looked right: another
// suite, another environment or a developer's own `npm run seed` moves a table count, and CI caught
// two test files racing over one database within the hour (slice 1.11). A count that is not about
// this import is not a fact about it.
//
// A string and not a helper function, because it is a fragment of SQL that has to sit inside a
// RETURNING clause. It is a constant rather than four copies for the reason every constant here is
// one: the copies do not drift because they cannot.
export const INSERTED = '(xmax = 0) AS inserted';

/** What one upsert did: the row's id, and whether this statement is the one that created it. */
export interface UpsertResult {
  id: string;
  inserted: boolean;
}

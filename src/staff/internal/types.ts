import type { Pool, PoolClient } from 'pg';

// The same definition src/scope/, src/estate/, src/parties/, src/tenancy/ and src/evidence/ use.
// Deliberately not imported from any of them: a shared type is not worth a module edge, and the
// edge is what src/kernel/boundary.test.ts polices.
export type Queryable = Pool | PoolClient;

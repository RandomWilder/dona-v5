import type { Pool, PoolClient } from 'pg';

// The same definition src/scope/, src/estate/ and src/parties/ use. Deliberately not imported from
// scope: scope depends on tenancy, and a type import the other way is the first hop of a cycle.
export type Queryable = Pool | PoolClient;

import type { Pool, PoolClient } from 'pg';

// The same definition src/scope/, src/estate/, src/parties/ and src/tenancy/ use. Deliberately not
// imported from any of them: a shared type is not worth a module edge, and the edge is what the
// boundary test polices.
export type Queryable = Pool | PoolClient;

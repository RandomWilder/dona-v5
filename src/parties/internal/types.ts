import type { Pool, PoolClient } from 'pg';

// The same definition src/scope/ and src/estate/ use. Deliberately not imported from either: scope
// depends on parties, and a type import the other way is the first hop of a cycle (1.11's note on
// src/estate/internal/plan.ts, and it holds identically here).
export type Queryable = Pool | PoolClient;

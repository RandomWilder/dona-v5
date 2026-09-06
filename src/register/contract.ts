// The register module's public surface. The composition root and the tests import this file and
// never internal/ (AGENTS.md, and src/kernel/boundary.test.ts proves it from 2.4).

export type { CsvRecord } from './internal/csv.ts';
export { parseCsv } from './internal/csv.ts';
export type {
  RegisterReject,
  RegisterReport,
  RegisterTable,
  TableCount,
} from './internal/importer.ts';
export { importRegister, REGISTER_TABLES } from './internal/importer.ts';
export type { RegisterColumn, RegisterRow } from './internal/row.ts';
export { REGISTER_COLUMNS } from './internal/row.ts';

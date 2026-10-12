// Seeds one building from a building plan file. SPEC-estate.md, "Seeding a building from a developer
// sheet (operator, not a screen)".
//
//   npm run estate:seed -- list  ~/dona-buildings/ramle-103.json            local, writes nothing
//   npm run estate:seed -- apply ~/dona-buildings/ramle-103.json [--update]  local
//   ./infra/estate-seed.sh staging ~/dona-buildings/ramle-103.json [--update] staging, list then y/n
//
// On staging the file arrives as `--plan-b64`, gzipped: it is never stored by the system. Prod is
// refused here, whatever the flags. Output is short on purpose: infra/run-job.sh reads back the
// job's last fifty log lines.

import { readFile } from 'node:fs/promises';
import {
  decodeSeedPayload,
  findSeededBuilding,
  parseEstateSeedArgs,
  readSeedPlan,
  seedBuilding,
  summariseSeedPlan,
} from './estate/contract.ts';
import { createPool } from './kernel/db.ts';
import { refuseUnlessStagingDatabase } from './staging-reset-plan.ts';

let pool: ReturnType<typeof createPool> | undefined;
try {
  const args = parseEstateSeedArgs(process.argv.slice(2));
  refuseUnlessStagingDatabase(process.env.DATABASE_URL, 'estate seed');
  if (process.env.ENV === 'prod') {
    throw new Error('estate seed refuses prod');
  }
  const json =
    args.source.kind === 'file'
      ? JSON.parse(await readFile(args.source.path, 'utf8'))
      : decodeSeedPayload(args.source.data);
  const plan = readSeedPlan(json);
  const building = plan.buildings[0];

  console.log(`estate-seed ${args.mode}${args.update ? ' --update' : ''}`);
  for (const line of summariseSeedPlan(plan)) console.log(`  ${line}`);

  pool = createPool();
  const existing = await findSeededBuilding(pool, building);
  console.log(
    existing === null
      ? '  status    new building'
      : `  status    exists (${existing})${args.update ? ' — --update writes over its facts, removes nothing' : ' — apply is refused without --update'}`,
  );

  if (args.mode === 'list') {
    console.log('estate-seed list — nothing written');
  } else {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await seedBuilding(client, plan, { update: args.update });
      await client.query('COMMIT');
      const { report } = result;
      console.log(
        `  wrote     project ${report.project.created}+${report.project.updated} · building ${report.building.created}+${report.building.updated} · spaces ${report.space.created}+${report.space.updated} · flats ${report.unit.created}+${report.unit.updated}  (created+updated)`,
      );
      const counts = await client.query<{ kind: string; n: string }>(
        `SELECT space_kind AS kind, count(*)::text AS n FROM space
         WHERE building_id = $1 GROUP BY space_kind ORDER BY space_kind`,
        [result.buildingId],
      );
      console.log(
        `  now       ${counts.rows.map((r) => `${r.kind} ${r.n}`).join(' · ')}`,
      );
      console.log(
        `estate-seed apply — committed, building ${result.buildingId}`,
      );
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
} catch (error) {
  console.error(
    `estate-seed failed — ${error instanceof Error ? error.message : 'unknown error'}`,
  );
  process.exitCode = 1;
} finally {
  await pool?.end();
}

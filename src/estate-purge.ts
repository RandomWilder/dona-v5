// Operator purge of a Building or a Unit. Screens have no delete.
//
//   npm run estate:purge -- list --address "הרב קוק" --city "כפר סבא"
//   npm run estate:purge -- apply --building <id>
//
// Staging: ./infra/estate-purge.sh staging list|apply …
// Prod is refused. Apply on the laptop asks y/n unless --yes (the wrapper passes that
// after you confirm). Bytes are a second step: infra/docs-delete.sh on the printed prefixes.

import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import {
  applyEstatePurge,
  listEstatePurge,
  parseEstatePurgeArgs,
  refuseProdDatabase,
} from './estate/contract.ts';
import { createPool } from './kernel/db.ts';

function printTargets(
  targets: Awaited<ReturnType<typeof listEstatePurge>>,
): void {
  if (targets.length === 0) {
    console.log('estate:purge list — no matching Building');
    return;
  }
  for (const target of targets) {
    console.log(
      `${target.addressLine}, ${target.city}  building ${target.buildingId}`,
    );
    console.log(
      `  units ${target.units.length}  documents ${target.documentCount}  tenancies ${target.tenancyCount}  threads ${target.threadCount}`,
    );
    for (const unit of target.units) {
      console.log(`  unit ${unit.unitNumber}  ${unit.unitId}`);
    }
  }
}

async function confirmApply(label: string): Promise<boolean> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = (await rl.question(`Purge ${label}? [y/n] `))
      .trim()
      .toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

let pool: ReturnType<typeof createPool> | undefined;
try {
  const args = parseEstatePurgeArgs(process.argv.slice(2));
  refuseProdDatabase(process.env.DATABASE_URL);
  if (process.env.ENV === 'prod') {
    throw new Error('operator purge refuses prod');
  }

  pool = createPool();
  if (args.mode === 'list') {
    const targets = await listEstatePurge(pool, args.query);
    printTargets(targets);
  } else {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const listed = await listEstatePurge(client, {
        buildingId: args.spec.kind === 'building' ? args.spec.id : undefined,
        unitId: args.spec.kind === 'unit' ? args.spec.id : undefined,
      });
      printTargets(listed);
      if (listed.length === 0) {
        await client.query('ROLLBACK');
        process.exitCode = 1;
        console.error('estate:purge apply — nothing matched');
      } else {
        const label =
          args.spec.kind === 'building'
            ? `Building ${listed[0]?.addressLine}`
            : `Unit ${listed[0]?.units[0]?.unitNumber} at ${listed[0]?.addressLine}`;
        const ok = args.yes ? true : await confirmApply(label ?? args.spec.id);
        if (!ok) {
          await client.query('ROLLBACK');
          console.log('estate:purge — aborted');
        } else {
          const report = await applyEstatePurge(client, args.spec);
          await client.query('COMMIT');
          console.log(
            `estate:purge apply — documents ${report.documentCount} units ${report.unitCount} tenancies ${report.tenancyCount} parties ${report.partyCount} threads ${report.threadCount}`,
          );
          if (report.objectPrefixes.length === 0) {
            console.log('  no object prefixes');
          } else {
            console.log('  object prefixes for infra/docs-delete.sh:');
            for (const prefix of report.objectPrefixes) {
              console.log(`    ${prefix}`);
            }
          }
        }
      }
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
} catch (error) {
  console.error(
    `estate:purge failed — ${error instanceof Error ? error.message : 'unknown error'}`,
  );
  process.exitCode = 1;
} finally {
  await pool?.end();
}

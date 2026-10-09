import type { PrismaClient } from '../../src/generated/prisma/client.js';

// Both the real initializer and live refusal tests use this gate. The caller
// must validate the dedicated URL before constructing a client; this function
// also accepts a transaction on that same guarded disposable connection.
export async function initializeConstraintDatabase(
  db: Pick<PrismaClient, '$queryRaw'>,
  initialize: () => Promise<void>,
): Promise<void> {
  const identity = await db.$queryRaw<{ database: string; role: string }[]>`
    SELECT current_database() AS database, current_user AS role
  `.catch(() => {
    throw new Error('Constraint-test identity query failed.');
  });
  if (
    identity[0]?.database !== 'lessonforge_constraints_test' ||
    identity[0]?.role !== 'lessonforge_constraints'
  )
    throw new Error('Disposable database identity does not match.');

  const objects = await db.$queryRaw<{ count: bigint }[]>`
    SELECT (
      (SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace) +
      (SELECT count(*) FROM pg_type WHERE typnamespace = 'public'::regnamespace) +
      (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace)
    ) AS count
  `.catch(() => {
    throw new Error('Constraint-test schema query failed.');
  });
  if (objects[0]?.count !== 0n)
    throw new Error('Disposable database public schema must be empty.');

  // Never reset/drop/truncate or run migration/fixture writes before both checks.
  await initialize();
}

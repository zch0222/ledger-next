// Usage: LEDGER_ROLLBACK_CONFIRM=<file> pnpm db:rollback <file>
// Reverts only the most recently applied migration, using migrations/down/<file>, and only while the tables it lists
// under "requires-empty" hold no rows. It never deletes recorded data; with data, restore from backup instead.
import { readFile } from 'node:fs/promises';
import { databasePool } from './index';
import { statements } from './migrate-files';
import type { RowDataPacket } from 'mysql2';

const name = process.argv[2];
if (!name || process.env.LEDGER_ROLLBACK_CONFIRM !== name) {
  throw new Error('Set LEDGER_ROLLBACK_CONFIRM to the migration file name to confirm the rollback');
}
const pool = databasePool();
const connection = await pool.getConnection();
try {
  const [lock] = await connection.query<RowDataPacket[]>("SELECT GET_LOCK('ledger_migrations', 60) AS acquired");
  if (Number(lock[0].acquired) !== 1) throw new Error('Migration lock unavailable');
  const [latest] = await connection.query<RowDataPacket[]>(
    'SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1',
  );
  if (latest[0]?.name !== name) {
    throw new Error(`Only the latest applied migration can be rolled back (latest: ${latest[0]?.name ?? 'none'})`);
  }
  const sql = await readFile(new URL(`../migrations/down/${name}`, import.meta.url), 'utf8');
  const guarded = /--\s*requires-empty:\s*(.+)/.exec(sql)?.[1].trim().split(/\s+/) ?? [];
  for (const table of guarded) {
    const [exists] = await connection.query<RowDataPacket[]>(
      'SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
      [table],
    );
    if (!Number(exists[0].n)) continue;
    const [rows] = await connection.query<RowDataPacket[]>(`SELECT EXISTS(SELECT 1 FROM \`${table}\`) AS used`);
    if (Number(rows[0].used)) {
      throw new Error(`Refusing to roll back ${name}: ${table} contains data. Restore from backup instead.`);
    }
  }
  for (const statement of statements(sql)) await connection.query(statement);
  await connection.execute('DELETE FROM schema_migrations WHERE name = ?', [name]);
  console.log(`Rolled back ${name}`);
} finally {
  await connection.query("SELECT RELEASE_LOCK('ledger_migrations')");
  connection.release();
  await pool.end();
}

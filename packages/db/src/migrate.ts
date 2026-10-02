import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { databasePool } from './index';
import type { RowDataPacket } from 'mysql2';

const pool = databasePool();
const connection = await pool.getConnection();
try {
  const [lock] = await connection.query<RowDataPacket[]>("SELECT GET_LOCK('ledger_migrations', 60) AS acquired");
  if (Number(lock[0].acquired) !== 1) throw new Error('Migration lock unavailable');
  await connection.query('CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(255) PRIMARY KEY, checksum CHAR(64) NOT NULL, applied_at DATETIME(3) NOT NULL) ENGINE=InnoDB');
  const folder = new URL('../migrations/', import.meta.url);
  for (const file of (await readdir(folder)).filter(f => f.endsWith('.sql')).sort()) {
    const sql = await readFile(new URL(file, folder), 'utf8');
    const hash = createHash('sha256').update(sql).digest('hex');
    const [previous] = await connection.execute<RowDataPacket[]>('SELECT checksum FROM schema_migrations WHERE name = ?', [file]);
    if (previous.length) {
      if (previous[0].checksum !== hash) throw new Error(`Applied migration changed: ${file}`);
      continue;
    }
    // MySQL DDL implicitly commits. Initial CREATEs are restart-safe; future ALTERs need explicit recovery instructions.
    for (const statement of sql.split('--> statement-breakpoint').filter(s => s.trim())) await connection.query(statement);
    await connection.execute('INSERT INTO schema_migrations VALUES (?, ?, UTC_TIMESTAMP(3))', [file, hash]);
    console.log(`Applied ${file}`);
  }
  console.log('MySQL migrations up to date');
} finally {
  await connection.query("SELECT RELEASE_LOCK('ledger_migrations')");
  connection.release();
  await pool.end();
}

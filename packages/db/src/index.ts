import mysql from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';
import * as schema from './schema';

// Lazy creation lets Next build route metadata without database access or build-time secrets.
let connection: ReturnType<typeof create> | undefined;
function create() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const pool = mysql.createPool({ uri: url, timezone: 'Z', connectionLimit: 10, decimalNumbers: false });
  return { pool, db: drizzle(pool, { schema, mode: 'default' }) };
}
export function database() { return (connection ??= create()).db; }
/** The pool-level database or a transaction; domain writes accept either so callers can compose transactions. */
export type Executor = Omit<ReturnType<typeof database>, '$client'>;
export function databasePool() { return (connection ??= create()).pool; }

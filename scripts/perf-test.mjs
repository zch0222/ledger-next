import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// M7-PERF: `pnpm test:perf` builds the production images, seeds 1,000 users and a 100k-transaction ledger, runs the
// mixed load and the browser measurements, collects MySQL statement statistics, writes test-results/perf/, and removes
// everything it created. Sizes and duration come from PERF_* (see compose.perf.yaml).
const docker = process.env.LEDGER_DOCKER || 'docker';
const env = {
  ...process.env,
  MYSQL_DATABASE: 'ledger_perf',
  MYSQL_USER: 'ledger_perf',
  MYSQL_PASSWORD: randomBytes(24).toString('hex'),
  MYSQL_ROOT_PASSWORD: randomBytes(24).toString('hex'),
  BETTER_AUTH_SECRET: randomBytes(48).toString('hex'),
  LEDGER_ENCRYPTION_KEYS: `perf:${randomBytes(32).toString('base64')}`,
  APP_URL: 'http://web:3000',
};
const project = `ledger-perf-${process.pid}-${randomBytes(3).toString('hex')}`;
// An empty env file: the stack gets only the values set here, never the tuning in a developer's .env.
const emptyEnv = path.join(mkdtempSync(path.join(tmpdir(), 'ledger-perf-')), 'empty.env');
writeFileSync(emptyEnv, '');
const args = [
  'compose',
  '-p',
  project,
  '--env-file',
  emptyEnv,
  '-f',
  'compose.yaml',
  '-f',
  'compose.mock.yaml',
  '-f',
  'compose.perf.yaml',
];
if (process.env.LEDGER_BUILD_CA) {
  const overlay = path.join(mkdtempSync(path.join(tmpdir(), 'ledger-perf-')), 'compose.build-ca.tests.yaml');
  writeFileSync(
    overlay,
    'services:\n  tests: { build: { secrets: [build_ca] } }\n  mock-services: { build: { secrets: [build_ca] } }\n',
  );
  args.push('-f', 'compose.build-ca.yaml', '-f', overlay);
}
const run = params => {
  const r = spawnSync(docker, params, { env, stdio: 'inherit' });
  if (r.error) throw r.error;
  return r.status ?? 1;
};
const capture = params => spawnSync(docker, params, { env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const out = 'test-results/perf';
mkdirSync(out, { recursive: true });
const sql = query => {
  const r = capture([
    ...args,
    'exec',
    '-T',
    '-e',
    `MYSQL_PWD=${env.MYSQL_ROOT_PASSWORD}`,
    'mysql',
    'mysql',
    '-uroot',
    '--batch',
    '-e',
    query,
  ]);
  if (r.status !== 0) throw new Error(`MySQL query failed: ${r.stderr}`);
  const [header, ...rows] = r.stdout
    .trim()
    .split('\n')
    .map(l => l.split('\t'));
  return rows.map(row => Object.fromEntries(header.map((h, i) => [h, row[i]])));
};
let status = 1;
try {
  if (run([...args, 'build']) !== 0) throw new Error('build failed');
  if (run([...args, 'up', '-d', '--wait', '--quiet-pull', 'web', 'worker']) !== 0)
    throw new Error('services not healthy');
  const tsx = script => [...args, 'run', '--rm', '--no-deps', 'tests', 'node', '--import', 'tsx', script];
  if (run(tsx('tests/perf/seed.ts')) !== 0) throw new Error('seed failed');
  sql('TRUNCATE performance_schema.events_statements_summary_by_digest');
  if (run(tsx('tests/perf/load.ts')) !== 0) throw new Error('load failed');
  const digests =
    sql(`SELECT LEFT(DIGEST_TEXT, 160) AS statement, COUNT_STAR AS calls, ROUND(AVG_TIMER_WAIT / 1e9, 2) AS avg_ms, ROUND(MAX_TIMER_WAIT / 1e9, 1) AS max_ms,
    ROUND(SUM_TIMER_WAIT / 1e12, 1) AS total_s, ROUND(SUM_ROWS_EXAMINED / GREATEST(COUNT_STAR, 1)) AS rows_examined
    FROM performance_schema.events_statements_summary_by_digest WHERE SCHEMA_NAME = '${env.MYSQL_DATABASE}' ORDER BY SUM_TIMER_WAIT DESC LIMIT 15`);
  if (run(tsx('tests/perf/vitals.ts')) !== 0) throw new Error('vitals failed');
  // Backup / restore at this size (M7-OPS RTO scaling): full logical dump, then load it into a scratch schema.
  const timed = command => {
    const started = Date.now();
    const r = capture([
      ...args,
      'exec',
      '-T',
      '-e',
      `MYSQL_PWD=${env.MYSQL_ROOT_PASSWORD}`,
      'mysql',
      'sh',
      '-c',
      command,
    ]);
    if (r.status !== 0) throw new Error(r.stderr);
    return { seconds: (Date.now() - started) / 1000, out: r.stdout.trim() };
  };
  const dumped = timed(
    `mysqldump -uroot --single-transaction --routines --triggers --set-gtid-purged=OFF ${env.MYSQL_DATABASE} > /tmp/perf.sql && wc -c < /tmp/perf.sql`,
  );
  const restored = timed(
    `mysql -uroot -e 'CREATE DATABASE restore_probe' && mysql -uroot restore_probe < /tmp/perf.sql && mysql -uroot -N -e 'SELECT COUNT(*) FROM restore_probe.transactions'`,
  );
  writeFileSync(
    `${out}/backup.json`,
    `${JSON.stringify({ dumpSeconds: dumped.seconds, dumpBytes: Number(dumped.out), restoreSeconds: restored.seconds, restoredTransactions: Number(restored.out) }, null, 2)}\n`,
  );
  const stats = capture(['stats', '--no-stream', '--format', '{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}'])
    .stdout.split('\n')
    .filter(l => l.startsWith(project));
  const host = {
    cpus: capture(['info', '--format', '{{.NCPU}}']).stdout.trim(),
    memory: capture(['info', '--format', '{{.MemTotal}}']).stdout.trim(),
    server: capture(['info', '--format', '{{.ServerVersion}}']).stdout.trim(),
    kernel: capture(['info', '--format', '{{.KernelVersion}}']).stdout.trim(),
  };
  const versions = sql('SELECT VERSION() AS mysql')[0];
  writeFileSync(
    `${out}/environment.json`,
    `${JSON.stringify({ host, versions, containers: stats, note: 'load generator, browser and services share the same host' }, null, 2)}\n`,
  );
  writeFileSync(`${out}/sql.json`, `${JSON.stringify(digests, null, 2)}\n`);
  const load = JSON.parse(readFileSync(`${out}/load.json`, 'utf8')),
    vitals = JSON.parse(readFileSync(`${out}/vitals.json`, 'utf8'));
  console.log(
    JSON.stringify(
      {
        mixed: load.mixed.ops,
        aggregation: load.aggregation12m,
        dashboard: load.dashboardTtfb,
        reminders: load.reminders,
        fx: load.fx,
        vitals: vitals.pages,
        charts: vitals.charts,
      },
      null,
      1,
    ),
  );
  status = 0;
} catch (error) {
  run([...args, 'logs', '--no-color', '--tail', '80', 'web', 'worker']);
  console.error(error instanceof Error ? error.message : error);
} finally {
  run([...args, 'down', '--volumes', '--remove-orphans', '--rmi', 'local']);
}
process.exitCode = status;

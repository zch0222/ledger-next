import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// M7-OPS (`pnpm test:ops`): backup, disaster and restore in an isolated Compose project, with reconciliation.
//   1. seed a ledger; full logical backup (mysqldump --single-transaction) of the primary
//   2. start a streaming standby (MySQL replication from a consistent dump)
//   3. a reminder falls due while the web process is stopped: the worker alone must deliver it
//   4. more writes after the backup; wait for the standby to catch up
//   5. disaster: the primary and its volume are destroyed
//   6. restore A from the backup → reconcile with the backup snapshot (later writes are the dump-only RPO)
//   7. restore B from the standby → reconcile with the latest snapshot (RPO 0 transactions)
// RTO is measured from "empty server started" to "web ready". Results: test-results/ops/drill.json.
const docker = process.env.LEDGER_DOCKER || 'docker';
const env = { ...process.env, MYSQL_DATABASE: 'ledger_ops', MYSQL_USER: 'ledger_ops', MYSQL_PASSWORD: randomBytes(24).toString('hex'), MYSQL_ROOT_PASSWORD: randomBytes(24).toString('hex'), BETTER_AUTH_SECRET: randomBytes(48).toString('hex'), LEDGER_ENCRYPTION_KEYS: `ops:${randomBytes(32).toString('base64')}`, APP_URL: 'http://web:3000' };
const project = `ledger-ops-${process.pid}`;
const args = ['compose', '-p', project, '-f', 'compose.yaml', '-f', 'compose.mock.yaml', '-f', 'compose.ops.yaml'];
if (process.env.LEDGER_BUILD_CA) {
  const overlay = path.join(mkdtempSync(path.join(tmpdir(), 'ledger-ops-')), 'compose.build-ca.tests.yaml');
  writeFileSync(overlay, 'services:\n  tests: { build: { secrets: [build_ca] } }\n  mock-services: { build: { secrets: [build_ca] } }\n');
  args.push('-f', 'compose.build-ca.yaml', '-f', overlay);
}
const out = 'test-results/ops', backupFile = path.join(mkdtempSync(path.join(tmpdir(), 'ledger-backup-')), 'full.sql');
mkdirSync(out, { recursive: true });
const compose = args.map(a => `'${a}'`).join(' ');
const run = params => { const r = spawnSync(docker, params, { env, stdio: 'inherit' }); if (r.error) throw r.error; return r.status ?? 1; };
const must = (params, what) => { if (run(params) !== 0) throw new Error(what); };
const shell = (command, what) => { const r = spawnSync('sh', ['-c', command], { env, stdio: ['ignore', 'inherit', 'inherit'] }); if (r.status !== 0) throw new Error(what); };
const capture = params => { const r = spawnSync(docker, params, { env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }); if (r.status !== 0) throw new Error(r.stderr); return r.stdout; };
const sql = (service, query) => capture([...args, 'exec', '-T', '-e', `MYSQL_PWD=${env.MYSQL_ROOT_PASSWORD}`, service, 'mysql', '-uroot', '--batch', '-N', '-e', query]).trim();
const drill = (...step) => { const r = spawnSync(docker, [...args, 'run', '--rm', '--no-deps', 'tests', 'node', '--import', 'tsx', 'tests/ops/drill.ts', ...step], { env, encoding: 'utf8' }); process.stderr.write(r.stderr); if (r.status !== 0) throw new Error(`drill ${step.join(' ')} failed: ${r.stdout}`); return JSON.parse(r.stdout.trim().split('\n').at(-1)); };
const dump = (service, extra = '') => `${docker} ${compose} exec -T -e MYSQL_PWD=${env.MYSQL_ROOT_PASSWORD} ${service} mysqldump -uroot --single-transaction --routines --triggers --events --set-gtid-purged=OFF ${extra} --databases ${env.MYSQL_DATABASE}`;
const load = (service, from) => `${from} | ${docker} ${compose} exec -T -e MYSQL_PWD=${env.MYSQL_ROOT_PASSWORD} ${service} mysql -uroot`;
const seconds = start => Number(((Date.now() - start) / 1000).toFixed(1));
const result = { at: new Date().toISOString(), steps: {} };
let status = 1;

async function destroyPrimary() {
  must([...args, 'stop', 'web', 'worker'], 'stop app');
  must([...args, 'rm', '-sf', 'mysql'], 'remove primary');
  must(['volume', 'rm', `${project}_mysql-data`], 'remove primary volume');
}
async function restore(fromCommand) {
  const started = Date.now();
  must([...args, 'up', '-d', '--wait', 'mysql'], 'fresh primary');
  shell(load('mysql', fromCommand), 'load backup');
  // Caches and queue state in Redis describe the lost timeline: clear them, MySQL is the source of truth.
  must([...args, 'exec', '-T', 'redis', 'redis-cli', 'FLUSHALL'], 'flush redis');
  must([...args, 'up', '-d', '--wait', 'web', 'worker'], 'app after restore');
  return seconds(started);
}

try {
  must([...args, 'build'], 'build');
  must([...args, 'up', '-d', '--wait', '--quiet-pull', 'web', 'worker'], 'services');
  result.steps.seed = drill('seed');

  let started = Date.now();
  shell(`${dump('mysql', '--source-data=2')} > '${backupFile}'`, 'full backup');
  const sha = createHash('sha256').update(readFileSync(backupFile)).digest('hex');
  result.steps.backup = { seconds: seconds(started), bytes: statSync(backupFile).size, sha256: sha, position: /CHANGE REPLICATION SOURCE TO SOURCE_LOG_FILE='([^']+)', SOURCE_LOG_POS=(\d+)/.exec(readFileSync(backupFile, 'utf8'))?.slice(1) ?? null };

  // Streaming standby, started from its own consistent dump at a known binlog position.
  const replPassword = randomBytes(16).toString('hex');
  sql('mysql', `CREATE USER 'repl'@'%' IDENTIFIED BY '${replPassword}'; GRANT REPLICATION SLAVE ON *.* TO 'repl'@'%';`);
  must([...args, 'up', '-d', '--wait', 'mysql-replica'], 'standby');
  const standbyDump = path.join(path.dirname(backupFile), 'standby.sql');
  shell(`${dump('mysql', '--source-data=2')} > '${standbyDump}'`, 'standby snapshot');
  const [logFile, logPos] = /CHANGE REPLICATION SOURCE TO SOURCE_LOG_FILE='([^']+)', SOURCE_LOG_POS=(\d+)/.exec(readFileSync(standbyDump, 'utf8')).slice(1);
  shell(load('mysql-replica', `cat '${standbyDump}'`), 'seed standby');
  // Host, credentials and position in one statement: changing SOURCE_HOST alone resets the position.
  sql('mysql-replica', `CHANGE REPLICATION SOURCE TO SOURCE_HOST='mysql', SOURCE_USER='repl', SOURCE_PASSWORD='${replPassword}', GET_SOURCE_PUBLIC_KEY=1, SOURCE_LOG_FILE='${logFile}', SOURCE_LOG_POS=${logPos}; START REPLICA;`);

  // The worker does not need the web process: stop web, let a reminder fall due, check it was sent.
  result.steps.reminder = drill('reminder');
  must([...args, 'stop', 'web'], 'stop web');
  started = Date.now();
  result.steps.workerWithoutWeb = { ...drill('delivered'), seconds: seconds(started) };
  must([...args, 'up', '-d', '--wait', 'web'], 'start web');

  result.steps.more = drill('more');
  const primaryCount = sql('mysql', `SELECT COUNT(*) FROM ${env.MYSQL_DATABASE}.transactions`);
  started = Date.now();
  let lag = '';
  for (let i = 0; i < 60; i++) {
    lag = sql('mysql-replica', `SELECT COUNT(*) FROM ${env.MYSQL_DATABASE}.transactions`);
    if (lag === primaryCount) break;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  if (lag !== primaryCount) throw new Error(`standby did not catch up: ${lag} vs ${primaryCount}`);
  const applier = sql('mysql-replica', 'SELECT SERVICE_STATE FROM performance_schema.replication_applier_status');
  if (applier !== 'ON') throw new Error(`standby applier is ${applier}`);
  result.steps.standby = { caughtUpSeconds: seconds(started), transactions: Number(primaryCount), applier };

  // Disaster, then restore A (backup only) and restore B (standby).
  await destroyPrimary();
  result.steps.restoreFromBackup = { rtoSeconds: await restore(`cat '${backupFile}'`), verify: drill('verify', 'backup') };
  const backup = result.steps.seed, latest = result.steps.more;
  result.steps.restoreFromBackup.lostTransactions = latest.transactions - backup.transactions;
  result.steps.restoreFromBackup.lostWindowSeconds = Number(((Date.parse(latest.at) - Date.parse(backup.at)) / 1000).toFixed(1));
  await destroyPrimary();
  sql('mysql-replica', 'STOP REPLICA;');
  result.steps.restoreFromStandby = { rtoSeconds: await restore(dump('mysql-replica')), verify: drill('verify', 'latest'), lostTransactions: 0 };
  writeFileSync(`${out}/drill.json`, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 1));
  status = 0;
} catch (error) {
  run([...args, 'logs', '--no-color', '--tail', '60', 'web', 'worker', 'mysql', 'mysql-replica']);
  console.error(error instanceof Error ? error.message : error);
  writeFileSync(`${out}/drill.json`, `${JSON.stringify({ ...result, error: String(error) }, null, 2)}\n`);
} finally {
  run([...args, 'down', '--volumes', '--remove-orphans', '--rmi', 'local']);
}
process.exitCode = status;

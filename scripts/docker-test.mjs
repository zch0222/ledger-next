import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const localDesktop = path.join(process.env.LOCALAPPDATA ?? '', 'Programs/DockerDesktop/resources/bin/docker.exe');
const docker = process.env.LEDGER_DOCKER || (process.platform === 'win32' && existsSync(localDesktop) ? localDesktop : 'docker');
const env = { ...process.env, MYSQL_DATABASE: 'ledger_test', MYSQL_USER: 'ledger_test', MYSQL_PASSWORD: randomBytes(24).toString('hex'), MYSQL_ROOT_PASSWORD: randomBytes(24).toString('hex'), BETTER_AUTH_SECRET: randomBytes(48).toString('hex'), LEDGER_ENCRYPTION_KEYS: `e2e:${randomBytes(32).toString('base64')}`, APP_URL: 'http://web:3000', PERSISTENCE_EMAIL: `restart-${randomBytes(12).toString('hex')}@example.test`, PERSISTENCE_PASSWORD: randomBytes(24).toString('hex') };
// Each run owns its Compose project and volumes; never remove a user's development database. The random part keeps
// names unique inside the toolbox container, where the process id is the same on every run.
const project = `ledger-e2e-${process.pid}-${randomBytes(3).toString('hex')}`;
const LATEST_MIGRATION = readdirSync('packages/db/migrations').filter(f => f.endsWith('.sql')).sort().at(-1);
const args = ['compose', '-p', project, '-f', 'compose.yaml', '-f', 'compose.mock.yaml', '-f', 'compose.test.yaml'];
mkdirSync('test-results', { recursive: true }); mkdirSync('playwright-report', { recursive: true });
// Behind a TLS-intercepting proxy, LEDGER_BUILD_CA names a CA bundle trusted only while installing packages.
if (process.env.LEDGER_BUILD_CA) {
  // Outside test-results/: Playwright empties that folder when it starts.
  const overlay = path.join(mkdtempSync(path.join(tmpdir(), 'ledger-e2e-')), 'compose.build-ca.tests.yaml');
  writeFileSync(overlay, 'services:\n  tests: { build: { secrets: [build_ca] } }\n  mock-services: { build: { secrets: [build_ca] } }\n');
  args.push('-f', 'compose.build-ca.yaml', '-f', overlay);
}
function run(params) {
  const result = spawnSync(docker, params, { env, stdio: 'inherit' });
  if (result.error) throw result.error;
  return result.status ?? 1;
}
const context = spawnSync(docker, ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'], { env, encoding: 'utf8' });
const endpoint = process.env.DOCKER_HOST || context.stdout?.trim();
if (context.status !== 0 || !/^(npipe:\/\/|unix:\/\/|tcp:\/\/(127\.0\.0\.1|localhost):)/.test(endpoint ?? '')) throw new Error('E2E requires a local Docker engine');
let status = 1;
try {
  if (run([...args, 'build']) !== 0) throw new Error('Docker build failed');
  if (run([...args, 'up', '-d', '--wait', '--quiet-pull', 'web', 'worker']) !== 0) throw new Error('Docker services did not become healthy');
  // Recovery drill: the latest migration rolls back while its tables are empty, then re-applies cleanly.
  const rollback = ['run', '--rm', '--no-deps', '-e', `LEDGER_ROLLBACK_CONFIRM=${LATEST_MIGRATION}`, 'migrate', 'node', '--import', 'tsx', 'packages/db/src/rollback.ts', LATEST_MIGRATION];
  if (run([...args, ...rollback]) !== 0) throw new Error('Rollback of an empty migration failed');
  if (run([...args, 'run', '--rm', '--no-deps', 'migrate']) !== 0) throw new Error('Migration replay failed');
  if (run([...args, 'run', '--rm', '--no-deps', 'tests', 'node', 'tests/persistence.mjs', 'seed']) !== 0) throw new Error('Persistence setup failed');
  if (run([...args, 'restart', 'mysql', 'redis', 'web', 'worker']) !== 0) throw new Error('Container restart failed');
  if (run([...args, 'up', '-d', '--wait', '--quiet-pull', 'web', 'worker']) !== 0) throw new Error('Services did not recover');
  if (run([...args, 'run', '--rm', '--no-deps', 'tests', 'node', 'tests/persistence.mjs', 'verify']) !== 0) throw new Error('Restart persistence check failed');
  if (run([...args, 'run', '--rm', '--no-deps', 'tests', 'node_modules/.bin/vitest', 'run', '--config', 'vitest.integration.config.ts']) !== 0) throw new Error('MySQL integration tests failed');
  // With ledger rows present the rollback must refuse instead of dropping data.
  const refused = spawnSync(docker, [...args, ...rollback], { env, encoding: 'utf8' });
  if (refused.status === 0 || !/contains data/.test(refused.stderr)) throw new Error(`Rollback with data was not refused: ${refused.stderr.slice(-300)}`);
  console.log('Rollback with ledger data refused as expected');
  // Reminder chaos drill (M5-CHAOS): SIGKILL the worker mid-request and restart Redis, keep it down while more
  // deliveries fall due, then check nothing is lost, nothing is sent twice and nothing expired is sent late.
  const chaos = ['run', '--rm', '--no-deps', 'tests', 'node', '--import', 'tsx', 'tests/chaos/notify-restart.ts'];
  if (run([...args, ...chaos, 'prepare']) !== 0) throw new Error('Chaos drill setup failed');
  if (run([...args, 'kill', '-s', 'SIGKILL', 'worker']) !== 0 || run([...args, 'restart', 'redis']) !== 0) throw new Error('Chaos drill could not stop the worker');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15_000); // outage
  if (run([...args, 'up', '-d', '--wait', 'worker']) !== 0) throw new Error('Worker did not recover after the chaos drill');
  if (run([...args, ...chaos, 'verify']) !== 0) throw new Error('Chaos drill verification failed');
  status = run([...args, 'run', '--rm', '--no-deps', 'tests']);
  if (status !== 0) run([...args, 'logs', '--no-color', '--tail', '100', 'web', 'worker', 'migrate']);
  // M7-SEC log redaction: after every suite has run, web and worker logs must not contain credentials or the
  // amounts / notes / merchants the tests wrote (they log ids, codes and request ids only).
  const logs = spawnSync(docker, [...args, 'logs', '--no-color', 'web', 'worker'], { env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const leaks = [[/lnp_[A-Za-z0-9_-]{43}/, 'personal access token'], [/Ledger-test-only-2026!/, 'test password'], [/\b\d{9}:[A-Za-z0-9_-]{24,}/, 'Telegram bot token'],
    [/Bearer\s+[A-Za-z0-9._-]{20,}/, 'Authorization header'], [/忽略之前的|秘密商户|onerror=alert/, 'note or merchant text'], [/mock-fixer-key|smtp:\/\/[^\s]*:[^\s]*@/, 'provider secret']]
    .filter(([pattern]) => pattern.test(`${logs.stdout}${logs.stderr}`)).map(([, what]) => what);
  if (logs.status !== 0) throw new Error('Could not read service logs for the redaction check');
  if (leaks.length) { status = 1; console.error(`Service logs leak: ${leaks.join(', ')}`); } else console.log(`PASS: web / worker logs (${(logs.stdout.length / 1024).toFixed(0)} KiB) contain no credentials, notes or merchants`);
  // Graceful shutdown on SIGTERM. Next drains connections, then exits 143 by design; the worker exits 0.
  // 137 would mean Docker had to SIGKILL after the stop timeout.
  if (run([...args, 'stop', 'web', 'worker']) !== 0) throw new Error('Services did not stop');
  for (const [service, accepted] of [['web', ['0', '143']], ['worker', ['0']]]) {
    const id = spawnSync(docker, [...args, 'ps', '-a', '-q', service], { env, encoding: 'utf8' }).stdout.trim();
    const code = spawnSync(docker, ['inspect', '-f', '{{.State.ExitCode}}', id], { env, encoding: 'utf8' }).stdout.trim();
    console.log(`${service} stopped with exit code ${code}`);
    if (!accepted.includes(code)) { status = 1; console.error(`${service} did not shut down gracefully`); }
  }
} catch (error) {
  status = 1; // a failure after the Playwright run (e.g. shutdown) must still fail the command
  run([...args, 'logs', '--no-color', '--tail', '60', 'web', 'worker', 'migrate']);
  console.error(error instanceof Error ? error.message : 'Docker verification failed');
} finally {
  // Removes this run's containers, volumes and the images it built, so repeated runs do not fill the disk.
  run([...args, 'down', '--volumes', '--remove-orphans', '--rmi', 'local']);
}
process.exitCode = status;

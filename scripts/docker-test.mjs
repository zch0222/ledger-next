import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';

const localDesktop = path.join(process.env.LOCALAPPDATA ?? '', 'Programs/DockerDesktop/resources/bin/docker.exe');
const docker = process.env.LEDGER_DOCKER || (process.platform === 'win32' && existsSync(localDesktop) ? localDesktop : 'docker');
const env = { ...process.env, MYSQL_DATABASE: 'ledger_test', MYSQL_USER: 'ledger_test', MYSQL_PASSWORD: randomBytes(24).toString('hex'), MYSQL_ROOT_PASSWORD: randomBytes(24).toString('hex'), BETTER_AUTH_SECRET: randomBytes(48).toString('hex'), APP_URL: 'http://web:3000', PERSISTENCE_EMAIL: `restart-${randomBytes(12).toString('hex')}@example.test`, PERSISTENCE_PASSWORD: randomBytes(24).toString('hex') };
// Each run owns its Compose project and volumes; never remove a user's development database.
const project = `ledger-e2e-${process.pid}`;
const LATEST_MIGRATION = readdirSync('packages/db/migrations').filter(f => f.endsWith('.sql')).sort().at(-1);
const args = ['compose', '-p', project, '-f', 'compose.yaml', '-f', 'compose.test.yaml'];
function run(params) {
  const result = spawnSync(docker, params, { env, stdio: 'inherit' });
  if (result.error) throw result.error;
  return result.status ?? 1;
}
const context = spawnSync(docker, ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'], { env, encoding: 'utf8' });
const endpoint = process.env.DOCKER_HOST || context.stdout?.trim();
if (context.status !== 0 || !/^(npipe:\/\/|unix:\/\/|tcp:\/\/(127\.0\.0\.1|localhost):)/.test(endpoint ?? '')) throw new Error('E2E requires a local Docker engine');
mkdirSync('test-results', { recursive: true }); mkdirSync('playwright-report', { recursive: true });
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
  status = run([...args, 'run', '--rm', '--no-deps', 'tests']);
  if (status !== 0) run([...args, 'logs', '--no-color', '--tail', '100', 'web', 'worker', 'migrate']);
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
  run([...args, 'logs', '--no-color', '--tail', '60', 'web', 'worker', 'migrate']);
  console.error(error instanceof Error ? error.message : 'Docker verification failed');
} finally {
  run([...args, 'down', '--volumes', '--remove-orphans']);
}
process.exitCode = status;

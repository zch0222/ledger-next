import cluster from 'node:cluster';
import { availableParallelism } from 'node:os';

// Runs WEB_CONCURRENCY copies of the standalone Next server sharing one port (default: one per CPU, at most 4).
// No request state lives in a process: sessions, caches, rate limits and jobs are in MySQL / Redis.
const workers = Math.max(1, Number(process.env.WEB_CONCURRENCY) || Math.min(availableParallelism(), 4));
if (workers === 1 || !cluster.isPrimary) {
  await import('./server.js');
} else {
  let stopping = false;
  let alive = 0;
  const fork = () => {
    alive++;
    cluster.fork();
  };
  for (let i = 0; i < workers; i++) fork();
  cluster.on('exit', (worker, code, signal) => {
    alive--;
    if (stopping) {
      if (alive === 0) process.exit(0);
      return;
    }
    console.error(
      JSON.stringify({ task: 'web.process-exit', pid: worker.process.pid, code, signal, action: 'restart' }),
    );
    fork();
  });
  // Graceful stop: every server drains its connections, then the primary exits.
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
      stopping = true;
      for (const worker of Object.values(cluster.workers ?? {})) worker?.process.kill(signal);
    });
  }
}

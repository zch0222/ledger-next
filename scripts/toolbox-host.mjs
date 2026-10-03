import { execFileSync } from 'node:child_process';
import { hostname } from 'node:os';

// Preloaded (`node --import`) by the e2e / perf / ops services of compose.tools.yaml. Their nested stacks bind-mount
// test-results/ and playwright-report/, and the engine resolves bind paths on its own side, so the overlays use
// LEDGER_HOST_DIR: the engine's path of the checkout mounted at /work, read from this container's own mounts.
if (!process.env.LEDGER_HOST_DIR) {
  const format = `{{range .Mounts}}{{if eq .Destination "${process.cwd()}"}}{{.Source}}{{end}}{{end}}`;
  const source = execFileSync('docker', ['inspect', '--format', format, hostname()], { encoding: 'utf8' }).trim();
  if (!source)
    throw new Error(
      `No host path is mounted at ${process.cwd()}; set LEDGER_HOST_DIR to the checkout's path on the Docker engine`,
    );
  // Docker Desktop for Windows reports the Windows path (D:\code\ledger-next); its engine sees drives under /run/desktop/mnt/host.
  const drive = /^([A-Za-z]):[\\/]?(.*)$/.exec(source);
  process.env.LEDGER_HOST_DIR = drive
    ? `/run/desktop/mnt/host/${drive[1].toLowerCase()}/${drive[2].replaceAll('\\', '/')}`
    : source;
}

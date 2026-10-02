// pnpm contract:generate — write openapi.json and the SDK types.
// pnpm contract:check [--base-ref <git ref>] — fail if generated files are stale or stable operations break.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import openapiTS, { astToString } from 'openapi-typescript';
import { breakingChanges } from './compat';
import { buildOpenApi } from './openapi';

const SPEC = 'packages/contracts/openapi.json';
const TYPES = 'packages/api-client/src/schema.d.ts';
const HEADER = '// Generated from packages/contracts/openapi.json by `pnpm contract:generate`. Do not edit.\n';

async function render() {
  const document = buildOpenApi();
  const spec = JSON.stringify(document, null, 2) + '\n';
  const types = HEADER + astToString(await openapiTS(structuredClone(document) as never, { alphabetize: true, exportType: true }));
  return { document, spec, types };
}
const read = (file: string) => { try { return readFileSync(file, 'utf8').replace(/\r\n/g, '\n'); } catch { return null; } };

const [command = 'check', ...args] = process.argv.slice(2);
const { document, spec, types } = await render();
if (command === 'generate') {
  writeFileSync(SPEC, spec);
  writeFileSync(TYPES, types);
  console.log(`Wrote ${SPEC} and ${TYPES}`);
} else if (command === 'check') {
  const problems: string[] = [];
  if (read(SPEC) !== spec) problems.push(`${SPEC} 已过期：运行 pnpm contract:generate`);
  if (read(TYPES) !== types) problems.push(`${TYPES} 已过期：运行 pnpm contract:generate`);
  const ref = args[args.indexOf('--base-ref') + 1];
  if (args.includes('--base-ref') && ref) {
    let previous: string | null = null;
    try { previous = execFileSync('git', ['show', `${ref}:${SPEC}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { /* no published contract at base */ }
    if (previous === null) console.log(`基线 ${ref} 尚无 ${SPEC}，跳过破坏性变更比较`);
    else {
      const issues = breakingChanges(JSON.parse(previous), document as never);
      problems.push(...issues.map(issue => `破坏性变更：${issue}`));
      if (!issues.length) console.log(`与 ${ref} 相比 stable 操作无破坏性变更`);
    }
  }
  const stable = Object.values(document.paths).flatMap(p => Object.values(p)).filter(o => (o as Record<string, unknown>)['x-stability'] === 'stable').length;
  if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1; }
  else console.log(`契约一致：${Object.keys(document.paths).length} 个路径，${stable} 个 stable 操作`);
} else {
  console.error('用法: contract generate | check [--base-ref <ref>]');
  process.exitCode = 1;
}

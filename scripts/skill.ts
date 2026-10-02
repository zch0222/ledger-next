import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { clientConfigs, SKILL_NAME, type ClientId } from '../packages/mcp/src/clients';
import { createLedgerMcpServer, TOOL_NAMES } from '../packages/mcp/src/server';
import { buildPackages, lintSkill, planInstall, renderToolsReference, type Files } from '../packages/mcp/src/skill';

// pnpm skill:build [--origin https://ledger.example] [--out dist/skill]
// pnpm skill:install --client claude-code --target <project> [--force]
// Builds the ledger-service Skill from packages/skill (single source) plus a tools reference read from the real server,
// and installs it without ever silently replacing a same-name Skill. MCP client configuration is printed, never written.
const SOURCE = 'packages/skill/ledger-service';
const [command, ...rest] = process.argv.slice(2);
const flag = (name: string) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined; };

function read(dir: string): Files {
  const files: Files = {};
  const walk = (current: string) => {
    for (const name of readdirSync(current)) {
      const full = path.join(current, name);
      if (statSync(full).isDirectory()) walk(full); else files[path.relative(dir, full).split(path.sep).join('/')] = readFileSync(full, 'utf8');
    }
  };
  if (existsSync(dir)) walk(dir);
  return files;
}
function write(dir: string, files: Files) {
  for (const [rel, content] of Object.entries(files)) { const full = path.join(dir, rel); mkdirSync(path.dirname(full), { recursive: true }); writeFileSync(full, content); }
}

/** The Skill files: the hand-written source plus references/tools.md generated from the server's tools/list. */
export async function skillFiles(): Promise<Files> {
  const server = createLedgerMcpServer(async () => ({ ok: false, status: 0, problem: { status: 0, code: 'OFFLINE', title: 'offline' } }), { apiBase: 'https://ledger.example/api/v1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'skill-build', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const { tools } = await client.listTools();
  await client.close();
  return { ...read(SOURCE), 'references/tools.md': renderToolsReference(tools) };
}

async function main() {
  const skill = await skillFiles();
  const problems = lintSkill(skill, TOOL_NAMES);
  if (problems.length) { console.error(`Skill 校验失败：\n- ${problems.join('\n- ')}`); process.exit(1); }
  if (command === 'build') {
    const out = flag('out') ?? 'dist/skill', origin = flag('origin') ?? 'https://ledger.example';
    write(path.join(out, 'source', SKILL_NAME), skill);
    for (const [id, files] of Object.entries(buildPackages(skill, origin))) write(path.join(out, id), files);
    console.log(`已生成 ${out}/{source,codex,claude-code,dsh,qoder}（${Object.keys(skill).length} 个 Skill 文件，示例域名 ${origin}）`);
  } else if (command === 'install') {
    const client = clientConfigs(flag('origin') ?? 'https://ledger.example').find(c => c.id === flag('client') as ClientId);
    const target = flag('target');
    if (!client || !target) { console.error('用法：pnpm skill:install --client codex|claude-code|dsh|qoder --target <项目目录> [--force]'); process.exit(2); }
    const dir = path.join(target, client.skillDirs[0]);
    const plan = planInstall(existsSync(dir) ? read(dir) : null, skill);
    if (plan.action === 'unchanged') { console.log(`${dir} 已是最新，未改动。`); return; }
    if (plan.action === 'conflict') {
      console.error(`${dir} 已存在且内容不同：`);
      for (const change of plan.changes) console.error(`\n=== ${change.path}\n${change.diff}`);
      if (!rest.includes('--force')) { console.error('\n未做任何修改。确认要替换时加 --force（原目录会先备份）。'); process.exit(3); }
      // Outside every skills directory, so no client discovers the old copy as a second ledger-service Skill.
      const backup = path.join(target, '.ledger-skill-backup', `${client.id}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
      mkdirSync(path.dirname(backup), { recursive: true });
      renameSync(dir, backup);
      console.error(`原目录已备份到 ${backup}`);
    }
    write(dir, skill);
    console.log(`已安装 Skill 到 ${dir}。\nMCP 配置（请自行放入 ${client.file}，令牌只放在环境变量 LEDGER_API_TOKEN）：\n\n${client.content}`);
  } else {
    console.error('用法：pnpm skill:build [--origin URL] [--out DIR] | pnpm skill:install --client ID --target DIR [--force]');
    process.exit(2);
  }
}
if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('scripts', 'skill.ts'))) main().catch(error => { console.error(error); process.exit(1); });

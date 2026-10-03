import { createHash } from 'node:crypto';
import { SCOPES } from '@ledger/contracts/common';
import { clientConfigs, SKILL_NAME, TOOL_TABLE, type ClientId } from './clients';

/**
 * The ledger-service Skill as data (API_AGENT_CONTRACT §6): one source package, a tools reference generated from the
 * server's real tool list, four client packages with checksums, and an install plan that never overwrites a user's
 * own same-name Skill without showing the difference first.
 */
export type Files = Record<string, string>;
type ToolInfo = {
  name: string;
  title?: string;
  description?: string;
  inputSchema: { properties?: Record<string, unknown>; required?: string[] };
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean };
};

export function renderToolsReference(tools: ToolInfo[]) {
  const scope = Object.fromEntries(TOOL_TABLE.map(t => [t.name, t.scope]));
  const kind = (t: ToolInfo) =>
    t.annotations?.readOnlyHint
      ? '只读'
      : t.annotations?.destructiveHint
        ? '写入（修改既有记录）'
        : t.name.includes('_preview_')
          ? '预览（不改账）'
          : '写入';
  const lines = [
    '# 工具参考',
    '',
    '由服务端实际注册的工具生成（`pnpm skill:build`），与 MCP `tools/list` 一致。作用域不足时服务端拒绝；提示（只读 / 幂等）只供客户端参考。',
    '',
  ];
  for (const t of tools) {
    const props = Object.keys(t.inputSchema.properties ?? {});
    const required = new Set(t.inputSchema.required ?? []);
    lines.push(
      `## ${t.name}`,
      '',
      `${t.title ?? ''}：${t.description ?? ''}`,
      '',
      `- 类型：${kind(t)}${t.annotations?.idempotentHint ? '；同一 idempotencyKey 重试安全' : ''}`,
      `- 作用域：${scope[t.name] ?? '—'}`,
      `- 参数：${props.length ? props.map(p => (required.has(p) ? `\`${p}\`（必填）` : `\`${p}\``)).join('、') : '无'}`,
      '',
    );
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

export function frontmatter(skill: string) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(skill);
  if (!match) return null;
  const fields = Object.fromEntries(
    match[1]
      .split('\n')
      .map(line => /^([a-z-]+):\s*(.*)$/.exec(line))
      .filter(m => m !== null)
      .map(m => [m[1], m[2].trim()]),
  );
  return { name: fields.name ?? '', description: fields.description ?? '' };
}

const SECRET = [
  /lnp_[A-Za-z0-9_-]{20,}/,
  /Bearer\s+(?![$<'"])[A-Za-z0-9._~+/-]{16,}/,
  /\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/,
];

/** Problems that would make the Skill lie: tools or scopes that do not exist, broken links, missing frontmatter, secrets. */
export function lintSkill(files: Files, toolNames: readonly string[]) {
  const problems: string[] = [];
  const skill = files['SKILL.md'];
  if (!skill) return ['缺少 SKILL.md'];
  const meta = frontmatter(skill);
  if (!meta) problems.push('SKILL.md 缺少 frontmatter');
  else {
    if (meta.name !== SKILL_NAME || !/^[a-z0-9-]{1,64}$/.test(meta.name)) problems.push(`name 应为 ${SKILL_NAME}`);
    if (!meta.description || meta.description.length > 1024) problems.push('description 为空或超过 1024 字符');
  }
  const known = new Set(toolNames);
  const scopes = new Set<string>(SCOPES);
  for (const [path, text] of Object.entries(files)) {
    for (const [name] of text.matchAll(/\bledger_[a-z_]+\b/g)) {
      if (!known.has(name)) problems.push(`${path}: 引用了不存在的工具 ${name}`);
    }
    for (const [scope] of text.matchAll(/\b[a-z]+:(?:read|write)\b/g)) {
      if (!scopes.has(scope)) problems.push(`${path}: 引用了不存在的作用域 ${scope}`);
    }
    for (const [, target] of text.matchAll(/\]\(([^)#\s]+)\)/g)) {
      if (/^[a-z]+:/.test(target)) continue;
      const resolved = [...path.split('/').slice(0, -1), ...target.split('/')]
        .reduce<string[]>(
          (parts, part) => (part === '..' ? parts.slice(0, -1) : part === '.' ? parts : [...parts, part]),
          [],
        )
        .join('/');
      if (!(resolved in files)) problems.push(`${path}: 链接 ${target} 不存在`);
    }
    for (const pattern of SECRET) if (pattern.test(text)) problems.push(`${path}: 疑似包含真实凭据`);
  }
  const mentioned = Object.values(files).join('\n');
  for (const name of toolNames) if (!mentioned.includes(name)) problems.push(`没有任何文件说明工具 ${name}`);
  return [...new Set(problems)];
}

export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
export function sha256sums(files: Files) {
  return (
    Object.keys(files)
      .filter(p => p !== 'SHA256SUMS')
      .sort()
      .map(p => `${sha256(files[p])}  ${p}`)
      .join('\n') + '\n'
  );
}
export function verifySums(files: Files) {
  const listed = new Map(
    (files.SHA256SUMS ?? '')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => [line.slice(66), line.slice(0, 64)] as const),
  );
  const problems = [...listed]
    .filter(([path, sum]) => files[path] === undefined || sha256(files[path]) !== sum)
    .map(([path]) => path);
  for (const path of Object.keys(files)) if (path !== 'SHA256SUMS' && !listed.has(path)) problems.push(path);
  return problems;
}

const EXT = { toml: 'toml', json: 'json', yaml: 'yaml' } as const;
/** Four client packages from one source. Each carries the same Skill files, its MCP snippet, install notes and checksums. */
export function buildPackages(skill: Files, origin: string): Record<ClientId, Files> {
  const out = {} as Record<ClientId, Files>;
  for (const client of clientConfigs(origin)) {
    const files: Files = {};
    for (const [path, content] of Object.entries(skill)) files[`${client.skillDirs[0]}/${path}`] = content;
    files[`mcp/ledger.${EXT[client.language]}`] = client.content;
    files['INSTALL.md'] = [
      `# ${client.name} 安装说明`,
      '',
      `传输：${client.transport === 'stdio' ? 'stdio（本地进程）' : 'Streamable HTTP'}。配置位置：${client.file}。示例域名 ${origin} 请换成实际部署地址。`,
      '',
      '## MCP 配置',
      '',
      `见 \`mcp/ledger.${EXT[client.language]}\`。令牌只从环境变量 LEDGER_API_TOKEN 读取，文件中没有真实凭据。`,
      '',
      '## Skill',
      '',
      `复制到项目内 \`${client.skillDirs.join('` 或 `')}\`；也可以运行：`,
      '',
      '```',
      `pnpm skill:install --client ${client.id} --target <你的项目目录>`,
      '```',
      '',
      '同名目录已存在且内容不同时，安装器只显示差异并停止；确认后加 `--force`，原目录会先移到项目根目录的 `.ledger-skill-backup/`（不在任何 skills 目录内，避免被当成第二个同名 Skill）。',
      '',
      '## 步骤',
      '',
      ...client.steps.map((s, i) => `${i + 1}. ${s}`),
      '',
      '## 参考',
      '',
      ...client.docs.map(d => `- ${d}`),
      '',
    ].join('\n');
    files.SHA256SUMS = sha256sums(files);
    out[client.id] = files;
  }
  return out;
}

/** A small line diff (LCS) for showing what an install would replace. */
export function lineDiff(before: string, after: string) {
  const a = before.split('\n');
  const b = after.split('\n');
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      i++;
      j++;
    } else if (i < a.length && (j === b.length || table[i + 1][j] >= table[i][j + 1])) out.push(`- ${a[i++]}`);
    else out.push(`+ ${b[j++]}`);
  }
  return out.join('\n');
}

export type InstallPlan = { action: 'install' | 'unchanged' | 'conflict'; changes: { path: string; diff: string }[] };
/** Install only into an empty place or over identical content; anything else is a conflict to show, never to overwrite. */
export function planInstall(existing: Files | null, incoming: Files): InstallPlan {
  if (!existing || !Object.keys(existing).length) return { action: 'install', changes: [] };
  const paths = [...new Set([...Object.keys(existing), ...Object.keys(incoming)])].sort();
  const changes = paths
    .filter(p => existing[p] !== incoming[p])
    .map(p => ({
      path: p,
      diff:
        existing[p] === undefined
          ? '（新增文件）'
          : incoming[p] === undefined
            ? '（仅存在于本地：安装后会随备份移走）'
            : lineDiff(existing[p], incoming[p]),
    }));
  return { action: changes.length ? 'conflict' : 'unchanged', changes };
}

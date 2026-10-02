import { describe, expect, it } from 'vitest';
import { clientConfigs } from '../../packages/mcp/src/clients';
import { TOOL_NAMES } from '../../packages/mcp/src/server';
import { buildPackages, frontmatter, lineDiff, lintSkill, planInstall, renderToolsReference, sha256sums, verifySums } from '../../packages/mcp/src/skill';
import { skillFiles } from '../../scripts/skill';

// M6-SKILL: the formal ledger-service Skill never names a tool, scope or link that does not exist, carries no secret,
// is identical in all four client packages, and is never installed over a user's own changes without a diff.
describe('the shipped Skill', () => {
  it('passes the lint against the real tool list, and its tools reference matches tools/list', async () => {
    const files = await skillFiles();
    expect(Object.keys(files).sort()).toEqual(['SKILL.md', 'references/tools.md', 'references/workflows.md']);
    expect(lintSkill(files, TOOL_NAMES)).toEqual([]);
    expect(frontmatter(files['SKILL.md'])).toMatchObject({ name: 'ledger-service' });
    for (const name of TOOL_NAMES) expect(files['references/tools.md']).toContain(`## ${name}`);
    expect(files['references/tools.md']).toContain('`ledgerId`（必填）');
    expect(files['SKILL.md']).toMatch(/不要使用/); // a negative trigger boundary is part of the description
  });

  it('builds four packages with the same Skill, their own snippet and verifiable checksums, without secrets', async () => {
    const files = await skillFiles();
    const packages = buildPackages(files, 'https://ledger.example');
    expect(Object.keys(packages).sort()).toEqual(['claude-code', 'codex', 'dsh', 'qoder']);
    const skills = Object.values(packages).map(p => Object.entries(p).find(([path]) => path.endsWith('/SKILL.md'))![1]);
    expect(new Set(skills).size).toBe(1);
    expect(Object.keys(packages.codex)).toContain('.agents/skills/ledger-service/SKILL.md');
    expect(Object.keys(packages['claude-code'])).toContain('.claude/skills/ledger-service/references/workflows.md');
    expect(Object.keys(packages.dsh)).toContain('.dsh/skills/ledger-service/SKILL.md');
    expect(Object.keys(packages.qoder)).toContain('.qoder/skills/ledger-service/SKILL.md');
    expect(packages.codex['mcp/ledger.toml']).toContain('bearer_token_env_var = "LEDGER_API_TOKEN"');
    expect(packages['claude-code']['mcp/ledger.json']).toContain('Bearer ${LEDGER_API_TOKEN}');
    expect(packages.dsh['mcp/ledger.yaml']).toContain("!!js \"'Bearer ' + process.env.LEDGER_API_TOKEN\"");
    expect(packages.qoder['INSTALL.md']).toContain('pnpm skill:install --client qoder');
    for (const files of Object.values(packages)) {
      expect(verifySums(files)).toEqual([]);
      expect(lintSkill(Object.fromEntries(Object.entries(files).map(([p, c]) => [p.replace(/^.*ledger-service\//, ''), c])), TOOL_NAMES).filter(p => p.includes('凭据'))).toEqual([]);
    }
    const tampered = { ...packages.codex, 'INSTALL.md': `${packages.codex['INSTALL.md']}x`, extra: '1' };
    expect(verifySums(tampered).sort()).toEqual(['INSTALL.md', 'extra']);
    expect(verifySums({ ...packages.codex, SHA256SUMS: `${'0'.repeat(64)}  gone.md\n` })).toContain('gone.md');
    expect(sha256sums({ b: '2', a: '1', SHA256SUMS: 'x' }).split('\n')[0]).toMatch(/ {2}a$/);
  });
});

describe('Skill lint', () => {
  const good = { 'SKILL.md': '---\nname: ledger-service\ndescription: 用账本\n---\n# x\n见 [w](references/w.md) 与 [外链](https://example.com)。', 'references/w.md': '[返回](../SKILL.md)' };
  it('reports invented tools and scopes, broken links, bad frontmatter, secrets and undocumented tools', () => {
    expect(lintSkill(good, [])).toEqual([]);
    expect(lintSkill({}, [])).toEqual(['缺少 SKILL.md']);
    expect(lintSkill({ 'SKILL.md': '# 没有 frontmatter' }, [])).toEqual(['SKILL.md 缺少 frontmatter']);
    expect(lintSkill({ ...good, 'SKILL.md': good['SKILL.md'].replace('ledger-service', 'Ledger Service') }, [])).toContain('name 应为 ledger-service');
    expect(lintSkill({ ...good, 'SKILL.md': good['SKILL.md'].replace('description: 用账本', 'description: ') }, [])).toContain('description 为空或超过 1024 字符');
    expect(lintSkill({ ...good, 'references/w.md': '调用 ledger_delete_everything，需要 money:write' }, ['ledger_get_context'])).toEqual([
      'references/w.md: 引用了不存在的工具 ledger_delete_everything', 'references/w.md: 引用了不存在的作用域 money:write', '没有任何文件说明工具 ledger_get_context',
    ]);
    expect(lintSkill({ ...good, 'references/w.md': '[坏链](./nope.md) [上一级](../../x.md)' }, [])).toEqual(['references/w.md: 链接 ./nope.md 不存在', 'references/w.md: 链接 ../../x.md 不存在']);
    for (const secret of [`lnp_${'a'.repeat(43)}`, 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345', '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw']) {
      expect(lintSkill({ ...good, 'references/w.md': secret }, [])).toEqual(['references/w.md: 疑似包含真实凭据']);
    }
    expect(lintSkill({ ...good, 'references/w.md': 'Bearer ${LEDGER_API_TOKEN} 或 Bearer <令牌>' }, [])).toEqual([]);
  });
  it('reads frontmatter fields and ignores unknown lines', () => {
    expect(frontmatter('---\nname: a\nextra line\ndescription: b c\n---\nbody')).toEqual({ name: 'a', description: 'b c' });
    expect(frontmatter('---\nfoo: 1\n---\n')).toEqual({ name: '', description: '' });
  });
});

describe('install plan', () => {
  const incoming = { 'SKILL.md': 'a\nb\nc', 'references/w.md': 'w' };
  it('installs into an empty place, leaves identical content alone, and shows a diff instead of overwriting', () => {
    expect(planInstall(null, incoming)).toEqual({ action: 'install', changes: [] });
    expect(planInstall({}, incoming).action).toBe('install');
    expect(planInstall({ ...incoming }, incoming)).toEqual({ action: 'unchanged', changes: [] });
    const plan = planInstall({ 'SKILL.md': 'a\nmine\nc', 'my-notes.md': 'x' }, incoming);
    expect(plan.action).toBe('conflict');
    expect(plan.changes).toEqual([
      { path: 'SKILL.md', diff: '- mine\n+ b' },
      { path: 'my-notes.md', diff: '（仅存在于本地：安装后会随备份移走）' },
      { path: 'references/w.md', diff: '（新增文件）' },
    ]);
  });
  it('line diff keeps common lines and marks removals and additions', () => {
    expect(lineDiff('a\nb\nc', 'a\nb\nc')).toBe('');
    expect(lineDiff('a\nc', 'a\nb\nc')).toBe('+ b');
    expect(lineDiff('a\nb', 'a')).toBe('- b');
    expect(lineDiff('x', 'y')).toBe('- x\n+ y');
  });
});

describe('tools reference and client configs', () => {
  it('renders kinds, required fields and scopes from a tool list', () => {
    const md = renderToolsReference([
      { name: 'ledger_get_context', title: '上下文', description: 'd', inputSchema: {}, annotations: { readOnlyHint: true } },
      { name: 'ledger_update_transaction', description: 'u', inputSchema: { properties: { a: {}, b: {} }, required: ['a'] }, annotations: { destructiveHint: true, idempotentHint: true } },
      { name: 'ledger_preview_reminder', inputSchema: { properties: {} } },
      { name: 'ledger_unknown', inputSchema: {} },
    ]);
    expect(md).toContain('- 类型：只读\n- 作用域：基础只读\n- 参数：无');
    expect(md).toContain('- 类型：写入（修改既有记录）；同一 idempotencyKey 重试安全\n- 作用域：transactions:write\n- 参数：`a`（必填）、`b`');
    expect(md).toContain('## ledger_preview_reminder\n\n：\n\n- 类型：预览（不改账）');
    expect(md).toContain('## ledger_unknown\n\n：\n\n- 类型：写入\n- 作用域：—');
  });
  it('generates configs for a deployment without real secrets, trimming a trailing slash', () => {
    const configs = clientConfigs('https://books.example/', 'C:/ledger/stdio.js');
    expect(configs.map(c => c.id)).toEqual(['codex', 'claude-code', 'dsh', 'qoder']);
    expect(configs[0].content).toContain('url = "https://books.example/mcp"');
    expect(JSON.parse(configs[3].content).mcpServers.ledger).toMatchObject({ args: ['C:/ledger/stdio.js'], env: { LEDGER_API_URL: 'https://books.example/api/v1' } });
  });
});

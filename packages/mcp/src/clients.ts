// Single source for the four Agent clients (API_AGENT_CONTRACT §5): MCP configuration, where the Skill goes, and how
// to check the connection. Used by the P10 page and by the Skill package generator. Never contains a real secret:
// the token is always read from LEDGER_API_TOKEN in the user's own environment.
export type ClientId = 'codex' | 'claude-code' | 'dsh' | 'qoder';
export type ClientConfig = {
  id: ClientId; name: string; transport: 'streamable-http' | 'stdio'; file: string; language: 'toml' | 'json' | 'yaml';
  content: string; skillDirs: string[]; steps: string[]; docs: string[];
};
export const TOKEN_ENV = 'LEDGER_API_TOKEN';
export const SKILL_NAME = 'ledger-service';

export function clientConfigs(origin: string, stdioPath = '/absolute/path/ledger-mcp/dist/stdio.js'): ClientConfig[] {
  const base = origin.replace(/\/$/, ''), mcp = `${base}/mcp`;
  return [
    {
      id: 'codex', name: 'Codex', transport: 'streamable-http', file: '~/.codex/config.toml', language: 'toml',
      content: `[mcp_servers.ledger]\nurl = "${mcp}"\nbearer_token_env_var = "${TOKEN_ENV}"\n`,
      skillDirs: [`.agents/skills/${SKILL_NAME}`],
      steps: [`在启动 Codex 的环境里设置 ${TOKEN_ENV}（shell 配置或密钥管理器），不要写进仓库。`, '把配置加入 Codex 配置文件，重启 Codex 后确认 ledger 服务器已连接。', `把 Skill 放到项目的 .agents/skills/${SKILL_NAME}/。`, '先调用 ledger_get_context 做只读探针，再测试写入与撤销。'],
      docs: ['https://learn.chatgpt.com/docs/extend/mcp?surface=cli', 'https://learn.chatgpt.com/docs/build-skills'],
    },
    {
      id: 'claude-code', name: 'Claude Code', transport: 'streamable-http', file: '.mcp.json（项目根目录）', language: 'json',
      content: `${JSON.stringify({ mcpServers: { ledger: { type: 'http', url: mcp, headers: { Authorization: `Bearer \${${TOKEN_ENV}}` } } } }, null, 2)}\n`,
      skillDirs: [`.claude/skills/${SKILL_NAME}`],
      steps: [`在启动 Claude Code 的环境里设置 ${TOKEN_ENV}；.mcp.json 只引用变量名，可以提交。`, '执行 /mcp 查看 ledger 的连接状态与工具列表。', `把 Skill 放到 .claude/skills/${SKILL_NAME}/。`, '先调用 ledger_get_context 做只读探针，再测试写入与撤销。'],
      docs: ['https://code.claude.com/docs/en/mcp', 'https://code.claude.com/docs/en/skills'],
    },
    {
      id: 'dsh', name: 'DeepSeek Harness（dsh）', transport: 'streamable-http', file: 'dsh profile / overlay 的插件列表', language: 'yaml',
      content: `- id: mcp-ledger\n  name: '@deepseek-ai/dsh-mcp-client'\n  config:\n    serverName: ledger\n    transport: streamable-http\n    url: ${mcp}\n    headers:\n      Authorization: !!js "'Bearer ' + process.env.${TOKEN_ENV}"\n`,
      skillDirs: [`.dsh/skills/${SKILL_NAME}`, `.agents/skills/${SKILL_NAME}`],
      steps: ['把这一条插件加入实际使用的 profile / overlay（!!js 是 dsh 配置表达式，不要粘贴到其他客户端）。', `在启动 dsh 的环境里设置 ${TOKEN_ENV}。`, `把 Skill 放到 .dsh/skills/${SKILL_NAME}/（也识别 .agents/skills）。`, 'dsh 官方 MCP client 不支持 prompt 模板：业务流程都在 Skill 里。'],
      docs: ['https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/mcp/mcp-client/README.md', 'https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/skills'],
    },
    {
      id: 'qoder', name: 'Qoder IDE / CLI', transport: 'stdio', file: 'Qoder 的 MCP 设置（JSON）', language: 'json',
      content: `${JSON.stringify({ mcpServers: { ledger: { command: 'node', args: [stdioPath], env: { LEDGER_API_URL: `${base}/api/v1`, [TOKEN_ENV]: '<在本机注入，不要提交到仓库>' } } } }, null, 2)}\n`,
      skillDirs: [`.qoder/skills/${SKILL_NAME}`, `~/.qoder/skills/${SKILL_NAME}`],
      steps: ['用 pnpm mcp:build 生成 apps/mcp/dist/stdio.js，并把 args 换成它在本机的绝对路径（Windows 用实际路径）。', `${TOKEN_ENV} 只在本机配置中注入；stdio 不会自动继承名字含 TOKEN 的变量。`, '每次只启用 HTTP 或 stdio 其中一个入口，避免工具重复注册。', `Qoder CLI 的 Skill 放 .qoder/skills/${SKILL_NAME}/，新会话加载，或执行 /skills reload。`],
      docs: ['https://docs.qoder.com/user-guide/chat/model-context-protocol', 'https://docs.qoder.com/cli/Skills'],
    },
  ];
}

/** The tools as shown on P10: name, what it does, the scope REST will require. */
export const TOOL_TABLE: { name: string; summary: string; scope: string; writes: boolean }[] = [
  { name: 'ledger_get_context', summary: '账本、基准币、时区、权限与分类', scope: '基础只读', writes: false },
  { name: 'ledger_list_accounts', summary: '账户与余额', scope: 'accounts:read', writes: false },
  { name: 'ledger_list_transactions', summary: '交易明细与筛选', scope: 'transactions:read', writes: false },
  { name: 'ledger_get_summary', summary: '期间收支汇总（含口径）', scope: 'reports:read', writes: false },
  { name: 'ledger_get_exchange_rates', summary: '参考汇率与新鲜度', scope: 'fx:read', writes: false },
  { name: 'ledger_list_subscriptions', summary: '订阅与到期账单', scope: 'subscriptions:read', writes: false },
  { name: 'ledger_list_reminders', summary: '提醒规则、渠道与投递', scope: 'reminders:read', writes: false },
  { name: 'ledger_preview_transaction', summary: '预览交易（不入账）', scope: 'transactions:write', writes: false },
  { name: 'ledger_create_transaction', summary: '提交预览入账 / 退款', scope: 'transactions:write', writes: true },
  { name: 'ledger_update_transaction', summary: '更正交易（保留审计）', scope: 'transactions:write', writes: true },
  { name: 'ledger_preview_subscription', summary: '预览订阅', scope: 'subscriptions:write', writes: false },
  { name: 'ledger_create_subscription', summary: '保存订阅', scope: 'subscriptions:write', writes: true },
  { name: 'ledger_preview_reminder', summary: '预览提醒', scope: 'reminders:write', writes: false },
  { name: 'ledger_create_reminder', summary: '保存提醒', scope: 'reminders:write', writes: true },
  { name: 'ledger_get_operation', summary: '超时后查询写入结果', scope: '原发起人', writes: false },
];

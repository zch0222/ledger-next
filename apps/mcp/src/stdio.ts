import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { restClient } from '../../../packages/mcp/src/rest';
import { createLedgerMcpServer, SERVER_INFO } from '../../../packages/mcp/src/server';

// ledger-mcp over stdio (API_AGENT_CONTRACT §4.1, Qoder / local fallback): stdout carries protocol messages only,
// every log line goes to stderr. The token comes from the environment and is never echoed.
console.log = console.info = console.debug = console.error;

async function main() {
  const apiUrl = process.env.LEDGER_API_URL, token = process.env.LEDGER_API_TOKEN;
  if (!apiUrl || !token) {
    console.error('ledger-mcp: 需要环境变量 LEDGER_API_URL（例如 https://ledger.example/api/v1）和 LEDGER_API_TOKEN（个人访问令牌）');
    process.exit(2);
  }
  const apiBase = apiUrl.replace(/\/$/, '');
  const server = createLedgerMcpServer(restClient(apiBase, token), { apiBase });
  await server.connect(new StdioServerTransport());
  console.error(`ledger-mcp ${SERVER_INFO.version}: stdio ready → ${new URL(apiBase).origin}`);
  const stop = () => { void server.close().finally(() => process.exit(0)); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
main().catch(error => { console.error('ledger-mcp: 启动失败', error instanceof Error ? error.message : error); process.exit(1); });

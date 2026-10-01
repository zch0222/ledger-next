# 官方参考与核查记录

核查日期：2026-10-02（Asia/Hong_Kong）。文档采用功能设计与最小必要概述，未复制第三方源码。供应商政策和 Agent 版本可能变化，实施阶段需锁定版本再验证。

| 来源 | 用于本设计的事实 / 限制 |
| --- | --- |
| [Wallos](https://github.com/ellite/Wallos) | 订阅管理、多币种转换、统计、通知、自托管作为功能参考；官方仓库标示 GPL-3.0 |
| [Next.js Server / Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components) | 服务端与客户端组件边界；本次页面显示 16.x 文档，实际版本在 M1 锁定 |
| [Next.js Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers) | REST 接口在 App Router 中实现 |
| [Next.js Backend for Frontend](https://nextjs.org/docs/app/guides/backend-for-frontend) | SSR 直接取服务数据，避免绕回自家 HTTP handler |
| [Fixer](https://fixer.io/) | 存在 60 秒更新档位；本次未购买套餐，未验证源延迟 |
| [Telegram Bot API](https://core.telegram.org/bots/api#sendmessage) | HTTP 消息接口，实际接收范围与机器人配置需联调 |
| [飞书机器人](https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot) | 官方入口可达但动态正文工具未提取，具体签名与配额须 M5 复核 |
| [企业微信群机器人](https://developer.work.weixin.qq.com/document/path/91770) | 本次访问未成功提取；保留官方入口，具体协议 / 额度不视为已核实 |
| [pushplus 消息 API](https://www.pushplus.plus/doc/guide/api.html) | 个人微信通道候选，支持 wechat 参数；异步受理、回调 / 配额需实测 |
| [pushplus 发送渠道](https://pushplus.plus/doc/channel/) | 个人微信与企业微信通道不同，需要各自绑定 |
| [MCP transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) | stdio、Streamable HTTP 与 JSON-RPC 边界；最终协商按锁定 SDK |
| [OpenAI MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) | Codex mcp_servers URL、令牌环境变量配置 |
| [OpenAI Skills](https://learn.chatgpt.com/docs/build-skills) | SKILL.md 与项目 .agents/skills 目录 |
| [Claude Code MCP](https://code.claude.com/docs/en/mcp) | HTTP 服务、项目 .mcp.json 与连接检查 |
| [Claude Code Skills](https://code.claude.com/docs/en/skills) | .claude/skills 的技能组织 |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | 用户明确指定的 dsh；官方称开发预览，存在不兼容变更可能 |
| [dsh MCP client](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/mcp/mcp-client/README.md) | 插件 YAML、streamable-http、显式 env；当前不支持 MCP prompt templates |
| [dsh Skills](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/skills) | .dsh/skills、.agents/skills 发现规则 |
| [Qoder MCP](https://docs.qoder.com/user-guide/chat/model-context-protocol) | IDE 远程端点自动识别及 stdio 配置；具体 token 注入需客户端验证 |
| [Qoder CLI Skills](https://docs.qoder.com/cli/Skills) | .qoder/skills 和 /skills reload |
| [Apache ECharts 6.0.0](https://github.com/apache/echarts/releases/tag/6.0.0) | 原型固定使用此发行版 common 构建，附带 LICENSE / NOTICE；正式工程按需导入并锁定稳定补丁 |
| [ECharts 数据动画](https://echarts.apache.org/handbook/en/how-to/animation/transition/) | setOption 更新、入场 / 更新时长与错峰；系统减少动态效果时关闭动画 |
| [ECharts SVG SSR](https://echarts.apache.org/handbook/en/how-to/cross-platform/server/) | 可选服务端图形路径；当前原型的浏览器 SVG 不等于图表 SSR |

未进行：供应商付费、真实通知、真实 MCP 连接、Agent 客户端安装、产品性能测量。所有“待测”必须保留至取得证据。

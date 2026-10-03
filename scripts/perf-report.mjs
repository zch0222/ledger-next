import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

// Renders test-results/perf/*.json (from `pnpm test:perf`) into docs/evidence/M7-PERF/RESULTS.md with the targets of
// TECHNICAL_DESIGN §7.3. Every number comes from the files; a target without a measurement is shown as "未测".
const dir = process.argv[2] ?? 'test-results/perf';
const read = name => (existsSync(`${dir}/${name}`) ? JSON.parse(readFileSync(`${dir}/${name}`, 'utf8')) : null);
const load = read('load.json'),
  vitals = read('vitals.json'),
  env = read('environment.json'),
  sql = read('sql.json'),
  backup = read('backup.json'),
  seed = read('seed.json');
const verdict = (value, limit) =>
  value == null || Number.isNaN(value) ? '未测' : value <= limit ? '达标' : '**未达标**';
const ms = v => (v == null || Number.isNaN(v) ? '—' : `${Math.round(v)} ms`);
const rows = [];
const row = (metric, measured, target, value, limit) =>
  rows.push(`| ${metric} | ${measured} | ${target} | ${verdict(value, limit)} |`);

row(
  '已登录总览 TTFB（热，10 万笔账本）',
  `p95 ${ms(load?.dashboardTtfb?.bigHot?.p95)}`,
  'p95 ≤500 ms',
  load?.dashboardTtfb?.bigHot?.p95,
  500,
);
row(
  '已登录总览 TTFB（冷，10 万笔账本）',
  `p95 ${ms(load?.dashboardTtfb?.bigCold?.p95)}`,
  'p95 ≤1,000 ms',
  load?.dashboardTtfb?.bigCold?.p95,
  1000,
);
row(
  '已登录总览 TTFB（热，普通账本）',
  `p95 ${ms(load?.dashboardTtfb?.smallHot?.p95)}`,
  'p95 ≤500 ms',
  load?.dashboardTtfb?.smallHot?.p95,
  500,
);
row(
  '已登录总览 TTFB（冷，普通账本）',
  `p95 ${ms(load?.dashboardTtfb?.smallCold?.p95)}`,
  'p95 ≤1,000 ms',
  load?.dashboardTtfb?.smallCold?.p95,
  1000,
);
row(
  '总览完整 HTML（热，10 万笔账本；参考）',
  `p95 ${ms(load?.dashboardTtfb?.bigHotFull?.p95)}`,
  '（TTFB 目标 ≤500 ms）',
  load?.dashboardTtfb?.bigHotFull?.p95,
  500,
);
row(
  '总览完整 HTML（冷，10 万笔账本；参考）',
  `p95 ${ms(load?.dashboardTtfb?.bigColdFull?.p95)}`,
  '（TTFB 目标 ≤1,000 ms）',
  load?.dashboardTtfb?.bigColdFull?.p95,
  1000,
);
for (const [label, run] of [
  ['用户模型：100 并发用户、思考约 2 s', load?.mixedUsers],
  ['压力：100 个请求始终在途、无思考时间', load?.mixed],
]) {
  const o = run?.ops ?? {};
  row(
    `总览 TTFB（${label}）`,
    `p95 ${ms(o['page.dashboard']?.p95)}`,
    'p95 ≤500 ms（热）',
    o['page.dashboard']?.p95,
    500,
  );
  row(
    `总览完整 HTML（${label}；参考）`,
    `p95 ${ms(run?.dashboardFull?.p95)}`,
    '（TTFB 目标 ≤500 ms）',
    run?.dashboardFull?.p95,
    500,
  );
  for (const [name, text] of [
    ['api.transactions', '明细查询'],
    ['api.summary', '当月汇总'],
    ['api.accounts', '账户列表'],
  ])
    row(`REST 查询 ${text}（${label}）`, `p95 ${ms(o[name]?.p95)}`, 'p95 ≤300 ms', o[name]?.p95, 300);
  for (const [name, text] of [
    ['api.preview', '交易预览'],
    ['api.create', '提交入账'],
  ])
    row(`REST 写入 ${text}（${label}）`, `p95 ${ms(o[name]?.p95)}`, 'p95 ≤500 ms', o[name]?.p95, 500);
}
for (const kind of ['summary', 'cashFlow', 'categories']) {
  row(
    `12 月聚合 ${kind}（热）`,
    `p95 ${ms(load?.aggregation12m?.hot?.[kind]?.p95)}`,
    'p95 ≤500 ms',
    load?.aggregation12m?.hot?.[kind]?.p95,
    500,
  );
  row(
    `12 月聚合 ${kind}（冷）`,
    `p95 ${ms(load?.aggregation12m?.cold?.[kind]?.p95)}`,
    'p95 ≤1,500 ms',
    load?.aggregation12m?.cold?.[kind]?.p95,
    1500,
  );
}
for (const [page, p] of Object.entries(vitals?.pages ?? {})) {
  row(`LCP ${page}（移动 4G 实验室）`, `p75 ${ms(p.lcpMs.p75)}`, 'p75 ≤2,500 ms', p.lcpMs.p75, 2500);
  row(`INP ${page}（移动 4G 实验室）`, `p75 ${ms(p.inpMs.p75)}`, 'p75 ≤200 ms', p.inpMs.p75, 200);
  row(`CLS ${page}`, `p75 ${p.cls.p75}`, 'p75 ≤0.1', p.cls.p75, 0.1);
  row(
    `首屏 JS ${page}（传输字节，含框架）`,
    `${p.firstScreenJsKb.p50.toFixed(1)} KB`,
    '自有 JS gzip ≤180 KB',
    p.firstScreenJsKb.p50,
    180,
  );
}
row(
  '提醒调度延迟（负载中）',
  `p95 ${load?.reminders?.delaySeconds?.p95 ?? '—'} s（${load?.reminders?.measured ?? 0}/${load?.reminders?.rules ?? 0} 条）`,
  'p95 ≤60 s',
  load?.reminders?.delaySeconds?.p95,
  60,
);
row(
  '汇率源时间年龄（mock 源）',
  `p95 ${load?.fx?.sourceAgeSeconds?.p95 ?? '—'} s`,
  'p95 ≤120 s',
  load?.fx?.sourceAgeSeconds?.p95,
  120,
);

const errorRows = [
  ['用户模型', load?.mixedUsers],
  ['压力', load?.mixed],
].flatMap(([label, run]) =>
  Object.entries(run?.ops ?? {}).map(
    ([name, o]) =>
      `| ${label} | ${name} | ${o.requests} | ${o.errors} | ${o.errorRate}% | ${ms(o.p50)} | ${ms(o.p95)} | ${ms(o.p99)} |`,
  ),
);
const md = `# M7-PERF 实测结果

由 \`node scripts/perf-report.mjs\` 从 \`pnpm test:perf\` 的输出生成；方法与口径见 [README](README.md)。

运行时间：${load?.startedAt ?? '—'} → ${load?.finishedAt ?? '—'}

## 环境

- 主机：${env?.host?.cpus ?? '—'} vCPU，内存 ${env?.host?.memory ? `${(Number(env.host.memory) / 1024 ** 3).toFixed(1)} GiB` : '—'}，Docker ${env?.host?.server ?? '—'}，内核 ${env?.host?.kernel ?? '—'}；MySQL ${env?.versions?.mysql ?? '—'}。压测进程、浏览器与全部服务在同一主机（${env?.note ?? ''}）。
- 数据：${seed?.config?.USERS ?? '—'} 个用户（各一个账本、${seed?.config?.SMALL_TX ?? '—'} 笔），一个 ${seed?.config?.BIG ?? '—'} 笔的大账本（经 CSV 导入，${seed?.seconds?.big ? `${Math.round(seed.seconds.big)} s` : '—'}）；压测后数据库 ${load?.database?.sizeMb ?? '—'} MB、交易 ${load?.database?.transactions ?? '—'} 笔。
- 负载：用户模型 ${load?.config?.VUS ?? '—'} 并发用户、每次操作后思考 ${load?.mixedUsers?.thinkMs ?? '—'} ms 左右，运行 ${load?.mixedUsers?.seconds ?? '—'} s，${load?.mixedUsers?.requests ?? '—'} 次请求（${load?.mixedUsers?.throughputPerSecond ?? '—'} 次/秒）；压力场景 ${load?.config?.VUS ?? '—'} 个请求始终在途、无思考时间，运行 ${load?.mixed?.seconds ?? '—'} s，${load?.mixed?.requests ?? '—'} 次请求（${load?.mixed?.throughputPerSecond ?? '—'} 次/秒），读占 ${load?.mixed?.readShare ?? '—'}%；冷 / 热各 ${load?.config?.RUNS ?? '—'} 次；异常 ${(load?.mixed?.exceptions ?? 0) + (load?.mixedUsers?.exceptions ?? 0)} 次。

## 与目标对比（TECHNICAL_DESIGN §7.3）

| 指标 | 实测 | 目标 | 结论 |
| --- | --- | --- | --- |
${rows.join('\n')}

## 混合负载明细

| 场景 | 操作 | 请求 | 错误 | 错误率 | p50 | p95 | p99 |
| --- | --- | --- | --- | --- | --- | --- | --- |
${errorRows.join('\n')}

## 冷 / 热明细

\`\`\`json
${JSON.stringify({ aggregation12m: load?.aggregation12m, dashboardTtfb: load?.dashboardTtfb }, null, 1)}
\`\`\`

## 图表生命周期与减少动画

- 总览 ↔ 分析 20 次客户端切换：每页 ECharts 实例数 ${vitals?.charts?.instancesPerPage?.min ?? '—'}–${vitals?.charts?.instancesPerPage?.max ?? '—'}（不累积）；GC 后 JS 堆 ${(vitals?.charts?.heapMb ?? []).join(' → ')} MB。
- 打开“减少动态效果”后图表动画属性：${vitals?.charts?.reducedMotionAnimation ?? '—'}。
- 懒加载 JS（load 之后，含 ECharts chunk）：${Object.entries(vitals?.pages ?? {})
  .map(([k, p]) => `${k} ${p.lazyJsKb.p50.toFixed(1)} KB`)
  .join('；')}。

## 备份 / 恢复（本数据规模）

${backup ? `全量导出 ${backup.dumpSeconds.toFixed(1)} s（${(backup.dumpBytes / 1024 / 1024).toFixed(1)} MB），导入到空库 ${backup.restoreSeconds.toFixed(1)} s，导入后交易 ${backup.restoredTransactions} 笔。` : '未测'}

## 最耗时的 SQL（performance_schema，按总耗时）

| 语句 | 次数 | 平均 ms | 最大 ms | 总 s | 平均扫描行 |
| --- | --- | --- | --- | --- | --- |
${(sql ?? []).map(d => `| \`${String(d.statement).replace(/\|/g, '/').replace(/`/g, "'")}\` | ${d.calls} | ${d.avg_ms} | ${d.max_ms} | ${d.total_s} | ${d.rows_examined} |`).join('\n')}
`;
mkdirSync('docs/evidence/M7-PERF', { recursive: true });
writeFileSync('docs/evidence/M7-PERF/RESULTS.md', md);
console.log(rows.join('\n'));

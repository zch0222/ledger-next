#!/usr/bin/env node
// Dependency-free progress tooling; this is documentation tooling, not application code.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataPath = path.join(root, 'docs', 'milestones.json');
const reportPath = path.join(root, 'docs', 'MILESTONES.md');
const states = ['todo', 'ready', 'in_progress', 'in_review', 'blocked', 'done'];
const labels = {todo:'待开始', ready:'可开始', in_progress:'进行中', in_review:'待验收', blocked:'阻塞', done:'完成'};
const active = new Set(['ready', 'in_progress', 'in_review', 'done']);
const [command = 'status', ...args] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const map = new Map(data.tasks.map(t => [t.id, t]));
const esc = s => String(s ?? '').replaceAll('|', '\\|').replace(/\r?\n/g, ' ');
const pending = t => t.dependsOn.filter(id => map.get(id)?.status !== 'done');

function validate() {
  const errors = [];
  if (map.size !== data.tasks.length) errors.push('任务 ID 重复');
  for (const task of data.tasks) {
    if (!states.includes(task.status)) errors.push(task.id + ': 无效状态');
    if (!(task.estimateDays > 0)) errors.push(task.id + ': 估算必须大于 0');
    if (!task.steps?.length || !task.acceptance?.length) errors.push(task.id + ': 缺执行步骤或验收标准');
    for (const id of task.dependsOn) if (!map.has(id)) errors.push(task.id + ': 依赖不存在 ' + id);
    if (active.has(task.status) && pending(task).length) errors.push(task.id + ': 前置未完成 ' + pending(task).join(', '));
    if (task.status === 'blocked' && !task.blockedReason?.trim()) errors.push(task.id + ': 缺阻塞原因');
    if (task.status === 'done') {
      if (!task.evidence?.length) errors.push(task.id + ': 完成必须有证据');
      if (!task.owner || task.owner === '未分配') errors.push(task.id + ': 完成必须有实际负责人');
      if (task.requiresReview && !task.reviewer?.trim()) errors.push(task.id + ': 完成必须有评审人');
      for (const evidence of task.evidence ?? []) {
        if (/^https?:\/\//.test(evidence)) continue; // Remote content must be reviewed by a human.
        const local = path.resolve(root, evidence.split('#')[0]);
        if (!local.startsWith(root + path.sep) || !fs.existsSync(local)) errors.push(task.id + ': 证据文件不存在或越界 ' + evidence);
      }
    }
  }
  const visiting = new Set(), visited = new Set();
  function visit(id) {
    if (visiting.has(id)) { errors.push('循环依赖: ' + id); return; }
    if (visited.has(id) || !map.has(id)) return;
    visiting.add(id);
    for (const dependency of map.get(id).dependsOn) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const task of data.tasks) visit(task.id);
  if (data.tasks.some(t => t.phase === 'development' && active.has(t.status)) && map.get('G0')?.status !== 'done') errors.push('G0 未通过，禁止业务开发');
  if (errors.length) throw new Error(errors.join('\n'));
}

function progress(tasks) {
  const total = tasks.reduce((sum, t) => sum + t.estimateDays, 0);
  const completed = tasks.filter(t => t.status === 'done').reduce((sum, t) => sum + t.estimateDays, 0);
  return { total, completed, percent: total ? (100 * completed / total).toFixed(1) : '0.0' };
}

function render() {
  const all = progress(data.tasks);
  const dev = progress(data.tasks.filter(t => t.phase === 'development'));
  const lines = [
    '# Ledger Next · 可更新里程碑',
    '',
    '> 自动生成：请更新 milestones.json 或运行 scripts/progress.mjs；不要直接修改本文件。',
    '',
    '数据版本：' + data.schemaVersion + ' · 最近更新：' + data.updatedAt,
    '',
    '完成率按原始估算人日加权，只有 done 计入；in_review 不计完成。文档完成不代表业务开发完成。',
    '',
    '**全部工作：' + all.percent + '%（' + all.completed + '/' + all.total + ' 人日） · 业务开发：' + dev.percent + '% · G0：' + labels[map.get('G0').status] + '**',
    '',
    '| 里程碑 | 状态分布 | 完成人日 / 估算人日 | 完成率 |',
    '| --- | --- | --- | --- |'
  ];
  for (const milestone of data.milestones) {
    const tasks = data.tasks.filter(t => t.milestone === milestone.id);
    const p = progress(tasks);
    const counts = states.map(s => [s, tasks.filter(t => t.status === s).length]).filter(([, n]) => n).map(([s, n]) => labels[s] + ' ' + n).join('，');
    lines.push('| ' + milestone.id + ' ' + milestone.title + ' | ' + counts + ' | ' + p.completed + ' / ' + p.total + ' | ' + p.percent + '% |');
  }
  lines.push('', '## 下一步', '');
  const next = data.tasks.filter(t => t.status !== 'done' && !pending(t).length);
  for (const task of next) lines.push('- **' + task.id + '** ' + task.title + '（' + labels[task.status] + '；' + task.role + '）：' + task.nextAction);
  if (!next.length) lines.push('没有可推进的任务；检查阻塞与依赖。');
  lines.push('', '## 任务总览', '', '| ID | 任务 | 状态 | 负责人 / 角色 | 依赖 | 人日 |', '| --- | --- | --- | --- | --- | --- |');
  for (const t of data.tasks) lines.push('| ' + [t.id,t.title,labels[t.status],t.owner + ' / ' + t.role,t.dependsOn.join(', ') || '—',t.estimateDays].map(esc).join(' | ') + ' |');
  lines.push('', '## 执行卡', '');
  for (const t of data.tasks) {
    lines.push('### ' + t.id + ' · ' + t.title, '', '- 状态：' + labels[t.status] + '；负责人：' + t.owner + '；建议角色：' + t.role,
      '- 依赖：' + (t.dependsOn.join(', ') || '无') + '；未完成依赖：' + (pending(t).join(', ') || '无'),
      '- 估算：' + t.estimateDays + ' 人日；更新：' + t.updatedAt,
      '- 下一动作：' + t.nextAction);
    if (t.blockedReason) lines.push('- 阻塞：' + t.blockedReason);
    if (t.reviewer) lines.push('- 评审人：' + t.reviewer);
    lines.push('', '**执行步骤**', '');
    t.steps.forEach((s, i) => lines.push((i + 1) + '. ' + s));
    lines.push('', '**验收标准**', '');
    t.acceptance.forEach(s => lines.push('- [' + (t.status === 'done' ? 'x' : ' ') + '] ' + s));
    lines.push('', '**证据**', '');
    if (!t.evidence.length) lines.push('尚无完成证据。');
    for (const evidence of t.evidence) {
      const href = /^https?:\/\//.test(evidence) ? evidence : '../' + evidence;
      lines.push('- [' + evidence + '](' + href + ')');
    }
    lines.push('');
  }
  lines.push('## 变更历史', '', '| 时间 | 任务 | 变更 | 操作者 | 说明 |', '| --- | --- | --- | --- | --- |');
  for (const event of data.history) lines.push('| ' + [event.at,event.id,event.from + ' → ' + event.to,event.actor,event.note].map(esc).join(' | ') + ' |');
  return lines.join('\n') + '\n';
}

function writeAtomic(target, contents) {
  const temporary = target + '.tmp-' + process.pid;
  fs.writeFileSync(temporary, contents, 'utf8');
  fs.renameSync(temporary, target);
}

function options(values) {
  const result = {};
  for (let i = 0; i < values.length; i += 2) {
    if (!values[i]?.startsWith('--') || values[i + 1] === undefined || values[i + 1].startsWith('--')) throw new Error('参数应为 --key value');
    const key = values[i].slice(2);
    if (!['status','owner','actor','evidence','reviewer','reason','next','note'].includes(key)) throw new Error('未知参数: ' + key);
    (result[key] ??= []).push(values[i + 1]);
  }
  return result;
}

try {
  validate();
  if (command === 'validate') {
    // Compare with LF line endings: Windows checkouts (core.autocrlf) turn the generated file into CRLF.
    if (fs.existsSync(reportPath) && fs.readFileSync(reportPath, 'utf8').replace(/\r\n/g, '\n') !== render()) throw new Error('生成文档已过期，请运行 render');
    console.log('有效：' + data.tasks.length + ' 个任务；依赖无环；门禁、证据和生成文档一致。');
  } else if (command === 'render') {
    writeAtomic(reportPath, render());
    console.log('已生成 docs/MILESTONES.md');
  } else if (command === 'status') {
    for (const milestone of data.milestones) {
      const tasks = data.tasks.filter(t => t.milestone === milestone.id);
      console.log(milestone.id + ' ' + milestone.title + '：' + progress(tasks).percent + '% (' + tasks.filter(t => t.status === 'done').length + '/' + tasks.length + ')');
    }
    console.log('G0: ' + labels[map.get('G0').status] + '；业务开发: ' + progress(data.tasks.filter(t => t.phase === 'development')).percent + '%');
  } else if (command === 'next') {
    for (const t of data.tasks.filter(t => t.status !== 'done' && !pending(t).length)) console.log(t.id + ' [' + labels[t.status] + '] ' + t.nextAction);
  } else if (command === 'show') {
    if (!map.has(args[0])) throw new Error('未知任务 ID');
    console.log(JSON.stringify(map.get(args[0]), null, 2));
  } else if (command === 'update') {
    const task = map.get(args[0]);
    if (!task) throw new Error('未知任务 ID');
    const opts = options(args.slice(1));
    const actor = opts.actor?.at(-1);
    const note = opts.note?.at(-1);
    if (!actor?.trim() || !note?.trim()) throw new Error('更新必须指定 --actor 和 --note');
    const previous = task.status;
    for (const key of ['status','owner','reviewer']) if (opts[key]) task[key] = opts[key].at(-1);
    if (opts.next) task.nextAction = opts.next.at(-1);
    if (opts.reason) task.blockedReason = opts.reason.at(-1);
    if (task.status !== 'blocked') task.blockedReason = '';
    if (opts.evidence) task.evidence = [...new Set([...task.evidence, ...opts.evidence])];
    task.updatedAt = new Date().toISOString();
    data.updatedAt = task.updatedAt;
    data.history.push({at:task.updatedAt,id:task.id,from:previous,to:task.status,actor,note});
    validate(); // No writes occur if dependencies/evidence fail, including regression of a prerequisite.
    writeAtomic(dataPath, JSON.stringify(data, null, 2) + '\n');
    writeAtomic(reportPath, render());
    console.log(task.id + ': ' + labels[previous] + ' → ' + labels[task.status]);
  } else {
    throw new Error('用法: node scripts/progress.mjs status|next|show ID|validate|render|update ID --status 状态 --actor 姓名 --note 说明');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

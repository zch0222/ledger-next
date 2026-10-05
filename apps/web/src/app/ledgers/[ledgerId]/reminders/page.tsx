import Link from 'next/link';
import { deliveryStats, listDeliveries, listNotifications, presentNotification } from '@ledger/domain/deliveries';
import { listChannels, presentChannel } from '@ledger/domain/notify-channels';
import { presentDelivery } from '@ledger/domain/notify-store';
import { listReminderRules, presentRule } from '@ledger/domain/reminders';
import { listBudgets } from '@ledger/domain/reports';
import { listSubscriptions } from '@ledger/domain/subscriptions';
import { database } from '@ledger/db/index';
import { MarkRead, NewRule, RetryDelivery, RuleActions, type RuleView } from '@/components/notify/reminders';
import { EmptyState, Note, PageHeading } from '@/components/ui/page';
import { CHANNEL_TYPES, DELIVERY_STATUS, EVENT_LABELS, RESPONSE_CLASS, type ChannelView } from '@/lib/notify-labels';
import { withParams } from '@/lib/period';
import { param, requireLedger, type LedgerPageProps } from '@/lib/session';

export const dynamic = 'force-dynamic';
const time = (iso: string | null, tz: string) =>
  iso
    ? new Date(iso).toLocaleString('zh-CN', {
        hour12: false,
        timeZone: tz,
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';
const STATUSES = ['', 'queued', 'accepted', 'delivered', 'failed', 'delivery_unknown', 'expired', 'cancelled'];

/** P07 提醒中心: my rules (with the next three planned times), delivery history with retry, and the in-app inbox. */
export default async function Reminders({ params, searchParams }: LedgerPageProps) {
  const { ledgerId } = await params;
  const search = await searchParams;
  const { ctx, ledger } = await requireLedger(ledgerId);
  const tab = param(search, 'tab') ?? 'rules';
  const status = param(search, 'status');
  const [rules, channelRows, subs, budgets, stats] = await Promise.all([
    listReminderRules(ctx, ledgerId, { limit: 100 }),
    listChannels(ctx, { limit: 100 }),
    listSubscriptions(ctx, ledgerId, {}, { limit: 100 }),
    listBudgets(ctx, ledgerId, { limit: 100 }),
    deliveryStats(ctx, ledgerId),
  ]);
  const channels = channelRows.map(presentChannel) as ChannelView[];
  const channelName = new Map(channels.map(c => [c.id, c.name]));
  const subscriptions = subs.map(s => ({ id: s.id, name: s.name }));
  const budgetOptions = budgets.map(b => ({ id: b.id, name: b.name ?? '预算' }));
  const views = (await Promise.all(rules.slice(0, 100).map(r => presentRule(database(), r)))) as RuleView[];
  const subject = (r: RuleView) =>
    r.subscriptionId
      ? (subscriptions.find(s => s.id === r.subscriptionId)?.name ?? '订阅')
      : r.budgetId
        ? (budgetOptions.find(b => b.id === r.budgetId)?.name ?? '预算')
        : r.fx
          ? `${r.fx.base}/${r.fx.quote}${r.fx.above ? ` ≥ ${r.fx.above}` : ''}${r.fx.below ? ` ≤ ${r.fx.below}` : ''}`
          : ['bill_due', 'overdue', 'trial_end', 'cancel_deadline'].includes(r.eventType)
            ? '全部订阅'
            : r.eventType === 'budget_threshold'
              ? '全部预算'
              : '';
  const path = `/ledgers/${ledgerId}/reminders`;
  const sent = (stats.byStatus.accepted ?? 0) + (stats.byStatus.delivered ?? 0);
  const tabs = [
    ['rules', '提醒规则'],
    ['deliveries', '投递记录'],
    ['inbox', '站内通知'],
  ];
  return (
    <>
      <PageHeading
        kicker="提醒中心"
        title="重要的事，提前知道"
        description="每个渠道独立配置，投递结果清楚可查。平台受理 ≠ 用户已读。"
        action={<NewRule channels={channels} subscriptions={subscriptions} budgets={budgetOptions} />}
      />
      <div className="metrics">
        <div className="metric">
          <div className="label">近 7 天送出</div>
          <div className="value num">{sent}</div>
          <div className="hint">平台受理或接收端确认</div>
        </div>
        <div className="metric">
          <div className="label">失败 / 死信</div>
          <div className="value num">{stats.byStatus.failed ?? 0}</div>
          <div className="hint">{stats.deadLetters} 条等待人工重放</div>
        </div>
        <div className="metric">
          <div className="label">结果未知</div>
          <div className="value num">{stats.unknown}</div>
          <div className="hint">可能已送达，不自动重发</div>
        </div>
        <div className="metric">
          <div className="label">调度延迟 p95</div>
          <div className="value num">
            {stats.dispatchDelayMs.p95 === null ? '—' : `${(stats.dispatchDelayMs.p95 / 1000).toFixed(1)} 秒`}
          </div>
          <div className="hint">{stats.dispatchDelayMs.samples} 次发送 · 目标 ≤60 秒</div>
        </div>
      </div>
      <nav className="segmented-links" aria-label="提醒中心">
        {tabs.map(([id, name]) => (
          <Link
            key={id}
            aria-current={tab === id ? 'page' : undefined}
            href={withParams(path, { tab: id === 'rules' ? undefined : id })}
          >
            {name}
          </Link>
        ))}
      </nav>
      {tab === 'rules' && (
        <section className="panel">
          {views.length ? (
            <div className="rule-list">
              {views.map(r => (
                <div className="budget rule" key={r.id} role="group" aria-label={`${EVENT_LABELS[r.eventType]}提醒`}>
                  <div className="row">
                    <h3>
                      {EVENT_LABELS[r.eventType]}
                      {subject(r) ? ` · ${subject(r)}` : ''}
                    </h3>
                    <span className={`pill${r.enabled ? '' : ' warn'}`}>{r.enabled ? '启用中' : '已暂停'}</span>
                  </div>
                  <p className="small muted">
                    {r.leadDays.length
                      ? `${r.leadDays.map(n => (n === 0 ? '当天' : `提前 ${n} 天`)).join('、')} · `
                      : ''}
                    {r.localTime} · {r.timezone}
                    {r.quietHours ? ` · 免打扰 ${r.quietHours.start}–${r.quietHours.end}` : ''}
                    <br />
                    {r.channelIds.map(id => channelName.get(id) ?? '已删除的渠道').join(' + ')}
                  </p>
                  <p className="small">
                    {r.nextFireTimes.length
                      ? `接下来：${r.nextFireTimes.map(t => time(t, ledger.timezone)).join('、')}`
                      : ['budget_threshold', 'fx_threshold', 'delivery_failed'].includes(r.eventType)
                        ? '事件触发：达到条件时发送'
                        : '48 小时内没有待发送的提醒'}
                  </p>
                  <RuleActions rule={r} channels={channels} subscriptions={subscriptions} budgets={budgetOptions} />
                </div>
              ))}
            </div>
          ) : (
            <EmptyState symbol="bell">
              还没有提醒。先在“设置 · 提醒渠道”配置并测试一个渠道，再为订阅到期、预算或汇率设置提醒。
            </EmptyState>
          )}
          <Note>
            已支付、跳过或取消的账单，以及修改后的规则，未发送的旧提醒会自动取消。
            <Link href={`/ledgers/${ledgerId}/settings/channels`}>管理渠道 →</Link>
          </Note>
        </section>
      )}
      {tab === 'deliveries' && (
        <Deliveries
          ctx={ctx}
          ledgerId={ledgerId}
          status={status}
          timezone={ledger.timezone}
          channelName={channelName}
          path={path}
        />
      )}
      {tab === 'inbox' && <Inbox ctx={ctx} ledgerId={ledgerId} timezone={ledger.timezone} />}
    </>
  );
}

async function Deliveries({
  ctx,
  ledgerId,
  status,
  timezone,
  channelName,
  path,
}: {
  ctx: Parameters<typeof listDeliveries>[0];
  ledgerId: string;
  status?: string;
  timezone: string;
  channelName: Map<string, string>;
  path: string;
}) {
  const rows = (await listDeliveries(ctx, ledgerId, status ? { status } : {}, { limit: 100 }))
    .slice(0, 100)
    .map(presentDelivery);
  return (
    <section className="panel">
      <div className="filterbar">
        <nav className="chips" aria-label="按状态筛选">
          {STATUSES.map(s => (
            <Link
              key={s}
              className={`chip-filter${(status ?? '') === s ? ' active' : ''}`}
              aria-current={(status ?? '') === s ? 'page' : undefined}
              href={withParams(path, { tab: 'deliveries', status: s || undefined })}
            >
              {s ? DELIVERY_STATUS[s] : '全部'}
            </Link>
          ))}
        </nav>
      </div>
      {rows.length ? (
        <div className="table-scroll">
          <table className="deliveries">
            <thead>
              <tr>
                <th>计划时间</th>
                <th>提醒</th>
                <th className="hide-mobile">渠道</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(d => (
                <tr key={d.id}>
                  <td className="small">
                    {time(d.scheduledAt, timezone)}
                    {d.deferredByQuietHours ? <div className="small muted">免打扰顺延</div> : null}
                  </td>
                  <td>
                    <strong>{EVENT_LABELS[d.eventType] ?? d.eventType}</strong>
                    <div className="small muted">{d.title}</div>
                  </td>
                  <td className="hide-mobile">
                    {channelName.get(d.channelId) ?? CHANNEL_TYPES[d.channelType as keyof typeof CHANNEL_TYPES]?.name}
                  </td>
                  <td>
                    <span
                      className={`pill${['failed', 'delivery_unknown', 'expired'].includes(d.status) ? ' warn' : ''}`}
                    >
                      {DELIVERY_STATUS[d.status] ?? d.status}
                    </span>
                    <div className="small muted">
                      {d.attempts ? `第 ${d.round} 轮 · ${d.attempts} 次尝试` : ''}
                      {d.responseClass && d.responseClass !== 'ok' ? ` · ${RESPONSE_CLASS[d.responseClass]}` : ''}
                      {d.status === 'queued' && d.attempts ? ' · 等待重试' : ''}
                    </div>
                    {(d.reason || d.lastError) && (
                      <div className="small muted delivery-reason">{d.reason ?? d.lastError}</div>
                    )}
                  </td>
                  <td>
                    {['failed', 'delivery_unknown', 'expired'].includes(d.status) ? (
                      <RetryDelivery id={d.id} status={d.status} />
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState>{status ? '没有这个状态的投递。' : '还没有投递记录。'}</EmptyState>
      )}
    </section>
  );
}

async function Inbox({
  ctx,
  ledgerId,
  timezone,
}: {
  ctx: Parameters<typeof listNotifications>[0];
  ledgerId: string;
  timezone: string;
}) {
  const rows = (await listNotifications(ctx, ledgerId, {}, { limit: 50 })).slice(0, 50).map(presentNotification);
  return (
    <section className="panel" aria-label="站内通知">
      {rows.length ? (
        <ul className="plain-list inbox">
          {rows.map(n => (
            <li key={n.id} className={n.readAt ? 'read' : 'unread'}>
              <div>
                <strong>
                  {n.readAt ? '' : '● '}
                  {n.title}
                </strong>
                <p className="small muted">{n.body}</p>
                <span className="small muted">
                  {time(n.createdAt, timezone)}
                  {n.link ? (
                    <>
                      {' '}
                      · <a href={n.link}>查看</a>
                    </>
                  ) : null}
                </span>
              </div>
              <MarkRead id={n.id} version={n.version} read={Boolean(n.readAt)} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState>暂无站内通知。</EmptyState>
      )}
    </section>
  );
}

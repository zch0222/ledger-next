'use client';
import { useEffect, useRef, useState } from 'react';
import type { EChartsType } from 'echarts/core';
import { groupDigits } from '@ledger/ui/format';

// Chart models carry decimal strings; numbers are used only to draw. Labels and the data tables below each chart
// show the server's exact strings.
/** `future`: the bucket has not started yet; it is left blank instead of being drawn as a zero. */
export type TrendPoint = { label: string; income: string; expense: string; future?: boolean };
export type CategoryItem = { name: string; amount: string; colorIndex: number };
/** One month of subscription bills: paid (booked) and still to pay (open or projected). */
export type BillPoint = {
  /** Axis label ("10月"); `title` heads the tooltip ("2026 年 10 月"). */
  label: string;
  title: string;
  paid: string;
  pending: string;
  total: string;
  count: number;
  current?: boolean;
};
/** A ranked subscription: monthly equivalent in `amount`, its own price and cycle in `note`. */
export type RankItem = CategoryItem & { note: string };
export type ChartModel =
  | { type: 'trend'; mode: 'expense' | 'compare'; points: TrendPoint[]; currency: string; description: string }
  | { type: 'categories'; items: CategoryItem[]; currency: string; description: string }
  | { type: 'bills'; points: BillPoint[]; average: string; currency: string; description: string }
  | { type: 'ranking'; items: RankItem[]; currency: string; description: string }
  | {
      type: 'composition' | 'mix';
      items: CategoryItem[];
      currency: string;
      description: string;
      total: string;
      caption: string;
    };
const CATEGORY_TOKENS = ['cat-food', 'cat-home', 'cat-shopping', 'cat-subscription', 'cat-travel', 'muted'];

function resolve(probe: HTMLElement, token: string) {
  probe.style.color = `var(--${token})`;
  const value = getComputedStyle(probe).color;
  const rgb =
    value
      .match(/^rgba?\(([^)]+)\)/)?.[1]
      .split(/[\s,/]+/)
      .slice(0, 3)
      .map(Number) ??
    value
      .match(/^color\(srgb\s+([^)]+)\)/)?.[1]
      .trim()
      .split(/\s+/)
      .slice(0, 3)
      .map(v => Number(v) * 255);
  return rgb
    ? '#' +
        rgb
          .map(v =>
            Math.round(Math.min(255, Math.max(0, v)))
              .toString(16)
              .padStart(2, '0'),
          )
          .join('')
    : value;
}
/** Theme tokens resolved to hex (color-mix() included); ECharts appends alpha to hex colours. */
function colors() {
  const probe = document.createElement('span');
  probe.hidden = true;
  document.body.append(probe);
  const t = (k: string) => resolve(probe, k);
  const c = {
    ink: t('ink'),
    muted: t('muted'),
    line: t('line'),
    surface: t('panel'),
    positive: t('positive'),
    blue: t('blue'),
    soft: t('soft'),
    categories: CATEGORY_TOKENS.map(t),
  };
  probe.remove();
  return c;
}
const money = (value: number | string, currency: string) =>
  `${currency} ${groupDigits(Number(value).toFixed(currency === 'JPY' ? 0 : 2))}`;
const esc = (v: string) =>
  v.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
type TooltipRow = {
  seriesName: string;
  seriesType: string;
  name: string;
  value: number;
  dataIndex: number;
  percent: number;
  color: unknown;
};
/** A tooltip line: colour key (when the mark has a plain colour), label, value. */
const row = (label: string, value: string, color?: unknown, muted = false) =>
  `<div style="display:flex;gap:20px;align-items:center;justify-content:space-between;${muted ? 'opacity:.72;' : ''}"><span style="display:flex;align-items:center;gap:7px">${typeof color === 'string' ? `<i style="width:8px;height:8px;border-radius:3px;background:${esc(color)}"></i>` : ''}${esc(label)}</span><strong>${esc(value)}</strong></div>`;

function option(model: ChartModel, width: number, reduced: boolean, lib: typeof import('./echarts').default) {
  const c = colors();
  const base = {
    animation: !reduced,
    animationDuration: width < 768 ? 550 : 750,
    animationDurationUpdate: reduced ? 0 : 420,
    animationEasing: 'cubicOut',
    animationEasingUpdate: 'cubicInOut',
    animationThreshold: 366,
    textStyle: { fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', color: c.ink },
    aria: { enabled: true, label: { description: model.description } },
    tooltip: {
      trigger: 'item',
      confine: true,
      backgroundColor: c.surface,
      borderColor: c.line,
      borderWidth: 1,
      padding: [12, 16],
      textStyle: { color: c.ink, fontSize: 12 },
      extraCssText: 'border-radius:12px;box-shadow:0 12px 28px #102d301a;',
      transitionDuration: reduced ? 0 : 0.15,
      formatter: (p: unknown) =>
        (Array.isArray(p) ? p : [p])
          .map((r: TooltipRow) =>
            row(
              r.seriesType === 'pie' || r.seriesName === '分类' ? r.name : r.seriesName,
              money(r.value, model.currency) + (r.seriesType === 'pie' ? ` · ${r.percent.toFixed(1)}%` : ''),
              r.color,
            ),
          )
          .join(''),
    },
  };
  const delay =
    (offset = 0) =>
    (i: number) =>
      reduced ? 0 : Math.min(i * 45 + offset, 180);
  if (model.type === 'trend') {
    const compare = model.mode === 'compare';
    return {
      ...base,
      grid: { top: 26, right: 18, bottom: 34, left: 62 },
      tooltip: {
        ...base.tooltip,
        trigger: 'axis',
        axisPointer: { type: compare ? 'shadow' : 'line', lineStyle: { color: c.line, type: 'dashed' } },
      },
      xAxis: {
        type: 'category',
        boundaryGap: compare,
        data: model.points.map(p => p.label),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: c.muted, fontSize: 12, margin: 14, hideOverlap: true },
      },
      yAxis: {
        type: 'value',
        min: 0,
        splitNumber: 3,
        axisLabel: { color: c.muted, fontSize: 12, formatter: (v: number) => v.toLocaleString('zh-CN') },
        splitLine: { lineStyle: { color: c.line, type: 'dashed' } },
      },
      series: [
        {
          id: 'expense',
          name: '支出',
          type: compare ? 'bar' : 'line',
          data: model.points.map(p => ({ name: p.label, value: p.future ? null : Math.max(0, Number(p.expense)) })),
          smooth: 0.2,
          smoothMonotone: 'x',
          showSymbol: false,
          symbol: 'circle',
          symbolSize: 8,
          barMaxWidth: 23,
          itemStyle: { color: c.blue, borderRadius: [6, 6, 0, 0] },
          lineStyle: { width: 3, color: c.blue },
          areaStyle: compare
            ? undefined
            : {
                color: new lib.graphic.LinearGradient(0, 0, 0, 1, [
                  { offset: 0, color: c.blue + '42' },
                  { offset: 1, color: c.blue + '02' },
                ]),
              },
          emphasis: { focus: 'series', scale: true },
          animationDelay: delay(),
        },
        {
          id: 'income',
          name: '收入',
          type: 'bar',
          data: compare ? model.points.map(p => ({ name: p.label, value: p.future ? null : Number(p.income) })) : [],
          barMaxWidth: 23,
          itemStyle: { color: c.positive, borderRadius: [6, 6, 0, 0] },
          emphasis: { focus: 'series' },
          animationDelay: delay(60),
        },
      ],
    };
  }
  if (model.type === 'bills') {
    // Paid is solid; still to pay is a tint with stripes, so the split never relies on colour alone.
    const pending = c.blue + '47';
    const cap = [6, 6, 0, 0];
    const average = Number(model.average);
    return {
      ...base,
      grid: { top: 30, right: 14, bottom: 30, left: 62 },
      tooltip: {
        ...base.tooltip,
        trigger: 'axis',
        // z below the bars: the hover band sits behind the month instead of washing it out.
        axisPointer: { type: 'shadow', z: 0, shadowStyle: { color: c.soft, opacity: 0.7 } },
        formatter: (p: unknown) => {
          const point = model.points[(p as TooltipRow[])[0]?.dataIndex ?? -1];
          if (!point) return '';
          return (
            `<div style="margin-bottom:6px;font-weight:600">${esc(point.title)}</div>` +
            row('已支付', money(point.paid, model.currency), c.blue) +
            row('待支付', money(point.pending, model.currency), pending) +
            `<div style="margin-top:7px;padding-top:7px;border-top:1px solid ${c.line}">` +
            row(`合计 · ${point.count} 笔`, money(point.total, model.currency)) +
            '</div>'
          );
        },
      },
      xAxis: {
        type: 'category',
        data: model.points.map(p => p.label),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: c.muted,
          fontSize: 12,
          margin: 12,
          hideOverlap: true,
          formatter: (v: string, i: number) => (model.points[i]?.current ? `{now|${v}}` : v),
          rich: { now: { color: c.ink, fontSize: 12, fontWeight: 600 } },
        },
      },
      yAxis: {
        type: 'value',
        min: 0,
        splitNumber: 3,
        axisLabel: { color: c.muted, fontSize: 12, formatter: (v: number) => v.toLocaleString('zh-CN') },
        splitLine: { lineStyle: { color: c.line, type: 'dashed' } },
      },
      series: [
        {
          id: 'paid',
          name: '已支付',
          type: 'bar',
          stack: 'bills',
          barMaxWidth: 28,
          barCategoryGap: '36%',
          itemStyle: { color: c.blue },
          data: model.points.map(p => ({
            value: Number(p.paid),
            itemStyle: { borderRadius: Number(p.pending) > 0 ? 0 : cap },
          })),
          emphasis: { focus: 'series' },
          animationDelay: delay(),
        },
        {
          id: 'pending',
          name: '待支付',
          type: 'bar',
          stack: 'bills',
          barMaxWidth: 28,
          itemStyle: {
            color: pending,
            borderRadius: cap,
            decal: {
              symbol: 'rect',
              symbolSize: 1,
              dashArrayX: [1, 0],
              dashArrayY: [2, 4],
              rotation: Math.PI / 4,
              color: c.blue + '80',
            },
          },
          data: model.points.map(p => Number(p.pending)),
          emphasis: { focus: 'series' },
          animationDelay: delay(40),
          markLine:
            average > 0
              ? {
                  silent: true,
                  symbol: ['none', 'none'],
                  animation: !reduced,
                  lineStyle: { color: c.muted, type: [4, 4], width: 1 },
                  label: {
                    // Narrow charts keep the value in the HTML legend only, so the label never covers a bar.
                    show: width >= 560,
                    position: 'insideEndTop',
                    color: c.muted,
                    fontSize: 11,
                    backgroundColor: c.surface,
                    padding: [2, 6],
                    borderRadius: 6,
                    formatter: `月均 ${money(average, model.currency)}`,
                  },
                  data: [{ yAxis: average }],
                }
              : undefined,
        },
      ],
    };
  }
  const items = model.items.map(i => ({
    name: i.name,
    value: Number(i.amount),
    itemStyle: { color: c.categories[i.colorIndex % c.categories.length] },
  }));
  if (model.type === 'categories') {
    return {
      ...base,
      grid: { left: 70, right: 96, top: 8, bottom: 8 },
      xAxis: { type: 'value', show: false, max: (v: { max: number }) => (v.max > 0 ? v.max * 1.02 : 1) },
      yAxis: {
        type: 'category',
        inverse: true,
        data: model.items.map(i => i.name),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: c.ink, fontSize: 12, width: 62, overflow: 'truncate' },
      },
      series: [
        {
          id: 'categories',
          name: '分类',
          type: 'bar',
          barWidth: 10,
          showBackground: true,
          backgroundStyle: { color: c.soft, borderRadius: 6 },
          label: {
            show: true,
            position: 'right',
            distance: 10,
            color: c.ink,
            fontSize: 12,
            formatter: (p: { value: number }) => money(p.value, model.currency),
          },
          itemStyle: { borderRadius: 6 },
          data: items,
          emphasis: { focus: 'self' },
          animationDelay: delay(),
        },
      ],
    };
  }
  if (model.type === 'ranking') {
    const label = (v: number) => `${money(v, model.currency)}/月`;
    const longest = Math.max(0, ...model.items.map(i => label(Number(i.amount)).length));
    const narrow = width < 420;
    return {
      ...base,
      tooltip: {
        ...base.tooltip,
        formatter: (p: unknown) => {
          const r = p as TooltipRow;
          const item = model.items[r.dataIndex];
          return item ? row(item.name, label(r.value), r.color) + row(item.note, '', undefined, true) : '';
        },
      },
      // Room on the right for the longest money label, so no label is clipped at any width.
      grid: { left: narrow ? 86 : 128, right: longest * 7 + 22, top: 6, bottom: 6 },
      xAxis: { type: 'value', show: false, max: (v: { max: number }) => (v.max > 0 ? v.max * 1.02 : 1) },
      yAxis: {
        type: 'category',
        inverse: true,
        data: model.items.map(i => i.name),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: c.ink, fontSize: 12, width: narrow ? 76 : 116, overflow: 'truncate' },
      },
      series: [
        {
          id: 'ranking',
          name: '订阅',
          type: 'bar',
          barWidth: 10,
          showBackground: true,
          backgroundStyle: { color: c.soft, borderRadius: 6 },
          label: {
            show: true,
            position: 'right',
            distance: 10,
            color: c.ink,
            fontSize: 12,
            formatter: (p: { value: number }) => label(p.value),
          },
          itemStyle: { borderRadius: 6 },
          data: items,
          emphasis: { focus: 'self' },
          animationDelay: delay(),
        },
      ],
    };
  }
  return {
    ...base,
    title: {
      text: `${model.currency} ${groupDigits(model.total)}`,
      subtext: model.caption,
      left: 'center',
      top: '40%',
      itemGap: 8,
      textStyle: { color: c.ink, fontSize: width < 340 ? 19 : 23, fontWeight: 600 },
      subtextStyle: { color: c.muted, fontSize: 12 },
    },
    series: [
      {
        id: model.type,
        name: model.type === 'mix' ? '订阅构成' : '支出构成',
        type: 'pie',
        radius: ['65%', '84%'],
        center: ['50%', '49%'],
        startAngle: 90,
        padAngle: 3,
        label: { show: false },
        labelLine: { show: false },
        itemStyle: { borderRadius: 7 },
        animationType: 'expansion',
        animationDuration: reduced ? 0 : 850,
        animationDurationUpdate: reduced ? 0 : 420,
        emphasis: { scale: true, scaleSize: 5 },
        data: items.filter(i => i.value > 0),
      },
    ],
  };
}

/** setOption on the existing instance; data-chart-* attributes let the end-to-end suite observe updates. */
function draw(
  chart: EChartsType,
  dom: HTMLDivElement,
  model: ChartModel,
  reduced: boolean,
  lib: typeof import('./echarts').default,
) {
  chart.setOption(option(model, dom.clientWidth, reduced, lib) as never, { notMerge: false });
  dom.dataset.chartRenders = String(Number(dom.dataset.chartRenders ?? 0) + 1);
  dom.dataset.chartAnimation = String(!reduced);
}

/**
 * One ECharts instance per container for its whole life: data, display currency and theme changes call setOption on
 * the same instance (no dispose / re-create), resize follows the container, and everything is released on unmount.
 */
export function Chart({
  model,
  onSelect,
  className = 'echart',
  height,
}: {
  model: ChartModel;
  onSelect?: (target: { index: number; name: string }) => void;
  className?: string;
  /** Overrides the CSS height, e.g. to size a ranking by its number of rows. */
  height?: number;
}) {
  const dom = useRef<HTMLDivElement>(null);
  const chart = useRef<EChartsType | null>(null);
  const lib = useRef<typeof import('./echarts').default | null>(null);
  const latest = useRef({ model, onSelect });
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    latest.current = { model, onSelect };
  }, [model, onSelect]);
  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | null = null;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const render = () => {
      if (chart.current && dom.current && lib.current) {
        draw(chart.current, dom.current, latest.current.model, motion.matches, lib.current);
      }
    };
    import('./echarts')
      .then(({ default: echarts }) => {
        if (disposed || !dom.current) return;
        lib.current = echarts;
        chart.current = echarts.init(dom.current, null, { renderer: 'svg' });
        dom.current.dataset.chartInstance = chart.current.id;
        chart.current.on('click', (p: { dataIndex?: number; name?: string }) =>
          latest.current.onSelect?.({ index: p.dataIndex ?? -1, name: p.name ?? '' }),
        );
        observer = new ResizeObserver(() => chart.current?.resize({ animation: { duration: 0 } }));
        observer.observe(dom.current);
        render();
      })
      .catch(() => setFailed(true));
    document.addEventListener('ledger:appearance', render);
    motion.addEventListener('change', render);
    return () => {
      disposed = true;
      document.removeEventListener('ledger:appearance', render);
      motion.removeEventListener('change', render);
      observer?.disconnect();
      chart.current?.dispose();
      chart.current = null;
    };
  }, []);
  // Same instance, new data: an update transition rather than a rebuild.
  useEffect(() => {
    if (chart.current && dom.current && lib.current) {
      draw(chart.current, dom.current, model, matchMedia('(prefers-reduced-motion: reduce)').matches, lib.current);
    }
  }, [model]);
  return failed ? (
    <div className={className} role="note">
      图表资源不可用，请查看下方数据。
    </div>
  ) : (
    <div ref={dom} className={className} style={height ? { height } : undefined} data-chart={model.type} />
  );
}

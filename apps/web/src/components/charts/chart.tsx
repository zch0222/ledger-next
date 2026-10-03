'use client';
import { useEffect, useRef, useState } from 'react';
import type { EChartsType } from 'echarts/core';
import { groupDigits } from '@ledger/ui/format';

// Chart models carry decimal strings; numbers are used only to draw. Labels and the data tables below each chart
// show the server's exact strings.
export type TrendPoint = { label: string; income: string; expense: string };
export type CategoryItem = { name: string; amount: string; colorIndex: number };
export type ChartModel =
  | { type: 'trend'; mode: 'expense' | 'compare'; points: TrendPoint[]; currency: string; description: string }
  | { type: 'categories'; items: CategoryItem[]; currency: string; description: string }
  | {
      type: 'composition';
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
          .map(
            (r: { seriesName: string; seriesType: string; name: string; value: number }) =>
              `<div style="display:flex;gap:20px;justify-content:space-between"><span>${esc(r.seriesType === 'pie' || r.seriesName === '分类' ? r.name : r.seriesName)}</span><strong>${esc(money(r.value, model.currency))}</strong></div>`,
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
          data: model.points.map(p => ({ name: p.label, value: Math.max(0, Number(p.expense)) })),
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
          data: compare ? model.points.map(p => ({ name: p.label, value: Number(p.income) })) : [],
          barMaxWidth: 23,
          itemStyle: { color: c.positive, borderRadius: [6, 6, 0, 0] },
          emphasis: { focus: 'series' },
          animationDelay: delay(60),
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
        id: 'composition',
        name: '支出构成',
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
}: {
  model: ChartModel;
  onSelect?: (target: { index: number; name: string }) => void;
  className?: string;
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
    <div ref={dom} className={className} data-chart={model.type} />
  );
}

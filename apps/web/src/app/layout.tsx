import type { Metadata } from 'next';
import type { CSSProperties } from 'react';
import { appearance } from '../lib/appearance';
import { palette } from '../../../../packages/ui/src/theme.mjs';
import './globals.css';
export const metadata: Metadata = { title: 'Ledger Next · 每一笔，都有去处', description: '个人与家庭账本' };
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const pref = await appearance(), p = palette(pref);
  return <html lang="zh-CN" data-theme={pref.mode === 'system' ? undefined : pref.mode} style={{ '--accent-l': p.light, '--accent-d': p.dark, '--on-accent-l': p.report.light.onAccent, '--on-accent-d': p.report.dark.onAccent } as CSSProperties}><body>{children}</body></html>;
}

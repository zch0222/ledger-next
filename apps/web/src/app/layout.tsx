import type { Metadata, Viewport } from 'next';
import type { CSSProperties } from 'react';
import { currentAppearance } from '@/lib/appearance';
import { palette } from '@ledger/ui/theme.mjs';
import './globals.css';
export const metadata: Metadata = { title: 'Ledger Next · 每一笔，都有去处', description: '个人与家庭账本' };
// Mobile address bar follows the mode: one colour when fixed, both via media queries when following the system.
export async function generateViewport(): Promise<Viewport> {
  const { value } = await currentAppearance();
  const light = { color: '#f5f6f8' };
  const dark = { color: '#11181b' };
  return {
    width: 'device-width',
    initialScale: 1,
    colorScheme: value.mode === 'system' ? 'light dark' : value.mode,
    themeColor:
      value.mode === 'system'
        ? [
            { media: '(prefers-color-scheme: light)', ...light },
            { media: '(prefers-color-scheme: dark)', ...dark },
          ]
        : (value.mode === 'dark' ? dark : light).color,
  };
}
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { value } = await currentAppearance();
  const p = palette(value);
  return (
    <html
      lang="zh-CN"
      data-theme={value.mode === 'system' ? undefined : value.mode}
      style={
        {
          '--accent-l': p.light,
          '--accent-d': p.dark,
          '--on-accent-l': p.report.light.onAccent,
          '--on-accent-d': p.report.dark.onAccent,
        } as CSSProperties
      }
    >
      <body>{children}</body>
    </html>
  );
}

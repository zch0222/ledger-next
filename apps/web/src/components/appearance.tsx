'use client';
import { useEffect, useRef, useState } from 'react';
import { PRESETS, sanitize, palette } from '../../../../packages/ui/src/theme.mjs';
export type AppearanceValue = { mode: string; accent: string; custom: string | null };
export function Appearance({ initial }: { initial: AppearanceValue }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [pref, setPref] = useState(initial), [error, setError] = useState('');
  useEffect(() => {
    const safe = sanitize(pref), p = palette(safe), root = document.documentElement;
    if (safe.mode === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', safe.mode);
    for (const [name, value] of Object.entries({ '--accent-l': p.light, '--accent-d': p.dark, '--on-accent-l': p.report.light.onAccent, '--on-accent-d': p.report.dark.onAccent })) root.style.setProperty(name, value ?? '');
    document.cookie = `ln_appearance=${encodeURIComponent(JSON.stringify(safe))}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
  }, [pref]);
  function change(next: AppearanceValue) {
    setPref(sanitize(next)); setError('');
  }
  return <><button className="appearance-open" aria-label="外观：显示模式与主题色" onClick={() => ref.current?.showModal()}>◐ <span className="label">外观</span></button>
    <dialog ref={ref} className="appearance-dialog" aria-labelledby="appearance-title"><div className="dialoghead"><h2 id="appearance-title">外观</h2><button aria-label="关闭外观设置" onClick={() => ref.current?.close()}>✕</button></div><div className="dialogbody">
      <fieldset><legend>显示模式</legend><div className="seg">{[['light', '浅色'], ['dark', '深色'], ['system', '跟随系统']].map(([id, name]) => <label key={id}><input type="radio" name="theme-mode" checked={pref.mode === id} onChange={() => change({ ...pref, mode: id })} /><span>{name}</span></label>)}</div></fieldset>
      <fieldset><legend>主题色</legend><div className="swatches">{PRESETS.map(p => <label key={p.id} className="swatch"><input type="radio" name="theme-accent" checked={pref.accent === p.id} onChange={() => change({ ...pref, accent: p.id })} /><span className="chip" aria-hidden="true" style={{ background: `linear-gradient(135deg,${p.light} 50%,${p.dark} 50%)` }} /><span className="name">{p.name}</span></label>)}</div></fieldset>
      <div className="field"><label htmlFor="custom-hex">自定义颜色（#RRGGBB）</label><input id="custom-hex" placeholder="#6B4EFF" defaultValue={pref.custom ?? ''} maxLength={7} onChange={e => { if (/^#[a-f0-9]{6}$/i.test(e.target.value)) change({ ...pref, accent: 'custom', custom: e.target.value }); else setError('请输入完整的 #RRGGBB 颜色'); }} /></div><p role="alert" className="error">{error}</p><p className="small muted">本设备生效，自动适配浅色与深色背景。账号同步将在外观里程碑中接入。</p>
    </div><div className="dialogfoot"><button onClick={() => change({ mode: 'system', accent: 'teal', custom: null })}>恢复默认</button><button className="primary" onClick={() => ref.current?.close()}>完成</button></div></dialog></>;
}

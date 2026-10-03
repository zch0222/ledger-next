'use client';
import { useEffect, useRef, useState } from 'react';
import { PRESETS, SURFACES, TARGET, check, derive, palette, sanitize } from '../../../../packages/ui/src/theme.mjs';
import { ApiError, api } from '../lib/client';

export type AppearanceValue = { mode: string; accent: string; custom: string | null };
const MODES = [
  ['light', '浅色', 'M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4'],
  ['dark', '深色', 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z'],
  ['system', '跟随系统', 'M3 4h18v12H3zM8 20h8M12 16v4'],
] as const;
const MODE_NAMES: Record<string, string> = { light: '浅色', dark: '深色', system: '跟随系统' };

const remember = (safe: AppearanceValue, pending: string | null) => {
  document.cookie = `ln_appearance=${encodeURIComponent(JSON.stringify(pending ? { ...safe, pending } : safe))}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
};
/** Applies the appearance to <html> without a page reload; charts listen for "ledger:appearance". */
function apply(pref: AppearanceValue, pending: string | null) {
  const safe = sanitize(pref);
  const p = palette(safe);
  const root = document.documentElement;
  root.classList.add('theme-switching');
  if (safe.mode === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', safe.mode);
  for (const [name, value] of Object.entries({
    '--accent-l': p.light,
    '--accent-d': p.dark,
    '--on-accent-l': p.report.light.onAccent,
    '--on-accent-d': p.report.dark.onAccent,
  })) {
    root.style.setProperty(name, value ?? '');
  }
  remember(safe, pending);
  document.dispatchEvent(new CustomEvent('ledger:appearance'));
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switching')));
}

/**
 * Appearance (UI_SPEC §2.2): instant, device-local first (cookie), then synced to the account with a 500 ms
 * debounce. A failed save keeps the device setting and says so. Used as the top-bar popover / mobile sheet and inline on P13.
 */
export function Appearance({
  initial,
  version: initialVersion = null,
  userId = null,
  pending = false,
  inline = false,
}: {
  initial: AppearanceValue;
  version?: number | null;
  userId?: string | null;
  pending?: boolean;
  inline?: boolean;
}) {
  const signedIn = userId !== null;
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const [pref, setPref] = useState(initial);
  const [hex, setHex] = useState(initial.custom ?? '');
  const [error, setError] = useState('');
  const [sync, setSync] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [systemDark, setSystemDark] = useState(false);
  const version = useRef(initialVersion);
  const first = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const update = () => {
      setSystemDark(media.matches);
      document.dispatchEvent(new CustomEvent('ledger:appearance'));
    };
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  async function save(next: AppearanceValue) {
    if (!signedIn || version.current === null) return;
    setSync('saving');
    const accent =
      next.accent === 'custom' && next.custom
        ? { type: 'custom', value: next.custom.toUpperCase() }
        : { type: 'preset', value: next.accent };
    const send = () =>
      api<{ version: number }>('/api/v1/me/preferences', {
        method: 'PATCH',
        headers: { 'If-Match': `"v${version.current}"` },
        body: JSON.stringify({ appearance: { themeMode: next.mode, accent } }),
      });
    try {
      let saved: { version: number };
      try {
        saved = await send();
      } catch (e) {
        // Another device saved first: re-read the version, then apply the user's latest choice.
        if (!(e instanceof ApiError) || e.status !== 412) throw e;
        version.current = (await api<{ version: number }>('/api/v1/me/preferences')).version;
        saved = await send();
      }
      version.current = saved.version;
      remember(sanitize(next) as AppearanceValue, null);
      setSync('saved');
    } catch {
      setSync('failed');
    }
  }
  useEffect(() => {
    // First render: the server already applied this value; only finish a sync the last page left pending.
    if (first.current) {
      first.current = false;
      if (pending) {
        timer.current = setTimeout(() => {
          timer.current = undefined;
          void save(pref);
        }, 0);
      }
      return;
    }
    apply(pref, userId);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = undefined;
      void save(pref);
    }, 500);
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pref]);

  // Closing the panel saves at once instead of waiting for the debounce.
  const flush = () => {
    if (timer.current === undefined) return;
    clearTimeout(timer.current);
    timer.current = undefined;
    void save(pref);
  };
  const change = (next: AppearanceValue) => {
    setPref(sanitize(next) as AppearanceValue);
    setError('');
  };
  const safe = sanitize(pref);
  const p = palette(safe);
  const custom = safe.custom ? derive(safe.custom) : null;
  const note =
    safe.accent === 'custom' && custom
      ? [custom.lightAdjusted && '浅色模式已自动加深', custom.darkAdjusted && '深色模式已自动提亮']
          .filter(Boolean)
          .join('，') +
        (custom.lightAdjusted || custom.darkAdjusted ? '，满足 WCAG AA。' : '') +
        (custom.near ? ` 接近${custom.near}，建议换一个。` : '')
      : '';
  const mini = (mode: 'light' | 'dark') => {
    const r = check(mode === 'light' ? p.light : p.dark, mode);
    const s = SURFACES[mode];
    return (
      <div className="mini" style={{ background: s.panel, color: s.ink, borderColor: s.line }}>
        <div className="mini-head">
          <strong>{MODE_NAMES[mode]}</strong>
          <span className="num">
            {r.min.toFixed(2)}:1 · {r.min >= TARGET ? 'AA 通过' : '未达 AA'}
          </span>
        </div>
        <div className="mini-row">
          <span className="mini-btn" style={{ background: r.accent, color: r.onAccent }}>
            记一笔
          </span>
          <span style={{ color: r.accent }}>链接</span>
          <span className="mini-pill" style={{ background: r.soft, color: r.accent }}>
            标签
          </span>
        </div>
        <code>{r.accent.toUpperCase()}</code>
      </div>
    );
  };
  const body = (
    <>
      <fieldset>
        <legend>显示模式</legend>
        <div className="seg">
          {MODES.map(([id, name, path]) => (
            <label key={id}>
              <input
                type="radio"
                name="theme-mode"
                value={id}
                checked={safe.mode === id}
                onChange={() => change({ ...pref, mode: id })}
              />
              <span>
                <svg
                  className="icon"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {id === 'light' && <circle cx="12" cy="12" r="4" />}
                  <path d={path} />
                </svg>
                {name}
              </span>
            </label>
          ))}
        </div>
        <p className="small muted mode-hint">
          {safe.mode === 'system'
            ? `跟随系统：当前为${systemDark ? '深色' : '浅色'}，系统切换深浅色时自动更新。`
            : `已固定为${MODE_NAMES[safe.mode]}，不随系统变化（系统当前为${systemDark ? '深色' : '浅色'}）。`}
        </p>
      </fieldset>
      <fieldset>
        <legend>主题色</legend>
        <div className="swatches">
          {PRESETS.map(preset => (
            <label key={preset.id} className="swatch">
              <input
                type="radio"
                name="theme-accent"
                value={preset.id}
                checked={safe.accent === preset.id}
                onChange={() => change({ ...pref, accent: preset.id })}
              />
              <span
                className="chip"
                aria-hidden="true"
                style={{ '--sw-l': preset.light, '--sw-d': preset.dark } as React.CSSProperties}
              />
              <span className="name">
                {preset.name}
                {preset.id === 'teal' && <span className="visually-hidden">（默认）</span>}
              </span>
            </label>
          ))}
          <label className="swatch">
            <input
              type="radio"
              name="theme-accent"
              value="custom"
              checked={safe.accent === 'custom'}
              onChange={() => change({ ...pref, accent: 'custom', custom: safe.custom ?? '#6b4eff' })}
            />
            <span
              className={custom ? 'chip' : 'chip rainbow'}
              aria-hidden="true"
              style={custom ? ({ '--sw-l': custom.light, '--sw-d': custom.dark } as React.CSSProperties) : undefined}
            />
            <span className="name">自定义</span>
          </label>
        </div>
      </fieldset>
      <div className="custom-color" hidden={safe.accent !== 'custom'}>
        <label htmlFor="custom-hex">自定义颜色（#RRGGBB）</label>
        <input
          type="color"
          aria-label="取色器"
          value={safe.custom ?? '#6b4eff'}
          onChange={e => {
            setHex(e.target.value);
            change({ ...pref, accent: 'custom', custom: e.target.value });
          }}
        />
        <input
          id="custom-hex"
          className="num"
          maxLength={7}
          spellCheck={false}
          autoComplete="off"
          aria-describedby="custom-error"
          value={hex}
          onChange={e => {
            setHex(e.target.value);
            if (/^#[0-9a-f]{6}$/i.test(e.target.value)) change({ ...pref, accent: 'custom', custom: e.target.value });
          }}
          onBlur={() => {
            if (hex && !/^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(hex)) {
              setError('请输入 #RRGGBB 格式的颜色，当前主题保持不变');
            }
          }}
        />
        <div className="error" id="custom-error" role="alert">
          {error}
        </div>
      </div>
      <div className="theme-preview" aria-label="浅色与深色模式下的主题色预览">
        {mini('light')}
        {mini('dark')}
      </div>
      <div className="note appearance-note" aria-live="polite" hidden={!note}>
        <span className="dot" />
        <span>{note}</span>
      </div>
      <p className="small muted" aria-live="polite">
        {!signedIn ? (
          '本设备生效。'
        ) : sync === 'failed' ? (
          <span className="warn-text">
            未同步到账号，仅本设备生效。
            <button className="linkbtn" onClick={() => void save(pref)}>
              重试
            </button>
          </span>
        ) : sync === 'saving' ? (
          '正在同步到账号…'
        ) : (
          '即时生效，自动同步到你的账号。'
        )}
      </p>
    </>
  );
  if (inline) {
    return (
      <section className="panel appearance-panel">
        {body}
        <div className="row">
          <span />
          <button
            onClick={() => {
              setHex('');
              change({ mode: 'system', accent: 'teal', custom: null });
            }}
          >
            恢复默认
          </button>
        </div>
      </section>
    );
  }
  return (
    <>
      <button
        ref={opener}
        className="appearance-open"
        aria-haspopup="dialog"
        aria-label="外观：显示模式与主题色"
        title="外观"
        onClick={() => ref.current?.showModal()}
      >
        <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" />
        </svg>
        <span className="label">外观</span>
      </button>
      <dialog
        ref={ref}
        className="appearance-dialog"
        aria-labelledby="appearance-title"
        aria-describedby="appearance-desc"
        onClose={() => {
          flush();
          opener.current?.focus();
        }}
      >
        <div className="dialoghead">
          <div>
            <h2 id="appearance-title">外观</h2>
            <p className="small muted" id="appearance-desc" style={{ margin: '2px 0 0' }}>
              即时生效，只改变显示方式，不影响账目数据。
            </p>
          </div>
          <button type="button" aria-label="关闭外观设置" onClick={() => ref.current?.close()}>
            ✕
          </button>
        </div>
        <div className="dialogbody">{body}</div>
        <div className="dialogfoot">
          <button
            type="button"
            onClick={() => {
              setHex('');
              change({ mode: 'system', accent: 'teal', custom: null });
            }}
          >
            恢复默认
          </button>
          <button type="button" className="primary" onClick={() => ref.current?.close()}>
            完成
          </button>
        </div>
      </dialog>
    </>
  );
}

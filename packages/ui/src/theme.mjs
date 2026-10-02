  const TARGET = 4.5; // WCAG AA for normal text; accent is used as text, focus ring and button fill.
  const DARK_FLOOR = 0.72; // Minimum OKLCH lightness for the dark-mode accent.
  const ON_DARK = '#0f1f22';
  // Keep in sync with the neutral tokens in index.html: generated accents are checked against these surfaces.
  const SURFACES = {
    light: {panel:'#ffffff', canvas:'#f5f6f8', ink:'#182d32', muted:'#52666d', line:'#dfe7e8', softMix:.11},
    dark: {panel:'#1a2428', canvas:'#11181b', ink:'#ecf4f3', muted:'#a4b6ba', line:'#34474d', softMix:.15}
  };
  const SEMANTIC = [{name:'错误 / 支出警示色', hex:'#b94545', range:30}, {name:'警告色', hex:'#986018', range:20}];
  const PRESETS = [
    {id:'teal', name:'青绿', light:'#07766a', dark:'#52cfb7'},
    {id:'ocean', name:'海蓝', light:'#1f6fb2', dark:'#7db8f0'},
    {id:'indigo', name:'靛蓝', light:'#4c5bd4', dark:'#a5aef8'},
    {id:'violet', name:'紫罗兰', light:'#7b4fc0', dark:'#c5a8f4'},
    {id:'rose', name:'玫红', light:'#b02e7c', dark:'#f29bcf'},
    {id:'forest', name:'松绿', light:'#2b7535', dark:'#84d492'},
    {id:'graphite', name:'石墨', light:'#4b5d67', dark:'#b3c4cc'}
  ];
  const DEFAULTS = Object.freeze({mode:'system', accent:'teal', custom:null});

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  function parseHex(input) {
    const m = String(input ?? '').trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(m)) return m.split('').map(c => parseInt(c + c, 16));
    if (/^[0-9a-f]{6}$/i.test(m)) return [0, 2, 4].map(i => parseInt(m.slice(i, i + 2), 16));
    return null;
  }
  const toHex = rgb => '#' + rgb.map(v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
  const normalizeHex = input => { const rgb = parseHex(input); return rgb ? toHex(rgb) : null; };
  const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const gam = c => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
  function luminance(hex) { const [r, g, b] = parseHex(hex).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
  function contrast(a, b) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  // Same result as CSS color-mix(in srgb, a share, b).
  function mix(a, b, share) { const A = parseHex(a), B = parseHex(b); return toHex(A.map((v, i) => v * share + B[i] * (1 - share))); }
  const onColor = bg => contrast('#ffffff', bg) >= contrast(ON_DARK, bg) ? '#ffffff' : ON_DARK;

  function toOklch(hex) {
    const [r, g, b] = parseHex(hex).map(lin);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
    const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
    const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
    return [L, Math.hypot(A, B), (Math.atan2(B, A) * 180 / Math.PI + 360) % 360];
  }
  function linearFromOklch(L, C, H) {
    const h = H * Math.PI / 180, a = C * Math.cos(h), b = C * Math.sin(h);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
    return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
  }
  const inGamut = rgb => rgb.every(v => v >= -1e-4 && v <= 1 + 1e-4);
  function fromOklch(L, C, H) { // Keep hue and lightness; reduce chroma until the color fits sRGB.
    let rgb = linearFromOklch(L, C, H);
    if (!inGamut(rgb)) {
      let lo = 0, hi = C;
      for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (inGamut(linearFromOklch(L, mid, H))) lo = mid; else hi = mid; }
      rgb = linearFromOklch(L, lo, H);
    }
    return toHex(rgb.map(v => gam(clamp(v, 0, 1))));
  }

  // Minimum contrast of the accent as text on every surface it meets, of the text drawn on top of it,
  // and of muted text on the accent-tinted --soft background (notes, highlighted KPI card).
  function check(hex, mode) {
    const s = SURFACES[mode], soft = mix(hex, s.panel, s.softMix), on = onColor(hex);
    const text = Math.min(contrast(hex, s.panel), contrast(hex, s.canvas), contrast(hex, soft));
    const button = contrast(hex, on), muted = contrast(s.muted, soft);
    return {accent:hex, onAccent:on, soft, text, button, muted, min:Math.min(text, button, muted)};
  }
  const passes = (hex, mode) => check(hex, mode).min >= TARGET;
  function hueDistance(a, b) { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }

  function derive(input) {
    const source = normalizeHex(input);
    if (!source) return null;
    const [L, C, H] = toOklch(source);
    let light = source, dark = source;
    if (!passes(light, 'light')) for (let l = L; l >= 0; l -= 0.005) { light = fromOklch(l, C, H); if (passes(light, 'light')) break; }
    if (L < DARK_FLOOR || !passes(dark, 'dark')) for (let l = Math.max(L, DARK_FLOOR); l <= 1.0001; l += 0.005) { dark = fromOklch(Math.min(l, 1), C, H); if (passes(dark, 'dark')) break; }
    const near = C < 0.06 ? null : SEMANTIC.find(s => hueDistance(H, toOklch(s.hex)[2]) < s.range)?.name ?? null;
    return {source, light, dark, lightAdjusted:light !== source, darkAdjusted:dark !== source, near};
  }

  function sanitize(value) {
    const mode = ['system', 'light', 'dark'].includes(value?.mode) ? value.mode : DEFAULTS.mode;
    const custom = normalizeHex(value?.custom);
    let accent = value?.accent;
    if (accent === 'custom' ? !custom : !PRESETS.some(p => p.id === accent)) accent = DEFAULTS.accent;
    return {mode, accent, custom};
  }
  function palette(pref) {
    const preset = PRESETS.find(p => p.id === pref.accent);
    const base = preset ? {source:preset.light, light:preset.light, dark:preset.dark, lightAdjusted:false, darkAdjusted:false, near:null} : derive(pref.custom);
    return {...base, preset:preset?.id ?? 'custom', report:{light:check(base.light, 'light'), dark:check(base.dark, 'dark')}};
  }

export { PRESETS, DEFAULTS, SURFACES, TARGET, sanitize, palette, derive, check, contrast, normalizeHex };


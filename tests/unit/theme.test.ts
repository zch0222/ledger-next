import { expect, it } from 'vitest';
import { PRESETS, DEFAULTS, check, contrast, derive, normalizeHex, palette, sanitize } from '../../packages/ui/src/theme.mjs';
it.each(PRESETS)('$name meets AA in both modes using unchanged prototype colors', p => {
  expect(check(p.light, 'light').min).toBeGreaterThanOrEqual(4.5);
  expect(check(p.dark, 'dark').min).toBeGreaterThanOrEqual(4.5);
  expect(palette({ ...DEFAULTS, accent: p.id }).preset).toBe(p.id);
});
it.each(['#FFFFFF', '#000000', '#FFFF00', '#FF0000', '#00FF00', '#0000FF', '#123456', '#6B4EFF', '#ff8800', '#808080'])('adapts extreme custom color %s without losing contrast', input => {
  const result = derive(input)!;
  expect(check(result.light, 'light').min).toBeGreaterThanOrEqual(4.5);
  expect(check(result.dark, 'dark').min).toBeGreaterThanOrEqual(4.5);
  expect(palette({ mode: 'system', accent: 'custom', custom: input }).preset).toBe('custom');
});
it('sanitizes tampered preference cookies', () => {
  for (const value of [undefined, null, {}, { mode: 'bad', accent: 'bogus' }, { mode: 'system', accent: 'custom', custom: 'url(evil)' }]) expect(sanitize(value)).toEqual(DEFAULTS);
  expect(sanitize({ mode: 'dark', accent: 'custom', custom: '#abc' })).toEqual({ mode: 'dark', accent: 'custom', custom: '#aabbcc' });
  expect(derive('invalid')).toBeNull();
  expect(normalizeHex(' #AbC ')).toBe('#aabbcc');
  expect(normalizeHex('#1234567')).toBeNull();
  expect(contrast('#ffffff', '#000000')).toBe(21);
});

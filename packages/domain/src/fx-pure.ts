import { crossRate, exceeds, relativeChange } from './money';

// Freshness contract (TECHNICAL_DESIGN §5.2): live quotes by source age, never by fetch time.
export const FRESH_MS = 120_000;
export const DELAYED_MS = 15 * 60_000;
/** Transactions within this window of "now" use the live latest batch; older ones use the batch in force at that time. */
export const LIVE_WINDOW_MS = 15 * 60_000;
/** Historical lookups accept the newest batch at most this far before the instant. */
export const HISTORY_WINDOW_MS = 7 * 24 * 3600_000;
/** A daily historical reference rate counts as fresh for the following 26 hours. */
export const HISTORICAL_FRESH_MS = 26 * 3600_000;
export type Freshness = 'fresh' | 'delayed' | 'stale' | 'market_closed' | 'missing' | 'manual';

export function liveFreshness(ageMs: number, failures: number, staleFailures: number): 'fresh' | 'delayed' | 'stale' {
  if (ageMs > DELAYED_MS || failures >= staleFailures) return 'stale';
  return ageMs > FRESH_MS ? 'delayed' : 'fresh';
}
export const historicalFreshness = (gapMs: number): 'fresh' | 'stale' => (gapMs <= HISTORICAL_FRESH_MS ? 'fresh' : 'stale');

/** U→C from one batch quoted against pivot P: R(C) / R(U), with R(P) = 1. Null when the batch lacks a currency. */
export function crossFromBatch(rates: Record<string, string>, pivot: string, from: string, to: string) {
  if (from === to) return '1';
  const of = (code: string) => (code === pivot ? '1' : rates[code]);
  const a = of(from), b = of(to);
  return a && b ? crossRate(a, b) : null;
}
/** First currency whose rate moved more than `threshold` (a fraction, e.g. "0.2") between two batches. */
export function jumpedCurrency(previous: Record<string, string>, next: Record<string, string>, threshold: string) {
  return Object.keys(next).sort().find(code => previous[code] && exceeds(relativeChange(previous[code], next[code]), threshold)) ?? null;
}


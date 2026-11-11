import type { Indicators, Kline } from "./types";

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;

function sma(values: number[], n: number): number {
  if (values.length < n) return NaN;
  return mean(values.slice(-n));
}

function std(values: number[], n: number): number {
  if (values.length < n) return NaN;
  const x = values.slice(-n);
  const m = mean(x);
  return Math.sqrt(mean(x.map(v => (v - m) ** 2)));
}

function rsi(values: number[], n: number): number {
  if (values.length <= n) return NaN;
  const changes = values.slice(1).map((v, i) => v - values[i]);
  const w = changes.slice(-n);
  let gain = 0, loss = 0;
  for (const d of w) {
    if (d > 0) gain += d;
    else loss -= d;
  }
  const avgGain = gain / n;
  const avgLoss = loss / n;
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function emaSeries(values: number[], n: number): number[] {
  const k = 2 / (n + 1);
  const out: number[] = [];
  let prev = values[0];
  out.push(prev);
  for (let i = 1; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

function macdHist(values: number[]): number[] {
  const e12 = emaSeries(values, 12);
  const e26 = emaSeries(values, 26);
  const dif = values.map((_, i) => e12[i] - e26[i]);
  const dea = emaSeries(dif, 9);
  return dif.map((v, i) => 2 * (v - dea[i]));
}

function atr(klines: Kline[], n: number): number {
  if (klines.length <= n) return NaN;
  const tr = klines.slice(1).map((k, i) => {
    const prevClose = klines[i].close;
    return Math.max(k.high - k.low, Math.abs(k.high - prevClose), Math.abs(k.low - prevClose));
  });
  return mean(tr.slice(-n));
}

export function calculateIndicators(klines: Kline[]): Indicators {
  const closes = klines.map(k => k.close);
  const volumes = klines.map(k => k.volume);
  const last = closes.length - 1;
  const lower = sma(closes, 20) - 2 * std(closes, 20);
  const hist = macdHist(closes);
  return {
    rsi6: rsi(closes, 6),
    rsi14: rsi(closes, 14),
    ma5: sma(closes, 5),
    ma10: sma(closes, 10),
    ma20: sma(closes, 20),
    ma60: sma(closes, 60),
    bollLower: lower,
    macdHist: hist[last],
    atr14: atr(klines, 14),
    volumeMa5: sma(volumes, 5),
    volumeMa20: sma(volumes, 20)
  };
}

export function calculateWeekly(clines: Kline[]): { rsi14: number; ma20: number; return3w: number; macdHist: number } {
  const closes = clines.map(k => k.close);
  const hist = macdHist(closes);
  const n = closes.length;
  return {
    rsi14: rsi(closes, 14),
    ma20: sma(closes, 20),
    return3w: n >= 4 ? closes[n - 1] / closes[n - 4] - 1 : NaN,
    macdHist: hist[n - 1]
  };
}

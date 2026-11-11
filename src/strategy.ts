import type { Indicators, Kline } from "./types";

export interface SignalResult {
  entry: boolean;
  exit?: "STOP" | "TARGET1" | "TARGET2" | "TRAIL" | "TIME";
  reason: string;
  stop?: number;
  target1?: number;
  target2?: number;
}

const pct = (a: number, b: number) => a / b - 1;

export function entrySignal(
  bars: Kline[],
  d: Indicators,
  weeklyRsi: number,
  monthlyClose: number,
  monthlyMa12: number,
  priorMacdHist: number,
  prior2MacdHist: number
): SignalResult {
  const n = bars.length;
  const today = bars[n - 1];
  const yesterday = bars[n - 2];
  const closes = bars.map(x => x.close);
  const ret5 = pct(today.close, closes[n - 6]);
  const ret10 = pct(today.close, closes[n - 11]);

  const crash = (ret5 <= -0.05 || ret10 <= -0.08)
    && d.rsi6 <= 20
    && (today.close < d.bollLower || today.volume >= d.volumeMa20 * 1.2);

  const reversal = d.rsi6 > 20
    && d.rsi6 > rsiFromBars(closes.slice(0, -1), 6)
    && today.close > d.ma5
    && d.macdHist < 0
    && d.macdHist > priorMacdHist
    && priorMacdHist > prior2MacdHist;

  // Strict two-stage setup: the prior day must have been in a crash state;
  // then today's close confirms the rebound. Execute next session, never same close.
  const priorCrash = crashAtPreviousDay(bars, d);
  const secondConfirmation = priorCrash
    && reversal
    && today.close > yesterday.high
    && today.volume > d.volumeMa5;

  if (!secondConfirmation) {
    return { entry: false, reason: crash ? "CRASH_WATCH" : "NO_ENTRY" };
  }

  // Monthly regime is a sizing filter, not a hard block; caller applies reduced cap.
  const stop = today.close - 1.5 * d.atr14;
  const risk = today.close - stop;
  return {
    entry: true,
    reason: monthlyClose < monthlyMa12 ? "ENTRY_CAUTION_MONTHLY_DOWNTREND" : "ENTRY_CONFIRMED",
    stop,
    target1: today.close + 1.5 * risk,
    target2: today.close + 2.5 * risk
  };
}

function crashAtPreviousDay(bars: Kline[], d: Indicators): boolean {
  if (bars.length < 12) return false;
  const prev = bars[bars.length - 2];
  const prevClose5 = bars[bars.length - 7].close;
  const prevClose10 = bars[bars.length - 12].close;
  const r5 = prev.close / prevClose5 - 1;
  const r10 = prev.close / prevClose10 - 1;
  // Approximate previous-day confirmation with current indicators deliberately
  // conservative; for exact historical signals, compute all indicators per bar.
  return (r5 <= -0.05 || r10 <= -0.08)
    && d.rsi6 <= 25
    && (prev.close < d.bollLower || prev.volume >= d.volumeMa20 * 1.2);
}

function rsiFromBars(values: number[], period: number): number {
  if (values.length <= period) return 50;
  const w = values.slice(-(period + 1));
  let g = 0, l = 0;
  for (let i = 1; i < w.length; i++) {
    const diff = w[i] - w[i - 1];
    if (diff > 0) g += diff;
    else l -= diff;
  }
  if (l === 0) return g === 0 ? 50 : 100;
  return 100 - 100 / (1 + (g / period) / (l / period));
}

export function evaluatePosition(
  close: number,
  low: number,
  high: number,
  pos: {
    entry_price: number; stop_price: number; initial_risk: number;
    target1: number; target2: number; max_close: number;
    bars_held: number; target1_hit: number;
  },
  atr14: number,
  maxHoldingDays: number
): SignalResult {
  const trail = Math.max(pos.stop_price, pos.max_close - 2 * atr14);
  if (low <= pos.stop_price) return { entry: false, exit: "STOP", reason: "价格触及初始止损" };
  if (pos.target1_hit === 0 && high >= pos.target1) return { entry: false, exit: "TARGET1", reason: "达到1.5R，分批止盈" };
  if (high >= pos.target2) return { entry: false, exit: "TARGET2", reason: "达到2.5R，退出剩余仓位" };
  if (close < trail) return { entry: false, exit: "TRAIL", reason: "跌破2倍ATR移动止盈线" };
  if (pos.bars_held >= maxHoldingDays) return { entry: false, exit: "TIME", reason: "达到最长持有期限" };
  return { entry: false, reason: "HOLD" };
}

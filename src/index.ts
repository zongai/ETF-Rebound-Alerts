import type { Env, Kline, WatchItem } from "./types";
import { fetchBars } from "./data";
import { isOtcFund } from "./fund";
import { calculateIndicators, calculateWeekly } from "./indicators";
import { sendBark } from "./bark";
import { adminHtml } from "./adminPage";

/** Fallback when WATCHLIST env is missing or invalid. */
const DEFAULT_WATCH: WatchItem[] = [
  { symbol: "510300", name: "沪深300ETF", secid: "1.510300" },
  { symbol: "510050", name: "上证50ETF", secid: "1.510050" },
  { symbol: "510500", name: "中证500ETF", secid: "1.510500" },
  { symbol: "159915", name: "创业板ETF", secid: "0.159915" },
  { symbol: "512100", name: "中证1000ETF", secid: "1.512100" },
  { symbol: "050025", name: "博时标普500ETF联接A", secid: "150.050025" },
  { symbol: "000834", name: "大成纳斯达克100ETF联接A", secid: "150.000834" },
  { symbol: "018044", name: "天弘纳斯达克100指数C", secid: "150.018044" },
  { symbol: "017290", name: "中欧科创主题混合C", secid: "150.017290" },
  { symbol: "007729", name: "招商普盛全球配置A", secid: "150.007729" }
];

function getWatchlist(env: Env): WatchItem[] {
  const raw = env.WATCHLIST?.trim();
  if (!raw) return DEFAULT_WATCH;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) {
      console.error("WATCHLIST must be a non-empty JSON array; using default");
      return DEFAULT_WATCH;
    }
    const list: WatchItem[] = [];
    for (const row of parsed) {
      if (!row || typeof row !== "object") continue;
      const symbol = String((row as WatchItem).symbol || "").trim();
      const name = String((row as WatchItem).name || symbol).trim();
      const secid = String((row as WatchItem).secid || "").trim();
      if (!symbol || !secid) continue;
      list.push({ symbol, name, secid });
    }
    if (list.length === 0) {
      console.error("WATCHLIST had no valid items; using default");
      return DEFAULT_WATCH;
    }
    return list;
  } catch (e) {
    console.error("Failed to parse WATCHLIST JSON; using default", e);
    return DEFAULT_WATCH;
  }
}

function chinaDate(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(date);
}

function pct(a: number, b: number): number { return a / b - 1; }

function macdHistory(values: number[]): number[] {
  const ema = (a: number[], n: number) => {
    const k = 2 / (n + 1), out = [a[0]];
    for (let i = 1; i < a.length; i++) out.push(a[i] * k + out[i - 1] * (1 - k));
    return out;
  };
  const e12 = ema(values, 12), e26 = ema(values, 26);
  const dif = values.map((_, i) => e12[i] - e26[i]);
  const dea = ema(dif, 9);
  return dif.map((v, i) => 2 * (v - dea[i]));
}

function findWatch(watch: WatchItem[], symbol: string) {
  return watch.find(x => x.symbol === symbol);
}

/** Calendar gap (days) between two YYYY-MM-DD strings. */
function dayGap(newer: string, older: string): number {
  const a = Date.parse(newer + "T00:00:00+08:00");
  const b = Date.parse(older + "T00:00:00+08:00");
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 999;
  return Math.round((a - b) / 86400000);
}

function authorized(request: Request, env: Env): boolean {
  const auth = request.headers.get("Authorization");
  return !!(env.BARK_DEVICE_KEY && auth === `Bearer ${env.BARK_DEVICE_KEY}`);
}

async function scanEtf(
  env: Env,
  item: WatchItem,
  daily: Kline[],
  weekly: Kline[],
  monthly: Kline[],
  today: string
): Promise<{ alert: boolean }> {
  if (daily.length < 80 || daily[daily.length - 1].date !== today) return { alert: false };
  if (weekly.length < 25 || monthly.length < 13) throw new Error("Insufficient weekly/monthly history");

  const ind = calculateIndicators(daily);
  const w = calculateWeekly(weekly);
  const monthlyCloses = monthly.map(x => x.close);
  const monthlyMa12 = monthlyCloses.slice(-12).reduce((a, b) => a + b, 0) / 12;
  const monthlyClose = monthlyCloses[monthlyCloses.length - 1];

  const last = daily[daily.length - 1];
  const prev = daily[daily.length - 2];
  const closes = daily.map(x => x.close);
  const ret5 = pct(last.close, closes[closes.length - 6]);
  const ret10 = pct(last.close, closes[closes.length - 11]);
  const hist = macdHistory(closes);
  const prevBars = daily.slice(0, -1);
  const prevInd = calculateIndicators(prevBars);
  const prevCloses = prevBars.map(x => x.close);
  const prevRet5 = pct(prev.close, prevCloses[prevCloses.length - 6]);
  const prevRet10 = pct(prev.close, prevCloses[prevCloses.length - 11]);

  const prevCrash = (prevRet5 <= -0.05 || prevRet10 <= -0.08)
    && prevInd.rsi6 <= 20
    && (prev.close < prevInd.bollLower || prev.volume >= prevInd.volumeMa20 * 1.2);

  const weeklyConditions = [
    w.rsi14 < 35,
    w.return3w <= -0.08,
    Number.isFinite(w.ma20) && last.close < w.ma20 * 0.95
  ].filter(Boolean).length;
  const weeklyReady = weeklyConditions >= 2;

  const monthlyCaution = monthlyClose < monthlyMa12;
  const monthlyHighRisk = monthlyCaution && monthly.length >= 3
    && monthlyCloses[monthlyCloses.length - 2] < monthlyCloses[monthlyCloses.length - 13]
    && monthlyCloses[monthlyCloses.length - 1] < monthlyCloses[monthlyCloses.length - 2];

  const reversal = last.close > ind.ma5
    && last.close > prev.high
    && ind.rsi6 > prevInd.rsi6
    && ind.rsi6 > 20
    && ind.macdHist < 0
    && hist[hist.length - 1] > hist[hist.length - 2]
    && hist[hist.length - 2] > hist[hist.length - 3]
    && last.volume > ind.volumeMa5;

  const entry = prevCrash && weeklyReady && reversal;
  let alerts = 0;
  const pos = await env.DB.prepare(
    "SELECT * FROM positions WHERE symbol = ? AND status = 'open'"
  ).bind(item.symbol).first<any>();

  if (entry && !pos) {
    const stop = last.close - 1.5 * ind.atr14;
    const risk = last.close - stop;
    const target1 = last.close + 1.5 * risk;
    const target2 = last.close + 2.5 * risk;
    const key = `${item.symbol}|ENTRY|${today}`;
    await env.DB.prepare(
      `INSERT OR IGNORE INTO signals
       (symbol, trade_date, signal_type, close, entry_price, stop_price, target1, target2)
       VALUES (?, ?, 'ENTRY', ?, ?, ?, ?, ?)`
    ).bind(item.symbol, today, last.close, last.close, stop, target1, target2).run();

    await sendBark(
      env,
      `买入确认：${item.name}`,
      `代码 ${item.symbol}\n信号日收盘价 ${last.close.toFixed(3)}\n参考止损 ${stop.toFixed(3)}\n第一目标 ${target1.toFixed(3)}\n第二目标 ${target2.toFixed(3)}\n周线过滤满足 ${weeklyConditions}/3\n月线状态 ${monthlyHighRisk ? "高风险：谨慎，建议不主动抄底" : monthlyCaution ? "谨慎：风险预算减半" : "正常"}\n5日收益 ${(ret5 * 100).toFixed(2)}%\n10日收益 ${(ret10 * 100).toFixed(2)}%\n请下一交易日按实际可成交价格判断；提醒不是自动下单指令。`,
      key,
      "timeSensitive"
    );
    alerts++;
  }

  if (pos) {
    const maxClose = Math.max(Number(pos.max_close), last.close);
    const barsHeld = Number(pos.bars_held) + 1;
    const trail = Math.max(Number(pos.stop_price), maxClose - 2 * ind.atr14);
    let exitType = "";
    let title = "";
    let body = "";

    if (last.low <= Number(pos.stop_price)) {
      exitType = "STOP"; title = `止损提醒：${item.name}`;
      body = `日内最低价 ${last.low.toFixed(3)} 触及/跌破止损 ${Number(pos.stop_price).toFixed(3)}。实际成交价可能更差。`;
    } else if (Number(pos.target1_hit) === 0 && last.high >= Number(pos.target1)) {
      exitType = "TARGET1"; title = `第一止盈：${item.name}`;
      body = `达到1.5R目标 ${Number(pos.target1).toFixed(3)}，策略建议分批退出约50%。请手动记录实际成交。`;
      await env.DB.prepare(
        "UPDATE positions SET target1_hit=1, remaining_fraction=0.5, max_close=?, bars_held=?, updated_at=CURRENT_TIMESTAMP WHERE symbol=?"
      ).bind(maxClose, barsHeld, item.symbol).run();
    } else if (last.high >= Number(pos.target2)) {
      exitType = "TARGET2"; title = `第二止盈：${item.name}`;
      body = `达到2.5R目标 ${Number(pos.target2).toFixed(3)}，策略建议退出剩余仓位。`;
    } else if (last.close < trail) {
      exitType = "TRAIL"; title = `移动止盈：${item.name}`;
      body = `收盘价 ${last.close.toFixed(3)} 低于移动止盈线 ${trail.toFixed(3)}。`;
    } else if (barsHeld >= Number(env.MAX_HOLDING_DAYS || "20")) {
      exitType = "TIME"; title = `时间退出：${item.name}`;
      body = `持有达到 ${barsHeld} 个交易日，达到最长持有期限。`;
    }

    if (exitType) {
      const key = `${item.symbol}|${exitType}|${today}`;
      await sendBark(env, title, `${body}\n当前收盘价 ${last.close.toFixed(3)}\n请核对实际持仓并手动执行。`, key, "timeSensitive");
      if (exitType !== "TARGET1") {
        await env.DB.prepare(
          "UPDATE positions SET status='closed', updated_at=CURRENT_TIMESTAMP WHERE symbol=?"
        ).bind(item.symbol).run();
      }
      alerts++;
    } else {
      await env.DB.prepare(
        "UPDATE positions SET max_close=?, bars_held=?, updated_at=CURRENT_TIMESTAMP WHERE symbol=?"
      ).bind(maxClose, barsHeld, item.symbol).run();
    }
  }

  await env.DB.prepare(
    "INSERT OR REPLACE INTO daily_snapshots (symbol, trade_date, close, volume) VALUES (?, ?, ?, ?)"
  ).bind(item.symbol, last.date, last.close, last.volume).run();

  return { alert: alerts > 0 };
}

/**
 * Net-value strategy for OTC funds (150.*).
 * No volume / intraday high-low. Uses unit NAV series.
 * QDII NAV may lag 1–2 calendar days — accept latest NAV within 5 days.
 */
async function scanFund(
  env: Env,
  item: WatchItem,
  daily: Kline[],
  today: string
): Promise<{ alert: boolean }> {
  if (daily.length < 60) throw new Error("Insufficient fund NAV history");
  const last = daily[daily.length - 1];
  const gap = dayGap(today, last.date);
  // Skip if NAV too stale (e.g. holiday / unpublished QDII)
  if (gap > 5) {
    console.log(`fund ${item.symbol}: NAV date ${last.date} too stale vs ${today} (gap=${gap})`);
    return { alert: false };
  }

  const ind = calculateIndicators(daily);
  const prevBars = daily.slice(0, -1);
  const prevInd = calculateIndicators(prevBars);
  const prev = daily[daily.length - 2];
  const closes = daily.map(x => x.close);
  const ret5 = pct(last.close, closes[closes.length - 6]);
  const ret10 = pct(last.close, closes[closes.length - 11]);
  const prevCloses = prevBars.map(x => x.close);
  const prevRet5 = pct(prev.close, prevCloses[prevCloses.length - 6]);
  const prevRet10 = pct(prev.close, prevCloses[prevCloses.length - 11]);
  const hist = macdHistory(closes);

  // Prior NAV-day crash (no volume / band touch required)
  const prevCrash = (prevRet5 <= -0.05 || prevRet10 <= -0.08) && prevInd.rsi6 <= 25;

  // Rebound on latest NAV day
  const reversal = last.close > ind.ma5
    && ind.rsi6 > prevInd.rsi6
    && ind.rsi6 > 20
    && hist[hist.length - 1] > hist[hist.length - 2]
    && hist[hist.length - 2] >= hist[hist.length - 3];

  const entry = prevCrash && reversal;
  let alerts = 0;
  const signalDate = last.date; // use NAV date for dedupe, not calendar today
  const pos = await env.DB.prepare(
    "SELECT * FROM positions WHERE symbol = ? AND status = 'open'"
  ).bind(item.symbol).first<any>();

  if (entry && !pos) {
    const atr = Number.isFinite(ind.atr14) && ind.atr14 > 0 ? ind.atr14 : last.close * 0.02;
    const stop = last.close - 1.5 * atr;
    const risk = last.close - stop;
    const target1 = last.close + 1.5 * risk;
    const target2 = last.close + 2.5 * risk;
    const key = `${item.symbol}|ENTRY|${signalDate}`;
    await env.DB.prepare(
      `INSERT OR IGNORE INTO signals
       (symbol, trade_date, signal_type, close, entry_price, stop_price, target1, target2)
       VALUES (?, ?, 'ENTRY', ?, ?, ?, ?, ?)`
    ).bind(item.symbol, signalDate, last.close, last.close, stop, target1, target2).run();

    await sendBark(
      env,
      `买入确认（净值）：${item.name}`,
      `代码 ${item.symbol}（场外基金）\n净值日 ${signalDate}\n单位净值 ${last.close.toFixed(4)}\n参考止损 ${stop.toFixed(4)}\n第一目标 ${target1.toFixed(4)}\n第二目标 ${target2.toFixed(4)}\n5日收益 ${(ret5 * 100).toFixed(2)}%\n10日收益 ${(ret10 * 100).toFixed(2)}%\nRSI6 ${ind.rsi6.toFixed(1)}\n场外基金按净值交易，存在确认延迟与申赎限制；提醒不是自动下单指令。`,
      key,
      "timeSensitive"
    );
    alerts++;
  }

  if (pos) {
    const maxClose = Math.max(Number(pos.max_close), last.close);
    const barsHeld = Number(pos.bars_held) + 1;
    const atr = Number.isFinite(ind.atr14) && ind.atr14 > 0 ? ind.atr14 : last.close * 0.02;
    const trail = Math.max(Number(pos.stop_price), maxClose - 2 * atr);
    let exitType = "";
    let title = "";
    let body = "";

    // NAV has no intraday range: use close only (conservative)
    if (last.close <= Number(pos.stop_price)) {
      exitType = "STOP"; title = `止损提醒（净值）：${item.name}`;
      body = `净值 ${last.close.toFixed(4)} 触及/跌破止损 ${Number(pos.stop_price).toFixed(4)}。`;
    } else if (Number(pos.target1_hit) === 0 && last.close >= Number(pos.target1)) {
      exitType = "TARGET1"; title = `第一止盈（净值）：${item.name}`;
      body = `净值达到1.5R目标 ${Number(pos.target1).toFixed(4)}，策略建议分批赎回约50%。`;
      await env.DB.prepare(
        "UPDATE positions SET target1_hit=1, remaining_fraction=0.5, max_close=?, bars_held=?, updated_at=CURRENT_TIMESTAMP WHERE symbol=?"
      ).bind(maxClose, barsHeld, item.symbol).run();
    } else if (last.close >= Number(pos.target2)) {
      exitType = "TARGET2"; title = `第二止盈（净值）：${item.name}`;
      body = `净值达到2.5R目标 ${Number(pos.target2).toFixed(4)}，策略建议赎回剩余份额。`;
    } else if (last.close < trail) {
      exitType = "TRAIL"; title = `移动止盈（净值）：${item.name}`;
      body = `净值 ${last.close.toFixed(4)} 低于移动止盈线 ${trail.toFixed(4)}。`;
    } else if (barsHeld >= Number(env.MAX_HOLDING_DAYS || "20")) {
      exitType = "TIME"; title = `时间退出（净值）：${item.name}`;
      body = `持有达到 ${barsHeld} 个净值日，达到最长持有期限。`;
    }

    if (exitType) {
      const key = `${item.symbol}|${exitType}|${signalDate}`;
      await sendBark(env, title, `${body}\n净值日 ${signalDate}\n当前净值 ${last.close.toFixed(4)}\n请核对实际持仓并手动执行。`, key, "timeSensitive");
      if (exitType !== "TARGET1") {
        await env.DB.prepare(
          "UPDATE positions SET status='closed', updated_at=CURRENT_TIMESTAMP WHERE symbol=?"
        ).bind(item.symbol).run();
      }
      alerts++;
    } else {
      await env.DB.prepare(
        "UPDATE positions SET max_close=?, bars_held=?, updated_at=CURRENT_TIMESTAMP WHERE symbol=?"
      ).bind(maxClose, barsHeld, item.symbol).run();
    }
  }

  await env.DB.prepare(
    "INSERT OR REPLACE INTO daily_snapshots (symbol, trade_date, close, volume) VALUES (?, ?, ?, ?)"
  ).bind(item.symbol, last.date, last.close, 0).run();

  return { alert: alerts > 0 };
}

async function scan(env: Env): Promise<{ scanned: number; alerts: number; errors: string[] }> {
  const today = chinaDate();
  let scanned = 0, alerts = 0;
  const errors: string[] = [];
  const watch = getWatchlist(env);

  for (const item of watch) {
    try {
      const bars = await fetchBars(item);
      let result: { alert: boolean };
      if (bars.kind === "fund") {
        result = await scanFund(env, item, bars.daily, today);
      } else {
        result = await scanEtf(env, item, bars.daily, bars.weekly!, bars.monthly!, today);
      }
      if (result.alert) alerts++;
      scanned++;
    } catch (e) {
      errors.push(`${item.symbol}: ${String(e)}`);
      console.error("scan error", item.symbol, e);
    }
  }
  return { scanned, alerts, errors };
}

async function registerPosition(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as {
    symbol?: string; entry_date?: string; entry_price?: number; quantity?: number;
  };
  const symbol = String(body.symbol || "");
  const watch = getWatchlist(env);
  const item = findWatch(watch, symbol);
  if (!item) return Response.json({ error: "symbol not in watchlist" }, { status: 400 });
  if (!body.entry_date || !/^\d{4}-\d{2}-\d{2}$/.test(body.entry_date)
      || !Number.isFinite(body.entry_price) || Number(body.entry_price) <= 0
      || !Number.isInteger(body.quantity) || Number(body.quantity) <= 0) {
    return Response.json({ error: "Required: symbol, entry_date YYYY-MM-DD, positive entry_price, positive integer quantity" }, { status: 400 });
  }

  const bars = await fetchBars(item);
  const ind = calculateIndicators(bars.daily);
  const entry = Number(body.entry_price);
  const atr = Number.isFinite(ind.atr14) && ind.atr14 > 0
    ? ind.atr14
    : entry * (isOtcFund(item.secid) ? 0.02 : 0.015);
  const stop = entry - 1.5 * atr;
  const risk = entry - stop;
  const target1 = entry + 1.5 * risk;
  const target2 = entry + 2.5 * risk;

  await env.DB.prepare(
    `INSERT OR REPLACE INTO positions
     (symbol, entry_date, entry_price, stop_price, initial_risk, target1, target2,
      quantity, remaining_fraction, target1_hit, max_close, bars_held, status, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1.0, 0, ?, 0, 'open', CURRENT_TIMESTAMP)`
  ).bind(symbol, body.entry_date, entry, stop, risk, target1, target2, body.quantity, entry).run();

  return Response.json({
    ok: true, symbol, entry_price: entry, quantity: body.quantity,
    stop, target1, target2, kind: bars.kind
  });
}

async function listPositions(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM positions ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, updated_at DESC"
  ).all();
  return Response.json({ positions: results || [] });
}

async function closePosition(env: Env, symbol: string): Promise<Response> {
  const row = await env.DB.prepare(
    "SELECT symbol FROM positions WHERE symbol = ?"
  ).bind(symbol).first();
  if (!row) return Response.json({ error: "position not found" }, { status: 404 });
  await env.DB.prepare(
    "UPDATE positions SET status='closed', updated_at=CURRENT_TIMESTAMP WHERE symbol=?"
  ).bind(symbol).run();
  return Response.json({ ok: true, symbol, status: "closed" });
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(scan(env));
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/health") {
      const watch = getWatchlist(env);
      return Response.json({
        ok: true,
        service: "a-share-etf-rebound-alerts",
        time: new Date().toISOString(),
        watch_count: watch.length
      });
    }

    if (path === "/admin" || path === "/admin/") {
      return new Response(adminHtml(), {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
      });
    }

    if (path === "/run" && request.method === "POST") {
      if (!authorized(request, env)) return new Response("Unauthorized", { status: 401 });
      return Response.json(await scan(env));
    }

    if (path === "/positions" && request.method === "POST") {
      if (!authorized(request, env)) return new Response("Unauthorized", { status: 401 });
      try { return await registerPosition(request, env); }
      catch (e) { return Response.json({ error: String(e) }, { status: 500 }); }
    }

    if (path === "/api/positions" && request.method === "GET") {
      if (!authorized(request, env)) return new Response("Unauthorized", { status: 401 });
      try { return await listPositions(env); }
      catch (e) { return Response.json({ error: String(e) }, { status: 500 }); }
    }

    if (path.startsWith("/api/positions/") && path.endsWith("/close") && request.method === "POST") {
      if (!authorized(request, env)) return new Response("Unauthorized", { status: 401 });
      const symbol = decodeURIComponent(path.slice("/api/positions/".length, -"/close".length));
      try { return await closePosition(env, symbol); }
      catch (e) { return Response.json({ error: String(e) }, { status: 500 }); }
    }

    if (path === "/api/watchlist" && request.method === "GET") {
      if (!authorized(request, env)) return new Response("Unauthorized", { status: 401 });
      const watch = getWatchlist(env);
      return Response.json({
        watchlist: watch.map(w => ({
          ...w,
          kind: isOtcFund(w.secid) ? "fund" : "etf"
        }))
      });
    }

    return new Response(
      "A-share ETF/Fund rebound monitor.\nGET /health\nGET /admin\nPOST /run\nPOST /positions\nGET /api/positions\nPOST /api/positions/:symbol/close\nGET /api/watchlist",
      { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
  }
};

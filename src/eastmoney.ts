import type { Kline } from "./types";

// Eastmoney push2his kline endpoint. secid: 1.510300 (SSE) or 0.159915 (SZSE).
// This is a public web endpoint, not a guaranteed/contractual market-data API.
// Add retry, timeout, and schema validation; verify permitted use and availability before production.
const BASE = "https://push2his.eastmoney.com/api/qt/stock/kline/get";

export async function fetchKlines(
  symbol: string,
  secid: string,
  beg = "20180101",
  end = "20500101",
  klt = "101",
  limit = "1200"
): Promise<Kline[]> {
  const params = new URLSearchParams({
    secid,
    fields1: "f1,f2,f3,f4,f5,f6",
    fields2: "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
    klt,
    fqt: "1",
    beg,
    end,
    lmt: limit
  });
  const url = `${BASE}?${params.toString()}`;
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 ETF-monitor/1.0", "Referer": "https://quote.eastmoney.com/" },
        signal: AbortSignal.timeout(10000)
      });
      if (!response.ok) throw new Error(`Eastmoney HTTP ${response.status}`);
      const body: any = await response.json();
      const rows: string[] | undefined = body?.data?.klines;
      if (!Array.isArray(rows) || rows.length < 2) {
        throw new Error(`Invalid/insufficient kline payload for ${symbol}`);
      }
      return rows.map(row => {
        const p = row.split(",");
        return {
          date: p[0],
          open: Number(p[1]),
          close: Number(p[2]),
          high: Number(p[3]),
          low: Number(p[4]),
          volume: Number(p[5])
        };
      }).filter(k => [k.open, k.close, k.high, k.low, k.volume].every(Number.isFinite));
    } catch (err) {
      lastError = err;
      if (attempt < 2) await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  throw new Error(`Eastmoney fetch failed for ${symbol}: ${String(lastError)}`);
}

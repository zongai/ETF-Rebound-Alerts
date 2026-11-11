import type { Kline, WatchItem } from "./types";
import { fetchKlines } from "./eastmoney";
import { fetchFundNav, isOtcFund } from "./fund";

/** Unified bar fetch: ETF/stock K-line vs OTC fund unit NAV. */
export async function fetchBars(item: WatchItem, dailyLimit = "1200"): Promise<{
  kind: "etf" | "fund";
  daily: Kline[];
  weekly?: Kline[];
  monthly?: Kline[];
}> {
  if (isOtcFund(item.secid)) {
    const daily = await fetchFundNav(item.symbol, item.secid, 120);
    return { kind: "fund", daily };
  }
  const [daily, weekly, monthly] = await Promise.all([
    fetchKlines(item.symbol, item.secid, "20180101", "20500101", "101", dailyLimit),
    fetchKlines(item.symbol, item.secid, "20180101", "20500101", "102", "500"),
    fetchKlines(item.symbol, item.secid, "20100101", "20500101", "103", "240")
  ]);
  return { kind: "etf", daily, weekly, monthly };
}

import type { Kline } from "./types";

/**
 * Eastmoney fund historical net-value API (OTC funds, secid 150.xxxxx).
 * Public web endpoint — not a contractual market-data API.
 * Returns unit NAV series mapped into Kline shape (O=H=L=C=NAV, volume=0).
 */
const LSJZ = "https://api.fund.eastmoney.com/f10/lsjz";

function fundCodeFromSecid(secid: string): string {
  const parts = secid.split(".");
  return parts.length >= 2 ? parts[1] : secid;
}

export function isOtcFund(secid: string): boolean {
  return secid.startsWith("150.");
}

export async function fetchFundNav(
  symbol: string,
  secid: string,
  pageSize = 120
): Promise<Kline[]> {
  const code = fundCodeFromSecid(secid);
  const all: Kline[] = [];
  let pageIndex = 1;
  let total = Infinity;
  let lastError: unknown;

  while (all.length < pageSize && all.length < total) {
    const need = Math.min(20, pageSize - all.length);
    const params = new URLSearchParams({
      fundCode: code,
      pageIndex: String(pageIndex),
      pageSize: String(need),
      startDate: "",
      endDate: ""
    });
    const url = `${LSJZ}?${params.toString()}`;
    let gotPage = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 ETF-monitor/1.0",
            Referer: "https://fundf10.eastmoney.com/"
          },
          signal: AbortSignal.timeout(12000)
        });
        if (!response.ok) throw new Error(`Fund NAV HTTP ${response.status}`);
        const body: any = await response.json();
        if (body?.ErrCode !== 0 && body?.ErrCode != null) {
          throw new Error(`Fund NAV ErrCode ${body.ErrCode}: ${body.ErrMsg || ""}`);
        }
        const list: any[] = body?.Data?.LSJZList || [];
        total = Number(body?.TotalCount ?? list.length);
        if (!Array.isArray(list) || list.length === 0) {
          if (all.length === 0) throw new Error(`Empty NAV list for ${symbol}`);
          gotPage = true;
          total = all.length;
          break;
        }
        for (const row of list) {
          const date = String(row.FSRQ || "").slice(0, 10);
          const nav = Number(row.DWJZ);
          if (!date || !Number.isFinite(nav) || nav <= 0) continue;
          all.push({
            date,
            open: nav,
            close: nav,
            high: nav,
            low: nav,
            volume: 0
          });
        }
        gotPage = true;
        break;
      } catch (err) {
        lastError = err;
        if (attempt < 2) await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
      }
    }
    if (!gotPage) throw new Error(`Fund NAV fetch failed for ${symbol}: ${String(lastError)}`);
    pageIndex++;
    if (pageIndex > 15) break;
  }

  all.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const deduped: Kline[] = [];
  for (const k of all) {
    if (deduped.length && deduped[deduped.length - 1].date === k.date) {
      deduped[deduped.length - 1] = k;
    } else {
      deduped.push(k);
    }
  }
  if (deduped.length < 30) {
    throw new Error(`Insufficient fund NAV history for ${symbol}: ${deduped.length} bars`);
  }
  return deduped;
}

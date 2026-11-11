export interface WatchItem {
  symbol: string;
  name: string;
  secid: string;
}

export interface Env {
  DB: D1Database;
  BARK_DEVICE_KEY: string;
  BARK_BASE_URL?: string;
  /** JSON array of {symbol,name,secid}. Example set in wrangler.toml [vars] or CF dashboard. */
  WATCHLIST?: string;
  TIMEZONE?: string;
  MAX_POSITION_PCT?: string;
  RISK_PER_TRADE_PCT?: string;
  MAX_HOLDING_DAYS?: string;
  ENTRY_COOLDOWN_DAYS?: string;
}

export interface Kline {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
}

export interface Indicators {
  rsi6: number;
  rsi14: number;
  ma5: number;
  ma10: number;
  ma20: number;
  ma60: number;
  bollLower: number;
  macdHist: number;
  atr14: number;
  volumeMa5: number;
  volumeMa20: number;
}

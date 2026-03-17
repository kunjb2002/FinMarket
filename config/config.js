// ─── API Keys ──────────────────────────────────────────────────────────────────
// Alpha Vantage — free, 25 calls/day, direct CORS (no proxy needed)
// Get a free key at: https://www.alphavantage.co/support/#api-key
export const AV_KEY = "S8FWB5CS0SYIZDT5";

// Finnhub — used only for ticker tape quotes (60 calls/min, free)
// Get a free key at: https://finnhub.io
export const FINNHUB_KEY = "d6ooj51r01qi5kh3oda0d6ooj51r01qi5kh3odag";

// ─── Cache durations ───────────────────────────────────────────────────────────
export const CACHE_DURATION_QUOTE    =  1 * 60 * 60 * 1000;  // 1 hour  — tape quotes
export const CACHE_DURATION_CANDLE   = 24 * 60 * 60 * 1000;  // 24 hours — daily OHLCV
export const CACHE_DURATION_INTRADAY = 15 * 60 * 1000;       // 15 min  — intraday bars

// ─── Defaults ──────────────────────────────────────────────────────────────────
export const DEFAULT_SYMBOL    = "SPY";
export const DEFAULT_TIMEFRAME = "1M";
// ─── api.js ───────────────────────────────────────────────────────────────────
//
// Alpha Vantage (native CORS, no proxy needed):
//   fetchCandles(symbol)         → TIME_SERIES_DAILY    (daily OHLCV, cached 24h)
//   fetchIntraday(symbol)        → TIME_SERIES_INTRADAY (60min bars, cached 15min)
//
// Finnhub (free, 60 req/min):
//   fetchQuote(symbol)           → /quote               (tape live prices)
//   searchSymbols(query)         → /search              (autocomplete)
// ─────────────────────────────────────────────────────────────────────────────

import { AV_KEY, FINNHUB_KEY } from "../config/config.js";

const AV_BASE      = "https://www.alphavantage.co/query";
const FINNHUB_BASE = "https://finnhub.io/api/v1";

// ── Shared AV error check ─────────────────────────────────────────────────────
function avError(data) {
    return data["Note"] || data["Information"] || data["Error Message"] || null;
}

// ── fetchCandles — daily OHLCV ────────────────────────────────────────────────
export async function fetchCandles(symbol) {
    const url = `${AV_BASE}?function=TIME_SERIES_DAILY&symbol=${symbol}&outputsize=compact&apikey=${AV_KEY}`;

    let data;
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        data = await res.json();
    } catch (err) {
        console.warn(`AV daily network error: ${err.message} → fallback`);
        return generateFallbackCandles(symbol);
    }

    const err = avError(data);
    if (err) {
        console.warn("AV daily limit/error:", err, "→ fallback");
        return generateFallbackCandles(symbol);
    }

    const series = data["Time Series (Daily)"];
    if (!series || !Object.keys(series).length) {
        console.warn("No daily data for", symbol, "→ fallback");
        return generateFallbackCandles(symbol);
    }

    return Object.entries(series)
        .map(([dateStr, bar]) => makeCandle(dateStr, bar, false))
        .filter(c => c !== null)
        .sort((a, b) => a.x - b.x);
}

// ── fetchIntraday — 60-min bars, last trading day ─────────────────────────────
// AV TIME_SERIES_INTRADAY compact = last ~2 months of 60min bars.
// We filter down to the single most-recent trading session (same date).
export async function fetchIntraday(symbol) {
    const url = `${AV_BASE}?function=TIME_SERIES_INTRADAY&symbol=${symbol}&interval=60min&outputsize=compact&apikey=${AV_KEY}`;

    let data;
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        data = await res.json();
    } catch (err) {
        console.warn(`AV intraday network error: ${err.message} → fallback`);
        return generateFallbackIntraday(symbol);
    }

    const err = avError(data);
    if (err) {
        console.warn("AV intraday limit/error:", err, "→ fallback");
        return generateFallbackIntraday(symbol);
    }

    const series = data["Time Series (60min)"];
    if (!series || !Object.keys(series).length) {
        console.warn("No intraday data for", symbol, "→ fallback");
        return generateFallbackIntraday(symbol);
    }

    // AV returns "2024-01-15 09:30:00" strings, newest-first
    const allBars = Object.entries(series)
        .map(([dtStr, bar]) => makeCandle(dtStr, bar, true))
        .filter(c => c !== null)
        .sort((a, b) => a.x - b.x); // oldest → newest

    if (!allBars.length) return generateFallbackIntraday(symbol);

    // Keep only the most recent trading date's bars
    const lastDate = allBars.at(-1).dateStr;
    return allBars.filter(c => c.dateStr === lastDate);
}

// ── makeCandle — shared parser for both daily and intraday ────────────────────
function makeCandle(dtStr, bar, isIntraday) {
    const o = parseFloat(bar["1. open"]);
    const h = parseFloat(bar["2. high"]);
    const l = parseFloat(bar["3. low"]);
    const c = parseFloat(bar["4. close"]);
    const v = parseFloat(bar["5. volume"]);

    if (!isFinite(o) || !isFinite(c)) return null;

    let x, time, dateStr;

    if (isIntraday) {
        // "2024-01-15 09:30:00" — treat as America/New_York by appending EST offset
        // Using -05:00 (EST). Close enough for display; the candle shape is what matters.
        x       = new Date(dtStr.replace(" ", "T") + "-05:00");
        time    = Math.floor(x.getTime() / 1000); // lightweight-charts wants Unix seconds for intraday
        dateStr = dtStr.slice(0, 10);             // "2024-01-15" — used to filter same-day bars
    } else {
        // "2024-01-15" — force UTC midnight so timezone can't shift the date
        x       = new Date(dtStr + "T00:00:00Z");
        time    = dtStr;                           // lightweight-charts accepts "YYYY-MM-DD" for daily
        dateStr = dtStr;
    }

    return { time, x, dateStr, open: o, high: h, low: l, close: c, volume: v, o, h, l, c, v };
}

// ── fetchQuote — Finnhub real-time quote (ticker tape) ────────────────────────
export async function fetchQuote(symbol) {
    const url = `${FINNHUB_BASE}/quote?symbol=${symbol}&token=${FINNHUB_KEY}`;
    let data;
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        data = await res.json();
    } catch (err) {
        throw new Error(`Network error: ${err.message}`);
    }
    if (data?.error) throw new Error(`Finnhub: ${data.error}`);
    if (!data?.c)    throw new Error(`No quote for "${symbol}"`);
    return {
        price: data.c, change: data.d, changePct: data.dp,
        high: data.h, low: data.l, open: data.o, prevClose: data.pc,
    };
}

// ── searchSymbols — Finnhub symbol search (autocomplete) ─────────────────────
// Returns [{symbol, name, type}] filtered to equity/ETF results only.
export async function searchSymbols(query) {
    if (!query || query.length < 1) return [];
    const url = `${FINNHUB_BASE}/search?q=${encodeURIComponent(query)}&token=${FINNHUB_KEY}`;
    try {
        const res  = await fetch(url, { signal: AbortSignal.timeout(5000) });
        const data = await res.json();
        if (data?.error) return [];

        return (data.result || [])
            .filter(r => r.type === "Common Stock" || r.type === "ETP") // stocks + ETFs only
            .slice(0, 7) // max 7 suggestions
            .map(r => ({
                symbol: r.symbol,
                name:   r.description,
                type:   r.type === "ETP" ? "ETF" : "Stock",
            }));
    } catch {
        return [];
    }
}

// ── fetchNews — Finnhub company news (last 7 days, max 6 articles) ────────────
// Endpoint: GET /api/v1/company-news?symbol=AAPL&from=YYYY-MM-DD&to=YYYY-MM-DD
// Returns: [{id, headline, summary, source, url, datetime (unix), image}]
export async function fetchNews(symbol) {
    const to   = new Date();
    const from = new Date(); from.setDate(from.getDate() - 7);
    const fmt  = d => d.toISOString().split("T")[0];

    const url = `${FINNHUB_BASE}/company-news?symbol=${symbol}&from=${fmt(from)}&to=${fmt(to)}&token=${FINNHUB_KEY}`;
    try {
        const res  = await fetch(url, { signal: AbortSignal.timeout(8000) });
        const data = await res.json();
        if (!Array.isArray(data)) return [];

        return data
            .filter(a => a.headline && a.url)
            .slice(0, 6)
            .map(a => ({
                headline: a.headline,
                summary:  a.summary || "",
                source:   a.source  || "News",
                url:      a.url,
                image:    a.image   || "",
                time:     a.datetime * 1000, // unix seconds → ms
            }));
    } catch {
        return [];
    }
}

// ── generateFallbackCandles — realistic daily OHLCV ──────────────────────────
// Prices seeded to approximate March 2026 levels.
// Every candle carries _fallback:true so loadDaily() can detect it,
// show a warning, and cache for only 5 min instead of 24 hours.
const SEED_MAP = {
    SPY:  { base: 575,  vol: 0.009, drift: 0.0003 },
    AAPL: { base: 220,  vol: 0.013, drift: 0.0003 },
    TSLA: { base: 280,  vol: 0.028, drift: 0.0002 },
    NVDA: { base: 950,  vol: 0.025, drift: 0.0006 },
    MSFT: { base: 415,  vol: 0.011, drift: 0.0004 },
    META: { base: 620,  vol: 0.018, drift: 0.0004 },
    GOOGL:{ base: 190,  vol: 0.013, drift: 0.0003 },
    AMZN: { base: 225,  vol: 0.014, drift: 0.0003 },
    QQQ:  { base: 510,  vol: 0.010, drift: 0.0004 },
};

function seededRng(seed) {
    let s = seed % 2147483647;
    if (s <= 0) s += 2147483646;
    return () => { s = s * 16807 % 2147483647; return (s - 1) / 2147483646; };
}

export function generateFallbackCandles(symbol, days = 504) {
    const cfg  = SEED_MAP[symbol] ?? { base: 100, vol: 0.015, drift: 0.0002 };
    const rng  = seededRng([...symbol].reduce((a, c) => a + c.charCodeAt(0), 0));
    let price  = cfg.base;
    const end  = new Date(); end.setUTCHours(0, 0, 0, 0);
    const day  = new Date(end); day.setUTCDate(day.getUTCDate() - Math.round(days * 1.4));
    const out  = [];

    while (day <= end && out.length < days) {
        if (day.getUTCDay() === 0 || day.getUTCDay() === 6) { day.setUTCDate(day.getUTCDate() + 1); continue; }
        const r = (rng() - 0.5) * 2;
        const open  = price;
        const close = Math.max(open + open * (cfg.drift + r * cfg.vol), 0.5);
        const wick  = open * cfg.vol * (rng() * 0.6 + 0.2);
        const high  = Math.max(open, close) + wick * rng();
        const low   = Math.min(open, close) - wick * rng();
        const vol   = Math.round((rng() * 8e6 + 2e6) * (1 + Math.abs(r) * 2));
        const dt    = new Date(day); price = close;
        const dateStr = dt.toISOString().split("T")[0];
        out.push({ time: dateStr, x: dt, dateStr, open, high, low, close, volume: vol, o: open, h: high, l: low, c: close, v: vol, _fallback: true });
        day.setUTCDate(day.getUTCDate() + 1);
    }
    return out;
}

// ── generateFallbackIntraday — realistic 60min bars for today ─────────────────
export function generateFallbackIntraday(symbol) {
    const cfg  = SEED_MAP[symbol] ?? { base: 100, vol: 0.004, drift: 0.00005 };
    const rng  = seededRng([...symbol].reduce((a, c) => a + c.charCodeAt(0), 42));
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const dateStr = today.toISOString().split("T")[0];

    // Market hours: 9:30 AM – 4:00 PM ET = 14:30–21:00 UTC
    const hours = [14, 15, 16, 17, 18, 19, 20]; // UTC hours
    let price = cfg.base * (0.98 + rng() * 0.04);
    const out = [];

    for (const h of hours) {
        const r     = (rng() - 0.5) * 2;
        const open  = price;
        const close = Math.max(open + open * (cfg.drift + r * cfg.vol), 0.5);
        const wick  = open * cfg.vol * (rng() * 0.5 + 0.1);
        const high  = Math.max(open, close) + wick;
        const low   = Math.min(open, close) - wick;
        const vol   = Math.round((rng() * 5e6 + 1e6));
        const x     = new Date(today); x.setUTCHours(h, 30, 0, 0);
        const ts    = Math.floor(x.getTime() / 1000);
        price = close;
        out.push({ time: ts, x, dateStr, open, high, low, close, volume: vol, o: open, h: high, l: low, c: close, v: vol });
    }
    return out;
}
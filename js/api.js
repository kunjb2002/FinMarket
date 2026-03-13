// ─── api.js ───────────────────────────────────────────────────────────────────
//
// WHY NO CORS PROXY
// ──────────────────
// corsproxy.io / allorigins.win frequently hang for 10-24 s then return an HTML
// error page. .json() throws AFTER the timeout → spinner never clears.
//
// Alpha Vantage sends "Access-Control-Allow-Origin: *" on every response, so it
// works directly from the browser with zero proxy needed.
//
// STRATEGY
// ─────────
//  1. fetchCandles()  → Alpha Vantage TIME_SERIES_DAILY (1 call, cached 24h)
//  2. If rate-limited → fall back to generateFallbackCandles() instantly
//  3. fetchQuote()    → Finnhub /quote (tape only, still free & fast)
//
// ─────────────────────────────────────────────────────────────────────────────

import { AV_KEY, FINNHUB_KEY } from "../config/config.js";

const AV_BASE = "https://www.alphavantage.co/query";

// ── fetchCandles ──────────────────────────────────────────────────────────────
export async function fetchCandles(symbol) {
    const url = `${AV_BASE}?function=TIME_SERIES_DAILY&symbol=${symbol}&outputsize=compact&apikey=${AV_KEY}`;

    let data;
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        data = await res.json();
    } catch (err) {
        console.warn(`Alpha Vantage network error: ${err.message}. Using fallback data.`);
        return generateFallbackCandles(symbol);
    }

    // Rate-limit / invalid key / wrong symbol — AV puts a note in the JSON
    if (data["Note"] || data["Information"] || data["Error Message"]) {
        const reason = data["Note"] || data["Information"] || data["Error Message"];
        console.warn("Alpha Vantage limit/error:", reason, "→ using fallback data");
        return generateFallbackCandles(symbol);
    }

    const series = data["Time Series (Daily)"];
    if (!series || !Object.keys(series).length) {
        console.warn("No time-series data for", symbol, "→ using fallback data");
        return generateFallbackCandles(symbol);
    }

    // Parse: AV returns newest-first → reverse to oldest-first
    const candles = Object.entries(series)
        .map(([dateStr, bar]) => {
            const dt = new Date(dateStr + "T00:00:00Z"); // force UTC midnight
            return {
                time:   dateStr,
                x:      dt,
                open:   parseFloat(bar["1. open"]),
                high:   parseFloat(bar["2. high"]),
                low:    parseFloat(bar["3. low"]),
                close:  parseFloat(bar["4. close"]),
                volume: parseFloat(bar["5. volume"]),
                o: parseFloat(bar["1. open"]),
                h: parseFloat(bar["2. high"]),
                l: parseFloat(bar["3. low"]),
                c: parseFloat(bar["4. close"]),
                v: parseFloat(bar["5. volume"]),
            };
        })
        .filter(c => isFinite(c.open) && isFinite(c.close))
        .sort((a, b) => a.x - b.x); // oldest → newest

    return candles;
}

// ── fetchQuote (Finnhub — tape only) ──────────────────────────────────────────
export async function fetchQuote(symbol) {
    const url = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_KEY}`;

    let data;
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        data = await res.json();
    } catch (err) {
        throw new Error(`Network error: ${err.message}`);
    }

    if (data?.error)       throw new Error(`Finnhub: ${data.error}`);
    if (!data?.c)          throw new Error(`No quote for "${symbol}"`);

    return {
        price:     data.c,
        change:    data.d,
        changePct: data.dp,
        high:      data.h,
        low:       data.l,
        open:      data.o,
        prevClose: data.pc,
    };
}

// ── generateFallbackCandles ───────────────────────────────────────────────────
// Produces 2 years of realistic-looking OHLCV data using a seeded random walk.
// Used whenever the API is rate-limited or offline — the chart always renders.
const SEED_MAP = {
    SPY:  { base: 480,   vol: 0.009, drift: 0.0003 },
    AAPL: { base: 185,   vol: 0.013, drift: 0.0003 },
    TSLA: { base: 225,   vol: 0.028, drift: 0.0002 },
    NVDA: { base: 875,   vol: 0.025, drift: 0.0006 },
    MSFT: { base: 395,   vol: 0.011, drift: 0.0004 },
    META: { base: 485,   vol: 0.018, drift: 0.0004 },
    GOOGL:{ base: 168,   vol: 0.013, drift: 0.0003 },
    AMZN: { base: 187,   vol: 0.014, drift: 0.0003 },
    QQQ:  { base: 435,   vol: 0.010, drift: 0.0004 },
};

function seededRng(seed) {
    let s = seed % 2147483647;
    if (s <= 0) s += 2147483646;
    return () => {
        s = s * 16807 % 2147483647;
        return (s - 1) / 2147483646;
    };
}

export function generateFallbackCandles(symbol, days = 504) { // 504 ≈ 2 trading years
    const cfg   = SEED_MAP[symbol] ?? { base: 100, vol: 0.015, drift: 0.0002 };
    const seed  = [...symbol].reduce((a, c) => a + c.charCodeAt(0), 0);
    const rng   = seededRng(seed);

    const candles = [];
    let price     = cfg.base;
    // Start date: `days` calendar days before today
    const end     = new Date();
    end.setUTCHours(0, 0, 0, 0);

    let day = new Date(end);
    day.setUTCDate(day.getUTCDate() - Math.round(days * 1.4)); // overshoot for weekends

    while (day <= end && candles.length < days) {
        const dow = day.getUTCDay();
        if (dow === 0 || dow === 6) { day.setUTCDate(day.getUTCDate() + 1); continue; }

        const r      = (rng() - 0.5) * 2;
        const open   = price;
        const change = open * (cfg.drift + r * cfg.vol);
        const close  = Math.max(open + change, 0.5);
        const wick   = open * cfg.vol * (rng() * 0.6 + 0.2);
        const high   = Math.max(open, close) + wick * rng();
        const low    = Math.min(open, close) - wick * rng();
        const volume = Math.round((rng() * 8e6 + 2e6) * (1 + Math.abs(r) * 2));
        price = close;

        const dt = new Date(day);
        candles.push({
            time: dt.toISOString().split("T")[0],
            x: dt,
            open, high, low, close, volume,
            o: open, h: high, l: low, c: close, v: volume,
        });

        day.setUTCDate(day.getUTCDate() + 1);
    }

    return candles;
}